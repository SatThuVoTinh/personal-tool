"""One-shot, stdin/stdout-only entry point for the isolated PDF runtime."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import random
import re
import sys
import time
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .ocr import OcrRuntimeError

PROTOCOL_VERSION = "zink:pdf-runtime-protocol:v1"
MAX_REQUEST_BYTES = 64 * 1024
# F-284 (R7-C3-03): the parent sends the budget it has left for this
# extraction, and the child refuses a request that carries no budget. The
# child's own worst case (four pages times thirty-two regions times ninety
# seconds) is twelve times the parent's operation ceiling, so the composition
# has to be bounded by the budget the parent sent.
MAX_EXTRACTION_BUDGET_SECONDS = 3600.0
_SAFE_ERRORS = {
    "PDF_DOCUMENT_INVALID",
    "PDF_DOCUMENT_ENCRYPTED",
    "PDF_DOCUMENT_EMPTY",
    "PDF_MULTI_PAGE_ITEM_UNSUPPORTED",
    "PDF_RUNTIME_UNAVAILABLE",
    "PDF_RUNTIME_PROTOCOL_MISMATCH",
    "PDF_RUNTIME_MISMATCH",
    "PDF_RUNTIME_OUTPUT_INVALID",
    "PDF_RUNTIME_FAILED",
    "PDF_PAGE_RANGE_UNSUPPORTED",
    # F-283 (R7-C3-02): the OCR module raises these two codes for the
    # deadline it exceeded and the output cap it breached, and the safe-code
    # list did not admit them, so the catch-all turned a slow region and a
    # genuine crash into the same generic failure before the response left
    # the process. The parent's whitelist admits both, and its timeout
    # branch is reachable again.
    "PDF_RUNTIME_TIMEOUT",
    "PDF_RUNTIME_OUTPUT_LIMIT",
}
_THREAD_POLICY_CONFIGURED = False


def main() -> None:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        _write_error("PDF_RUNTIME_OUTPUT_INVALID")
        return
    try:
        request = _canonical_json(raw)
    except Exception:
        _write_error("PDF_RUNTIME_OUTPUT_INVALID")
        return
    try:
        response = _dispatch(request)
    except Exception:
        response = _error("PDF_RUNTIME_FAILED")
    sys.stdout.buffer.write(_canonical_bytes(response))
    sys.stdout.buffer.flush()


def _dispatch(request: Mapping[str, Any]) -> Mapping[str, Any]:
    if request.get("protocol_version") != PROTOCOL_VERSION:
        return _error("PDF_RUNTIME_PROTOCOL_MISMATCH")
    operation = request.get("operation")
    if operation == "probe":
        return _probe(request)
    if operation == "preflight":
        return _preflight(request)
    if operation == "extract_range":
        return _extract_range(request)
    return _error("PDF_RUNTIME_OUTPUT_INVALID")


def _probe(request: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(request) != {
        "protocol_version",
        "operation",
        "expected_processing_identity_digest",
    }:
        return _error("PDF_RUNTIME_OUTPUT_INVALID")
    try:
        manifest = _load_manifest()
        actual = _runtime_identity(manifest)
    except Exception:
        return _error("PDF_RUNTIME_UNAVAILABLE")
    expected = request.get("expected_processing_identity_digest")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        return _error("PDF_RUNTIME_MISMATCH")
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "ok",
        # F-286 (R7-C3-05): the processing identity is owned by the PARENT,
        # and the child used to echo the value it was sent, which the parent
        # then compared back. That comparison could not fail: it verified
        # nothing. The child reports only what it recomputed -- the lock
        # digest, the distribution versions, the artifact digests and its own
        # code digest -- and those are the checks that measure.
        "pdf_runtime_lock_digest": actual["pdf_runtime_lock_digest"],
        "distributions": actual["distributions"],
        "artifact_digests": actual["artifact_digests"],
        "runner_code_digest": actual["runner_code_digest"],
    }


def _extract_range(request: Mapping[str, Any]) -> Mapping[str, Any]:
    if set(request) != {
        "protocol_version",
        "operation",
        "source_path",
        "page_start",
        "page_end",
        "expected_processing_identity_digest",
        "deadline_budget_seconds",
    }:
        return _error("PDF_RUNTIME_OUTPUT_INVALID")
    start, end = request.get("page_start"), request.get("page_end")
    if (
        isinstance(start, bool)
        or isinstance(end, bool)
        or not isinstance(start, int)
        or not isinstance(end, int)
        or start < 1
        or end < start
    ):
        return _error("PDF_RUNTIME_OUTPUT_INVALID")
    budget = request.get("deadline_budget_seconds")
    if (
        isinstance(budget, bool)
        or not isinstance(budget, (int, float))
        or not math.isfinite(float(budget))
        or float(budget) <= 0
        or float(budget) > MAX_EXTRACTION_BUDGET_SECONDS
    ):
        return _error("PDF_RUNTIME_OUTPUT_INVALID")
    probe = _probe({
        "protocol_version": PROTOCOL_VERSION,
        "operation": "probe",
        "expected_processing_identity_digest": request.get("expected_processing_identity_digest"),
    })
    if probe.get("status") != "ok":
        return probe
    overall_deadline = time.monotonic() + float(budget)
    try:
        source = _safe_source_path(request.get("source_path"))
        result = _docling_extract(source, start, end, overall_deadline)
        # F-282 (R7-C3-01): the conversion outcome is evidence. A conversion
        # that did not fully succeed means a requested page may have been
        # skipped, and a page that produced nothing used to disappear from the
        # index while the build was marked complete. The child fails closed
        # instead.
        if not conversion_succeeded(result):
            return _error("PDF_RUNTIME_FAILED")
        # F-438 (R9-L09-2): materialisation is part of the guarded region. Its
        # own codes (_MultiPageItem, _RangeUnsupported, OcrRuntimeError) were
        # flattened into PDF_RUNTIME_FAILED by the child's blanket main
        # handler because the call used to sit outside this try.
        items = _materialize_document_items(result.document, start, end)
    except OcrRuntimeError as error:
        # F-283 (R7-C3-02): the OCR deadline and the OCR output cap are the
        # parent's own classification inputs, so they must survive the child
        # boundary instead of collapsing into the generic failure code.
        return _error(error.code)
    except _MultiPageItem:
        return _error("PDF_MULTI_PAGE_ITEM_UNSUPPORTED")
    except _RangeUnsupported:
        return _error("PDF_PAGE_RANGE_UNSUPPORTED")
    except Exception:
        return _error("PDF_RUNTIME_FAILED")
    covered_pages = sorted({int(item["page_start"]) for item in items})
    blank_pages = sorted(set(range(start, end + 1)) - set(covered_pages))
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "ok",
        "page_start": start,
        "page_end": end,
        "items": items,
        # F-282 (R7-C3-01): the response names the pages it covered, and the
        # pages the successful conversion proved empty, so the parent can
        # refuse a batch that accounts for neither.
        "covered_pages": covered_pages,
        "blank_pages": blank_pages,
    }


def conversion_succeeded(result: Any) -> bool:
    """Whether the conversion outcome was fully successful.

    F-282 (R7-C3-01): the conversion result carries its own status, and only
    the fully successful one proves that every requested page was processed.
    """

    status = getattr(result, "status", None)
    if status is None:
        return False
    value = getattr(status, "value", status)
    return str(value).strip().lower() == "success"


def _preflight(request: Mapping[str, Any]) -> Mapping[str, Any]:
    """Reject invalid or protected PDFs through pypdfium2's public API."""

    if set(request) != {
        "protocol_version",
        "operation",
        "source_path",
        "expected_processing_identity_digest",
    }:
        return _error("PDF_RUNTIME_OUTPUT_INVALID")
    probe = _probe(
        {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "probe",
            "expected_processing_identity_digest": request.get(
                "expected_processing_identity_digest"
            ),
        }
    )
    if probe.get("status") != "ok":
        return probe
    try:
        import pypdfium2
        from pypdfium2 import raw
    except Exception:
        return _error("PDF_RUNTIME_UNAVAILABLE")
    try:
        source = _safe_source_path(request.get("source_path"))
        with pypdfium2.PdfDocument(source, password=None) as document:
            revision = raw.FPDF_GetSecurityHandlerRevision(document.raw)
            if revision != -1:
                return _error("PDF_DOCUMENT_ENCRYPTED")
            page_count = len(document)
    except pypdfium2.PdfiumError as error:
        if error.err_code in {raw.FPDF_ERR_PASSWORD, raw.FPDF_ERR_SECURITY}:
            return _error("PDF_DOCUMENT_ENCRYPTED")
        return _error("PDF_DOCUMENT_INVALID")
    except Exception:
        return _error("PDF_DOCUMENT_INVALID")
    if page_count == 0:
        return _error("PDF_DOCUMENT_EMPTY")
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "ok",
        "page_count": page_count,
    }


