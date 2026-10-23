"""Parent-side one-shot client for the isolated M4 PDF runtime."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import signal
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, NoReturn

from .pdf_foundation import canonical_json_bytes, canonical_vault_path

PROTOCOL_VERSION = "zink:pdf-runtime-protocol:v1"
SEGMENTATION_ALGORITHM_VERSION = 4
CHILD_TERMINATION_GRACE_SECONDS = 5
CHILD_KILL_REAP_SECONDS = 5
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_STDERR_BYTES = 1024 * 1024
# R24: how much child stderr is worth carrying into an operator-facing
# message. Bounded so a chatty child cannot inflate a stored error record.
_CHILD_DETAIL_LIMIT = 512
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
    def __init__(self, code: str, detail: str | None = None) -> None:
        # R24: `code` is the stable value every caller switches on and is
        # unchanged. `detail` is operator-facing diagnosis only; it is bounded
        # and sanitised so it can never carry an unbounded child string into a
        # log line or a stored error record.
        super().__init__(code if detail is None else f"{code}: {detail}")
        self.code = code
        self.detail = detail


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
    manifest_path: Path, runtime_lock_path: Path, probe: Mapping[str, Any]
) -> None:
    """Compare child recomputation with parent-owned manifest and lock evidence.

    F-286 (R7-C3-05): the child used to echo the processing identity it
    was sent and the parent compared that echo back, which could not fail.
    The identity claim is dropped here: what is verified is the evidence the
    child RECOMPUTED -- the lock digest, the distribution versions, the
    artifact digests and the runner code digest.

    F-306 (R7-E1-01): the two supply-chain fields were demanded to exist
    and were never recomputed, so a stale artifact tree paired with edited
    revision strings still yielded a fresh processing identity and a passing
    probe. The locked distribution hashes are now checked against the
    versions the child actually reports, and the hashed requirements digest
    is recomputed from the file the lock names.
    """
    manifest = load_pdf_runtime_manifest(manifest_path)
    if (
        probe.get("pdf_runtime_lock_digest") != _sha256_file(runtime_lock_path)
        or probe.get("distributions") != manifest["distribution_versions"]
        or probe.get("artifact_digests") != manifest["artifact_digests"]
        or probe.get("runner_code_digest") != manifest["runner_code_digest"]
    ):
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    _verify_locked_distributions(manifest, probe)
    _verify_hashed_requirements(manifest, runtime_lock_path)


def _verify_locked_distributions(
    manifest: Mapping[str, Any], probe: Mapping[str, Any]
) -> None:
    """Every locked distribution must be installed at the locked version.

    F-306 (R7-E1-01): the manifest recorded the lock's hashes and the
    child reported its installed versions, and nothing compared them. The
    comparison runs in the direction that cannot be satisfied by a renamed
    or downgraded distribution: every package the lock pins is present, at
    the version the lock pins.
    """

    locked = manifest.get("locked_distribution_hashes")
    distributions = manifest.get("distribution_versions")
    if (
        not isinstance(locked, dict)
        or not locked
        or not isinstance(distributions, dict)
        or probe.get("distributions") != distributions
    ):
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    for key, hashes in locked.items():
        name, separator, version = str(key).partition("==")
        if not separator or not name or not version or not hashes:
            raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
        installed = distributions.get(_normalise_distribution_name(name))
        if installed is None or installed != version:
            raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")


def _verify_hashed_requirements(
    manifest: Mapping[str, Any], runtime_lock_path: Path
) -> None:
    """Recompute the hashed requirements digest the manifest declares.

    F-306 (R7-E1-01): the digest was demanded to exist and never
    recomputed, so the file the lock names could be edited after the
    manifest was written.
    """

    expected = manifest.get("hashed_requirements_digest")
    if not isinstance(expected, str) or len(expected) != 64:
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")
    requirements = runtime_lock_path.parent / "requirements.txt"
    if _sha256_file(requirements) != expected:
        raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")


def _normalise_distribution_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).casefold()


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

    async def probe(
        self,
        expected_processing_identity_digest: str,
        deadline: float,
        lock_timeout: float | None = None,
    ) -> Mapping[str, Any]:
        response = await self._invoke(
            {"protocol_version": PROTOCOL_VERSION, "operation": "probe", "expected_processing_identity_digest": expected_processing_identity_digest},
            deadline,
            lock_timeout=lock_timeout,
        )
        verify_runtime_probe(
            self._settings.manifest_path,
            self._settings.lock_path,
            response,
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
        # F-284 (R7-C3-03): the child receives the budget this invocation has
        # left. Its own worst case -- thirty-two regions on each of four pages,
        # at ninety seconds each -- is twelve times the parent's operation
        # ceiling, so without this budget the only real bound was the
        # process-group kill, and a timeout said nothing about how far the
        # extraction got.
        budget = deadline - asyncio.get_running_loop().time()
        if budget <= 0:
            raise PdfRuntimeError("PDF_RUNTIME_TIMEOUT")
        # F-437 (R9-L09-1): the request is serialised with the canonical
        # identity encoder, which refuses every float before the child is
        # spawned. Round the remaining budget UP to the next whole second so
        # every positive remainder (including a sub-second one) becomes a
        # positive integer the child's own validation accepts. The parent's
        # deadline still bounds the invocation.
        return await self._invoke(
            {
                "protocol_version": PROTOCOL_VERSION,
                "operation": "extract_range",
                "source_path": canonical,
                "page_start": page_start,
                "page_end": page_end,
                "expected_processing_identity_digest": expected_processing_identity_digest,
                "deadline_budget_seconds": math.ceil(budget),
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

    async def _invoke(
        self,
        request: Mapping[str, Any],
        deadline: float,
        lock_timeout: float | None = None,
    ) -> Mapping[str, Any]:
        if lock_timeout is None:
            async with self._invocation_lock:
                return await self._invoke_locked(request, deadline)
        # M11/T1-R1 3.7: a caller that cannot wait for an in-flight extraction
        # bounds only the acquisition. `asyncio.Lock.acquire()` is not
        # re-entrant, so the timeout branch releases explicitly.
        try:
            await asyncio.wait_for(self._invocation_lock.acquire(), lock_timeout)
        except TimeoutError as timeout:
            raise PdfRuntimeError(
                "PDF_RUNTIME_BUSY",
                f"invocation lock unavailable within {lock_timeout}s",
            ) from timeout
        try:
            return await self._invoke_locked(request, deadline)
        finally:
            self._invocation_lock.release()

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
            # M10/T2-R24: stderr is drained, not capped-and-aborted.
            #
            # The cap existed only to bound memory, but exceeding it raised
            # _OutputCapExceeded, which terminated the child and reported
            # PDF_RUNTIME_OUTPUT_LIMIT -- even though the parent's own
            # MAX_RESPONSE_BYTES had not been touched and the response was
            # about to be perfectly valid. The stderr bytes were discarded at
            # the call site anyway, so the parent destroyed a healthy
            # invocation on the strength of data it then threw away.
            #
            # Proven by execution against the real client: a child that
            # returned SUCCESS for 7 pages was killed when ~1.8 MiB of
            # per-page torch/numpy UserWarning text preceded it on stderr.
            #
            # Reading to EOF while retaining only the first MAX_STDERR_BYTES
            # keeps the memory bound AND keeps the pipe drained so the child
            # can never block on a full stderr buffer. The overall deadline
            # still bounds a child that spews indefinitely.
            stderr_task = asyncio.create_task(
                _read_capped(process.stderr, MAX_STDERR_BYTES, abort_on_overflow=False)
            )
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
                # R24: carry why the child died, not just that it did.
                stderr_bytes = b""
                if stderr_task.done() and not stderr_task.cancelled():
                    carried = stderr_task.exception()
                    if carried is None:
                        stderr_bytes = stderr_task.result()
                raise PdfRuntimeError(
                    "PDF_RUNTIME_FAILED",
                    _child_failure_detail(process.returncode, stderr_bytes),
                )
            return _validate_response(stdout, request)
        finally:
            if process.returncode is None:
                await _terminate_child_group(process)


class _OutputCapExceeded(RuntimeError):
    pass


async def _read_capped(
    reader: asyncio.StreamReader, cap: int, *, abort_on_overflow: bool = True
) -> bytes:
    """Read to EOF, retaining at most `cap` bytes.

    With `abort_on_overflow` the overflow is fatal, which is correct for the
    response stream: it is the payload, and exceeding its cap means the child
    is not producing output this parent can use. Without it the reader keeps
    draining but stops retaining, which is correct for a diagnostic stream
    whose contents are discarded anyway.
    """
    chunks: list[bytes] = []
    total = 0
    retained = 0
    while block := await reader.read(65536):
        total += len(block)
        if abort_on_overflow and total > cap:
            raise _OutputCapExceeded
        # R24: retain exactly the first `cap` bytes, slicing the block that
        # straddles the limit. Stopping only once a WHOLE block had pushed the
        # total over the cap retained nothing at all whenever a single block was
        # larger than the cap, which made the retained excerpt useless for
        # diagnosis on exactly the streams most likely to overflow.
        if retained < cap:
            keep = block[: cap - retained]
            chunks.append(keep)
            retained += len(keep)
    return b"".join(chunks)


def _child_failure_detail(returncode: int | None, stderr: bytes) -> str | None:
    """A bounded, single-line summary of how a child died.

    R24: the exit code and the stderr text were both in hand and both
    discarded, so an OOM kill (exit -9) and a missing model artifact
    (exit 1) produced byte-identical, unattributable `PDF_RUNTIME_FAILED`.
    The module logs nothing at all, so this string was the only diagnostic
    that could ever have reached the operator.
    """
    parts: list[str] = []
    if returncode is not None:
        parts.append(f"exit={returncode}")
    tail = stderr.decode("utf-8", errors="replace").strip()
    if tail:
        if len(tail) > _CHILD_DETAIL_LIMIT:
            tail = tail[-_CHILD_DETAIL_LIMIT:]
        parts.append("stderr=" + " ".join(tail.split()))
    if not parts:
        return None
    return "; ".join(parts)[:_CHILD_DETAIL_LIMIT]

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
            await asyncio.wait_for(
                process.wait(), timeout=CHILD_TERMINATION_GRACE_SECONDS
            )
        except TimeoutError:
            if os.name != "posix":
                process.kill()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                await asyncio.wait_for(process.wait(), timeout=CHILD_KILL_REAP_SECONDS)
            except TimeoutError:
                _fail_stop_unreaped_child()
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


def _fail_stop_unreaped_child() -> NoReturn:
    os._exit(70)


def _validate_response(raw: bytes, request: Mapping[str, Any]) -> Mapping[str, Any]:
    try:
        decoded = raw.decode("utf-8")
        response = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID") from error
    # M10/T2-R24: this byte-exactness round trip was OUTSIDE the try above,
    # so it could raise something that is not a PdfRuntimeError.
    #
    # json.loads accepts the non-standard NaN / Infinity / -Infinity literals
    # and out-of-range exponents such as 1e400 as ordinary Python floats,
    # without raising. Those then reach the re-encode below, whose
    # allow_nan=False raises ValueError, and a lone surrogate raises
    # UnicodeEncodeError from .encode("utf-8"). PdfRuntimeError derives from
    # RuntimeError, not ValueError, so neither was converted.
    #
    # Proven by execution: a child emitting {"bbox": [NaN, ...]},
    # {"bbox": [Infinity, ...]}, {"page_count": 1e400} or "\\ud800" each
    # escaped _validate_response as ValueError / UnicodeEncodeError.
    #
    # The consequence differed by call site, which is why this matters: in
    # the preflight path pdf_pipeline catches only PdfRuntimeError, so the
    # ValueError escaped build() entirely and surfaced upstream as an
    # unattributed DOCUMENT_INDEXING_FAILURE; in the batch path the blanket
    # except did catch it but reported a generic PDF_RUNTIME_FAILED, hiding
    # the fact that the child had violated the protocol. Either way a
    # protocol violation was not reported as one.
    try:
        canonical = _canonical_protocol_bytes(response)
    except (ValueError, TypeError, UnicodeEncodeError) as error:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID") from error
    if canonical != raw:
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
            "pdf_runtime_lock_digest",
            "distributions",
            "artifact_digests",
            "runner_code_digest",
        }:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        # F-286 (R7-C3-05): the response carries no processing identity, so
        # there is nothing here that could be compared back to the request.
        for digest_key in ("pdf_runtime_lock_digest", "runner_code_digest"):
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
        if set(response) != {
            "protocol_version",
            "status",
            "page_start",
            "page_end",
            "items",
            "covered_pages",
            "blank_pages",
        }:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if response.get("page_start") != request["page_start"] or response.get("page_end") != request["page_end"]:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        if not isinstance(response.get("items"), list):
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        _validate_items(response["items"], request["page_start"], request["page_end"])
        # F-282 (R7-C3-01): a requested page must either be covered by the
        # response or be proven blank by the conversion. A page that is
        # neither is a page that would have disappeared from the index while
        # the build was marked complete.
        _validate_page_coverage(
            response.get("covered_pages"),
            response.get("blank_pages"),
            request["page_start"],
            request["page_end"],
            response["items"],
        )
    return response


def _validate_page_coverage(
    covered: Any,
    blank: Any,
    requested_start: int,
    requested_end: int,
    items: list[Any],
) -> None:
    """Every requested page must be covered or proven blank.

    F-282 (R7-C3-01): the child names the pages its items came from and the
    pages the successful conversion proved empty. A page in neither set was
    never accounted for, so the batch is refused instead of losing the page.
    """

    requested = set(range(requested_start, requested_end + 1))
    covered_pages = _validated_page_set(covered, requested)
    blank_pages = _validated_page_set(blank, requested)
    if covered_pages & blank_pages:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    if covered_pages | blank_pages != requested:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    item_pages = {int(item["page_start"]) for item in items}
    if item_pages != covered_pages:
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")


def _validated_page_set(value: Any, requested: set[int]) -> set[int]:
    if not isinstance(value, list):
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    pages: set[int] = set()
    for entry in value:
        if isinstance(entry, bool) or not isinstance(entry, int) or entry not in requested:
            raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
        pages.add(entry)
    if list(value) != sorted(value):
        raise PdfRuntimeError("PDF_RUNTIME_OUTPUT_INVALID")
    return pages


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
