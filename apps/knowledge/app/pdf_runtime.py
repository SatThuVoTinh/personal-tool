"""Parent-side one-shot client for the isolated M4 PDF runtime."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import signal
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .pdf_foundation import canonical_json_bytes, canonical_vault_path

PROTOCOL_VERSION = "zink:pdf-runtime-protocol:v1"
SEGMENTATION_ALGORITHM_VERSION = 3
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_STDERR_BYTES = 1024 * 1024
SAFE_CHILD_ERROR_CODES = {
    "PDF_DOCUMENT_INVALID",
    "PDF_DOCUMENT_ENCRYPTED",
    "PDF_DOCUMENT_EMPTY",
    "PDF_MULTI_PAGE_ITEM_UNSUPPORTED",
    "PDF_RUNTIME_UNAVAILABLE",
    "PDF_RUNTIME_PROTOCOL_MISMATCH",
    "PDF_RUNTIME_MISMATCH",
    "PDF_RUNTIME_TIMEOUT",
    "PDF_RUNTIME_OUTPUT_LIMIT",
    "PDF_RUNTIME_OUTPUT_INVALID",
    "PDF_RUNTIME_FAILED",
    "PDF_PAGE_RANGE_UNSUPPORTED",
}


class PdfRuntimeError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def load_pdf_runtime_manifest(path: Path) -> Mapping[str, Any]:
    """Read only the non-secret, canonical supply-chain manifest."""
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PdfRuntimeError("PDF_RUNTIME_UNAVAILABLE") from error
    if not isinstance(value, dict) or _canonical_protocol_bytes(value) != raw:
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    required = {
        "artifact_digests",
        "distribution_versions",
        "locked_distribution_hashes",
        "hashed_requirements_digest",
        "model_artifact_revisions",
        "pdf_runtime_lock_digest",
        "protocol_version",
        "runner_code_digest",
        "tesseract_version",
        "tessdata_source_revision",
    }
    if not required.issubset(value) or value["protocol_version"] != PROTOCOL_VERSION:
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    return value


def processing_identity_for_runtime(
    parent_lock_path: Path,
    runtime_lock_path: Path,
    manifest_path: Path,
    inherited_identity: Mapping[str, Any],
) -> str:
    """Build the versioned R4 processing identity without host-specific paths."""
    manifest = load_pdf_runtime_manifest(manifest_path)
    runtime_lock_digest = _sha256_file(runtime_lock_path)
    if runtime_lock_digest != manifest["pdf_runtime_lock_digest"]:
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    identity = {
        "schema_version": 1,
        "python_runtime": {
            "implementation": sys.implementation.name,
            "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        },
        "parent_m3_lock_digest": _sha256_file(parent_lock_path),
        "pdf_runtime_lock_digest": runtime_lock_digest,
        "docling_version": manifest["distribution_versions"].get("docling"),
        "transformers_version": manifest["distribution_versions"].get("transformers"),
        "docling_model_artifact_digests": manifest["artifact_digests"],
        "docling_model_artifact_revisions": manifest["model_artifact_revisions"],
        "runtime_protocol": PROTOCOL_VERSION,
        "pdf_pipeline_version": 1,
        "ocr_languages": ["eng", "vie", "chi_sim"],
        "ocr_policy_version": 1,
        "render_policy_version": 1,
        "segmentation_algorithm_version": SEGMENTATION_ALGORITHM_VERSION,
        "runner_code_digest": manifest["runner_code_digest"],
        "parent_client_code_digest": _sha256_file(Path(__file__)),
        "tesseract_version": manifest["tesseract_version"],
        "tessdata_source_revision": manifest["tessdata_source_revision"],
        "inherited_m3_identity": dict(inherited_identity),
    }
    return hashlib.sha256(canonical_json_bytes(identity)).hexdigest()


def verify_runtime_probe(
    manifest_path: Path, runtime_lock_path: Path, probe: Mapping[str, Any], expected_digest: str
) -> None:
    """Compare child recomputation with parent-owned manifest and lock evidence."""
    manifest = load_pdf_runtime_manifest(manifest_path)
    if (
        probe.get("processing_identity_digest") != expected_digest
        or probe.get("pdf_runtime_lock_digest") != _sha256_file(runtime_lock_path)
        or probe.get("distributions") != manifest["distribution_versions"]
        or probe.get("artifact_digests") != manifest["artifact_digests"]
        or probe.get("runner_code_digest") != manifest["runner_code_digest"]
    ):
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")


@dataclass(frozen=True)
class PdfRuntimeSettings:
    python: Path
    module: str
    vault_root: Path
    artifacts_root: Path
    manifest_path: Path
    lock_path: Path
    tesseract_binary: Path
    tessdata_path: Path
    temp_root: Path


class PdfRuntimeClient:
    def __init__(self, settings: PdfRuntimeSettings) -> None:
        self._settings = settings
        self._invocation_lock = asyncio.Lock()

    async def probe(self, expected_processing_identity_digest: str, deadline: float) -> Mapping[str, Any]:
        response = await self._invoke(
            {"protocol_version": PROTOCOL_VERSION, "operation": "probe", "expected_processing_identity_digest": expected_processing_identity_digest},
            deadline,
        )
        verify_runtime_probe(
            self._settings.manifest_path,
            self._settings.lock_path,
            response,
            expected_processing_identity_digest,
        )
        return response

    async def extract_range(
        self,
        source_path: str,
        page_start: int,
        page_end: int,
        expected_processing_identity_digest: str,
        deadline: float,
    ) -> Mapping[str, Any]:
        if (
            isinstance(page_start, bool)
            or isinstance(page_end, bool)
            or page_start < 1
            or page_end < page_start
        ):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        canonical = canonical_vault_path(self._settings.vault_root, source_path, require_pdf=True)
        return await self._invoke(
            {
                "protocol_version": PROTOCOL_VERSION,
                "operation": "extract_range",
                "source_path": canonical,
                "page_start": page_start,
                "page_end": page_end,
                "expected_processing_identity_digest": expected_processing_identity_digest,
            },
            deadline,
        )

    async def preflight(
        self,
        source_path: str,
        expected_processing_identity_digest: str,
        deadline: float,
    ) -> Mapping[str, Any]:
        """Validate one source in the isolated pinned PDF runtime."""

        canonical = canonical_vault_path(self._settings.vault_root, source_path, require_pdf=True)
        return await self._invoke(
            {
                "protocol_version": PROTOCOL_VERSION,
                "operation": "preflight",
                "source_path": canonical,
                "expected_processing_identity_digest": expected_processing_identity_digest,
            },
            deadline,
        )

    async def _invoke(self, request: Mapping[str, Any], deadline: float) -> Mapping[str, Any]:
        async with self._invocation_lock:
            return await self._invoke_locked(request, deadline)

    async def _invoke_locked(
        self, request: Mapping[str, Any], deadline: float
    ) -> Mapping[str, Any]:
        payload = canonical_json_bytes(dict(request))
        if len(payload) > MAX_REQUEST_BYTES:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise PdfRuntimeError("PDF_RUNTIME_TIMEOUT")
        env = {
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PATH": "/usr/bin:/bin",
            "PYTHONHASHSEED": "0",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "ZINK_PDF_ARTIFACTS_ROOT": str(self._settings.artifacts_root),
            "ZINK_PDF_MANIFEST": str(self._settings.manifest_path),
            "ZINK_PDF_LOCK": str(self._settings.lock_path),
            "ZINK_PDF_TEMP_ROOT": str(self._settings.temp_root),
            "ZINK_PDF_VAULT_ROOT": str(self._settings.vault_root),
            "ZINK_TESSERACT_BIN": str(self._settings.tesseract_binary),
            "ZINK_TESSDATA_PREFIX": str(self._settings.tessdata_path),
        }
        try:
            process = await asyncio.create_subprocess_exec(
                str(self._settings.python),
                "-I",
                "-m",
                self._settings.module,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                start_new_session=True,
            )
        except OSError as error:
            raise PdfRuntimeError("PDF_RUNTIME_UNAVAILABLE") from error
        assert process.stdin is not None and process.stdout is not None and process.stderr is not None
        try:
            process.stdin.write(payload)
            await process.stdin.drain()
            process.stdin.close()
            stdout_task = asyncio.create_task(_read_capped(process.stdout, MAX_RESPONSE_BYTES))
            stderr_task = asyncio.create_task(_read_capped(process.stderr, MAX_STDERR_BYTES))
            try:
                try:
                    stdout, _ = await asyncio.wait_for(
                        asyncio.gather(stdout_task, stderr_task), timeout=remaining
                    )
                    await asyncio.wait_for(
                        process.wait(),
                        timeout=max(
                            0.01,
                            deadline - asyncio.get_running_loop().time(),
                        ),
                    )
                except TimeoutError as error:
                    await _terminate_child_group(process)
                    raise PdfRuntimeError("PDF_RUNTIME_TIMEOUT") from error
                except _OutputCapExceeded as error:
                    await _terminate_child_group(process)
                    raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_LIMIT") from error
            finally:
                for task in (stdout_task, stderr_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            if process.returncode != 0:
                raise PdfRuntimeError("PDF_RUNTIME_FAILED")
            return _validate_response(stdout, request)
        finally:
            if process.returncode is None:
                await _terminate_child_group(process)


class _OutputCapExceeded(RuntimeError):
    pass


async def _read_capped(reader: asyncio.StreamReader, cap: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while block := await reader.read(65536):
        total += len(block)
        if total > cap:
            raise _OutputCapExceeded
        chunks.append(block)
    return b"".join(chunks)


async def _terminate_child_group(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        if os.name != "posix":
            process.terminate()
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except TimeoutError:
            if os.name != "posix":
                process.kill()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await process.wait()
    # The direct child can exit before an OCR descendant.  Its dedicated
    # session lets us assert and clean only that invocation's process group.
    if os.name == "posix":
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return


def _validate_response(raw: bytes, request: Mapping[str, Any]) -> Mapping[str, Any]:
    try:
        decoded = raw.decode("utf-8")
        response = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID") from error
    if _canonical_protocol_bytes(response) != raw:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    if not isinstance(response, dict) or response.get("protocol_version") != PROTOCOL_VERSION:
        raise PdfRuntimeError("PDF_RUNTIME_PROTOCOL_MISMATCH")
    status = response.get("status")
    if status == "error":
        code = response.get("code")
        if set(response) != {"protocol_version", "status", "code"} or code not in SAFE_CHILD_ERROR_CODES:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        raise PdfRuntimeError(code)
    if status != "ok":
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    if request["operation"] == "probe":
        if set(response) != {
            "protocol_version",
            "status",
            "processing_identity_digest",
            "pdf_runtime_lock_digest",
            "distributions",
            "artifact_digests",
            "runner_code_digest",
        }:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if response.get("processing_identity_digest") != request.get("expected_processing_identity_digest"):
            raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
        for digest_key in ("processing_identity_digest", "pdf_runtime_lock_digest", "runner_code_digest"):
            value = response.get(digest_key)
            if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
                raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if not isinstance(response.get("distributions"), dict) or not isinstance(response.get("artifact_digests"), dict):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    if request["operation"] == "preflight":
        if set(response) != {"protocol_version", "status", "page_count"}:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        page_count = response.get("page_count")
        if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    if request["operation"] == "extract_range":
        if set(response) != {"protocol_version", "status", "page_start", "page_end", "items"}:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if response.get("page_start") != request["page_start"] or response.get("page_end") != request["page_end"]:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if not isinstance(response.get("items"), list):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        _validate_items(response["items"], request["page_start"], request["page_end"])
    return response


def _validate_items(items: list[Any], requested_start: int, requested_end: int) -> None:
    previous_ordinal = -1
    for item in items:
        if not isinstance(item, dict) or set(item) != {
            "kind", "ordinal", "content", "page_start", "page_end", "bbox"
        }:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        ordinal = item["ordinal"]
        page_start = item["page_start"]
        page_end = item["page_end"]
        if (
            isinstance(ordinal, bool)
            or not isinstance(ordinal, int)
            or ordinal <= previous_ordinal
            or item["kind"] not in {"text", "table", "figure_text"}
            or not isinstance(item["content"], str)
            or not item["content"]
            or isinstance(page_start, bool)
            or isinstance(page_end, bool)
            or not isinstance(page_start, int)
            or not isinstance(page_end, int)
            or not (requested_start <= page_start <= page_end <= requested_end)
        ):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        previous_ordinal = ordinal
        bbox = item["bbox"]
        if bbox is None:
            continue
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in bbox):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        left, top, right, bottom = (float(value) for value in bbox)
        if not (0.0 <= left < right <= 1.0 and 0.0 <= top < bottom <= 1.0):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")


def _canonical_protocol_bytes(value: Mapping[str, Any]) -> bytes:
    """Protocol JSON permits normalized bbox numbers; identity JSON does not."""
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as error:
        raise PdfRuntimeError("PDF_RUNTIME_UNAVAILABLE") from error
    return digest.hexdigest()