class _RangeUnsupported(RuntimeError):
    pass


class _MultiPageItem(RuntimeError):
    pass


def _docling_extract(
    source: Path, start: int, end: int, overall_deadline: float
) -> Any:
    """Use the candidate's public range API and explicit Pdfium backend only.

    No lane runs this path: the docling closure is not installed by any test
    lane, and the stale range-contract suite that claimed to run it inside the
    Linux image called the superseded three-argument form (F-439, R9-L09-3).
    The arity is pinned from the parent lane instead. This module deliberately
    has no fallback to full-document conversion or internal batching.
    """

    _configure_determinism()
    from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    from .docling_ocr import M4StandardPdfPipeline, set_extraction_deadline

    artifacts = Path(os.environ["ZINK_PDF_ARTIFACTS_ROOT"])
    if not artifacts.is_dir():
        raise RuntimeError("artifacts unavailable")
    options = PdfPipelineOptions(
        artifacts_path=artifacts,
        do_ocr=True,
        do_table_structure=True,
        do_code_enrichment=False,
        do_formula_enrichment=False,
        do_picture_classification=False,
        do_picture_description=False,
        allow_external_plugins=False,
        enable_remote_services=False,
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=M4StandardPdfPipeline,
                backend=PyPdfiumDocumentBackend,
                pipeline_options=options,
            )
        },
    )
    # F-284 (R7-C3-03): the deadline the parent sent bounds the WHOLE
    # extraction, so every OCR region inside it is bounded by that deadline
    # rather than by a fresh ninety seconds each.
    set_extraction_deadline(overall_deadline)
    try:
        result = converter.convert(source, page_range=(start, end))
    except TypeError as error:
        raise _RangeUnsupported from error
    finally:
        set_extraction_deadline(None)
    return result


def _materialize_document_items(
    document: Any, start: int, end: int
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    # ``iterate_items`` is Docling's public reading-order traversal.  OCR text
    # nested below a PictureItem is a TextItem, so identify its public parent
    # reference before emitting the ordered stream.
    ordered_items = tuple(document.iterate_items())
    picture_refs = {
        getattr(element, "self_ref", "")
        for element, _level in ordered_items
        if _is_picture_item(element)
    }
    table_refs = {
        getattr(element, "self_ref", "")
        for element, _level in ordered_items
        if _is_table_item(element)
    }
    multi_page_tables: dict[str, tuple[tuple[str, Any], ...]] = {}
    for element, _level in ordered_items:
        if not _is_table_item(element) or not _spans_multiple_pages(
            element, start, end
        ):
            continue
        table_ref = str(getattr(element, "self_ref", ""))
        if not table_ref or table_ref in multi_page_tables:
            raise _MultiPageItem
        multi_page_tables[table_ref] = _resolved_table_text_items(
            document, element
        )
    picture_child_refs = {
        str(getattr(child, "cref", child))
        for element, _level in ordered_items
        if _is_picture_item(element)
        for child in (getattr(element, "children", ()) or ())
    }
    ordered_table_child_refs = [
        child_ref
        for children in multi_page_tables.values()
        for child_ref, _child in children
    ]
    multi_page_table_child_refs = set(ordered_table_child_refs)
    if (
        len(multi_page_table_child_refs) != len(ordered_table_child_refs)
        or multi_page_table_child_refs.intersection(picture_child_refs)
    ):
        raise _MultiPageItem
    for element, _level in ordered_items:
        if _is_picture_item(element):
            for child in _resolved_picture_text_items(document, element):
                _append_materialized_item(
                    items,
                    document,
                    child,
                    "figure_text",
                    getattr(child, "text", ""),
                    start,
                    end,
                )
            continue
        element_ref = str(getattr(element, "self_ref", ""))
        if element_ref in multi_page_tables:
            before = len(items)
            for _child_ref, child in multi_page_tables[element_ref]:
                _append_materialized_item(
                    items,
                    document,
                    child,
                    "table",
                    getattr(child, "text", ""),
                    start,
                    end,
                    provenance_kind="text",
                )
            if len(items) == before:
                raise _MultiPageItem
            continue
        if (
            element_ref in picture_child_refs
            or element_ref in multi_page_table_child_refs
        ):
            # Nested children are emitted at their structural reading-order slot.
            continue
        kind, content = _public_item_content(
            document, element, picture_refs, table_refs
        )
        if kind is None or not content:
            continue
        _append_materialized_item(items, document, element, kind, content, start, end)
    return items


def _append_materialized_item(
    output: list[dict[str, Any]],
    document: Any,
    element: Any,
    kind: str,
    content: str,
    start: int,
    end: int,
    *,
    provenance_kind: str | None = None,
) -> None:
    provenance = tuple(getattr(element, "prov", ()) or ())
    if not provenance or not content:
        return
    for page, page_content, bbox in _page_local_content(
        provenance_kind or kind, content, provenance, document, start, end
    ):
        output.append(
            {
                "kind": kind,
                "ordinal": len(output),
                "content": page_content,
                "page_start": page,
                "page_end": page,
                "bbox": bbox,
            }
        )


def _resolved_picture_text_items(document: Any, picture: Any) -> tuple[Any, ...]:
    """Resolve public PictureItem child refs without using Docling internals."""

    from docling_core.types.doc import TextItem

    output: list[Any] = []
    for reference in (getattr(picture, "children", ()) or ()):
        child = reference.resolve(document)
        if isinstance(child, TextItem):
            output.append(child)
    return tuple(output)


def _resolved_table_text_items(
    document: Any, table: Any
) -> tuple[tuple[str, Any], ...]:
    """Resolve every public multi-page table child without guessing page identity."""

    from docling_core.types.doc import TextItem

    references = tuple(getattr(table, "children", ()) or ())
    if not references:
        raise _MultiPageItem
    output: list[tuple[str, Any]] = []
    seen: set[str] = set()
    for reference in references:
        child_ref = str(getattr(reference, "cref", ""))
        try:
            child = reference.resolve(document)
        except Exception as error:
            raise _MultiPageItem from error
        if (
            not child_ref
            or child_ref in seen
            or not isinstance(child, TextItem)
            or str(getattr(child, "self_ref", "")) != child_ref
            or not isinstance(getattr(child, "text", None), str)
            or not getattr(child, "text").strip()
            or not tuple(getattr(child, "prov", ()) or ())
        ):
            raise _MultiPageItem
        seen.add(child_ref)
        output.append((child_ref, child))
    return tuple(output)


def _spans_multiple_pages(element: Any, start: int, end: int) -> bool:
    pages = {
        int(getattr(source, "page_no", 0))
        for source in (getattr(element, "prov", ()) or ())
    }
    if any(page < start or page > end for page in pages):
        raise _RangeUnsupported
    return len(pages) > 1


def _public_item_content(
    document: Any,
    element: Any,
    picture_refs: set[str],
    table_refs: set[str],
) -> tuple[str | None, str]:
    """Use documented Docling item APIs without depending on internals."""

    from docling_core.types.doc import PictureItem, TableItem, TextItem

    if isinstance(element, TableItem):
        return "table", element.export_to_markdown(doc=document).strip()
    if isinstance(element, PictureItem):
        return None, ""
    if isinstance(element, TextItem):
        parent_ref = _parent_ref(element)
        if parent_ref in table_refs:
            return None, ""
        kind = "figure_text" if parent_ref in picture_refs else "text"
        return kind, getattr(element, "text", "")
    return None, ""


def _page_local_content(
    kind: str,
    content: str,
    provenance: tuple[Any, ...],
    document: Any,
    requested_start: int,
    requested_end: int,
) -> list[tuple[int, str, list[float] | None]]:
    pages = {int(getattr(source, "page_no", 0)) for source in provenance}
    if any(page < requested_start or page > requested_end for page in pages):
        raise _RangeUnsupported
    if kind == "table":
        if len(pages) != 1:
            raise _MultiPageItem
        page = next(iter(pages))
        bbox = (
            _normalized_bbox(getattr(provenance[0], "bbox", None), document, page)
            if len(provenance) == 1
            else None
        )
        return [(page, content, bbox)]

    parts: list[tuple[int, str, list[float] | None]] = []
    for source in provenance:
        page = int(getattr(source, "page_no", 0))
        charspan = getattr(source, "charspan", None)
        if (
            not isinstance(charspan, (list, tuple))
            or len(charspan) != 2
            or isinstance(charspan[0], bool)
            or isinstance(charspan[1], bool)
            or not isinstance(charspan[0], int)
            or not isinstance(charspan[1], int)
            or not (0 <= charspan[0] < charspan[1] <= len(content))
        ):
            if len(pages) != 1:
                repaired = _docling_hyphen_merge_parts(content, provenance)
                if repaired is not None:
                    return repaired
                raise _MultiPageItem
            fallback = content.strip()
            return [(next(iter(pages)), fallback, None)] if fallback else []
        page_content = content[charspan[0] : charspan[1]].strip()
        if page_content:
            parts.append(
                (
                    page,
                    page_content,
                    _normalized_bbox(getattr(source, "bbox", None), document, page),
                )
            )
    return parts


def _docling_hyphen_merge_parts(
    content: str, provenance: tuple[Any, ...]
) -> list[tuple[int, str, None]] | None:
    """Repair Docling's pinned two-page hyphen-merge provenance exactly.

    The pinned reading-order model records the continuation span before it
    removes the trailing hyphen and joins without a separator.  That leaves the
    second public span shifted two characters beyond the sanitized payload.
    Accept only that exact, losslessly reversible topology; everything else
    remains fail-closed.
    """

    if len(provenance) != 2:
        return None
    first_span = getattr(provenance[0], "charspan", None)
    second_span = getattr(provenance[1], "charspan", None)
    if not all(
        isinstance(span, (list, tuple))
        and len(span) == 2
        and all(
            isinstance(value, int) and not isinstance(value, bool) for value in span
        )
        for span in (first_span, second_span)
    ):
        return None
    first_start, first_end = first_span
    second_start, second_end = second_span
    boundary = second_start - 2
    if (
        first_start != 0
        or first_end <= 1
        or second_start != first_end + 1
        or second_end - len(content) != 2
        or boundary != first_end - 1
        or second_end - second_start != len(content) - boundary
        or not (0 < boundary < len(content))
    ):
        return None
    first_content = content[:boundary]
    second_content = content[boundary:]
    if not first_content.strip() or not second_content.strip():
        return None
    if first_content + second_content != content:
        return None
    first_page = int(getattr(provenance[0], "page_no", 0))
    second_page = int(getattr(provenance[1], "page_no", 0))
    if first_page == second_page:
        return None
    return [
        (first_page, first_content, None),
        (second_page, second_content, None),
    ]


def _parent_ref(element: Any) -> str:
    parent = getattr(element, "parent", None)
    return str(getattr(parent, "cref", parent))


def _is_picture_item(element: Any) -> bool:
    from docling_core.types.doc import PictureItem

    return isinstance(element, PictureItem)


def _is_table_item(element: Any) -> bool:
    from docling_core.types.doc import TableItem

    return isinstance(element, TableItem)


def _configure_determinism() -> None:
    """Make candidate failure explicit instead of silently weakening determinism."""

    global _THREAD_POLICY_CONFIGURED
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    import numpy
    import torch

    random.seed(0)
    numpy.random.seed(0)
    torch.manual_seed(0)
    if not _THREAD_POLICY_CONFIGURED:
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        _THREAD_POLICY_CONFIGURED = True
    torch.use_deterministic_algorithms(True)


def _safe_source_path(value: Any) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError
    pure = PurePosixPath(value)
    if value.startswith("/") or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError
    root = Path(os.environ["ZINK_PDF_VAULT_ROOT"]).resolve(strict=True)
    candidate = root.joinpath(*pure.parts)
    check = root
    for part in candidate.relative_to(root).parts:
        check = check / part
        if check.is_symlink():
            raise ValueError
    resolved = candidate.resolve(strict=True)
    resolved.relative_to(root)
    if resolved.suffix.lower() != ".pdf":
        raise ValueError
    return resolved


def _normalized_bbox(value: Any, document: Any, page: int) -> list[float] | None:
    """Emit geometry only when one source box maps exactly to one item."""

    if isinstance(value, (list, tuple)) and len(value) == 4:
        values = [float(item) for item in value]
    else:
        try:
            page_size = document.pages[page].size
            width, height = float(page_size.width), float(page_size.height)
            top_left = value.to_top_left_origin(height)
            values = [
                float(top_left.l) / width,
                float(top_left.t) / height,
                float(top_left.r) / width,
                float(top_left.b) / height,
            ]
        except (AttributeError, KeyError, TypeError, ValueError, ZeroDivisionError):
            return None
    if not (0 <= values[0] < values[2] <= 1 and 0 <= values[1] < values[3] <= 1):
        return None
    return values


def _load_manifest() -> Mapping[str, Any]:
    path = Path(os.environ["ZINK_PDF_MANIFEST"])
    return _canonical_json(path.read_bytes())


def _runtime_identity(manifest: Mapping[str, Any]) -> Mapping[str, Any]:
    required = {
        "pdf_runtime_lock_digest",
        "distribution_versions",
        "artifact_digests",
        "runner_code_digest",
    }
    if not required.issubset(manifest):
        raise ValueError
    distributions = {
        name: importlib.metadata.version(name)
        for name in sorted(manifest["distribution_versions"])
    }
    if distributions != manifest["distribution_versions"]:
        raise ValueError
    artifact_digests = manifest["artifact_digests"]
    if not isinstance(artifact_digests, dict):
        raise ValueError
    for relative, expected in artifact_digests.items():
        if relative == "tesseract":
            path = Path(os.environ["ZINK_TESSERACT_BIN"])
        elif relative.startswith("tessdata/"):
            path = Path(os.environ["ZINK_TESSDATA_PREFIX"]) / relative.removeprefix("tessdata/")
        else:
            path = Path(os.environ["ZINK_PDF_ARTIFACTS_ROOT"]) / relative
        if _sha256_file(path) != expected:
            raise ValueError
    lock_digest = _sha256_file(Path(os.environ["ZINK_PDF_LOCK"]))
    if lock_digest != manifest["pdf_runtime_lock_digest"]:
        raise ValueError
    runner_code_digest = _tree_digest(Path(__file__).parent)
    if runner_code_digest != manifest["runner_code_digest"]:
        raise ValueError
    return {
        "pdf_runtime_lock_digest": lock_digest,
        "distributions": distributions,
        "artifact_digests": artifact_digests,
        "runner_code_digest": runner_code_digest,
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _tree_digest(root: Path) -> str:
    """Match the build-time runner digest without host-specific metadata."""
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "manifest.json":
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(_sha256_file(path)))
    return digest.hexdigest()


def _canonical_json(raw: bytes) -> Mapping[str, Any]:
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict) or _canonical_bytes(value) != raw:
        raise ValueError
    return value


def _canonical_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _error(code: str) -> Mapping[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "error",
        "code": code if code in _SAFE_ERRORS else "PDF_RUNTIME_FAILED",
    }


def _write_error(code: str) -> None:
    sys.stdout.buffer.write(_canonical_bytes(_error(code)))
    sys.stdout.buffer.flush()
