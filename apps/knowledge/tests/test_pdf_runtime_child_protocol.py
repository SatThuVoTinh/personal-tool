"""The PDF child runtime's own protocol behaviour, executed by the parent lane.

F-237 (R7-D2-01): the `pdf-runtime` child package had no executing lane at
all -- the parent suite stubs the child, the CI job deliberately does not
install it, and the child's own suite needs the `docling` closure -- so the
code that decides WHAT THE PARENT IS TOLD was never run.

F-283 (R7-C3-02) and F-286 (R7-C3-05) are the two defects of that code
this file executes. The child is driven in a SEPARATE PROCESS, exactly as
the deployment drives it, so the parent's own isolation invariant (the
child's runtime path is never on the parent's `sys.path`) still holds. The
`docling` conversion itself is NOT RUN in this lane and is reported as
such.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pdf_foundation import canonical_json_bytes
from app.pdf_runtime import PROTOCOL_VERSION as PARENT_PROTOCOL_VERSION
from app.pdf_runtime import (
    PdfRuntimeClient,
    PdfRuntimeError,
    PdfRuntimeSettings,
    _validate_response,
)

CHILD_SRC = Path(__file__).resolve().parents[1] / "pdf-runtime" / "src"

EXTRACT_REQUEST = {
    "protocol_version": "zink:pdf-runtime-protocol:v1",
    "operation": "extract_range",
    "source_path": "book.pdf",
    "page_start": 1,
    "page_end": 2,
    "expected_processing_identity_digest": "a" * 64,
    # F-284 (R7-C3-03): the request carries the budget the parent has left
    # for this extraction.
    "deadline_budget_seconds": 900,
}

PROBE_REQUEST = {
    "protocol_version": "zink:pdf-runtime-protocol:v1",
    "operation": "probe",
    "expected_processing_identity_digest": "a" * 64,
}

# The child program runs in its own process and prints one canonical JSON
# object: the response the child would have written to stdout.
CHILD_PROGRAM = """
import json, sys
from unittest.mock import patch
from zink_pdf_runtime.ocr import OcrRuntimeError
from zink_pdf_runtime.runner import PROTOCOL_VERSION, _dispatch

request = json.loads(sys.argv[1])
mode = sys.argv[2]
if mode == "probe":
    identity = {
        "pdf_runtime_lock_digest": "b" * 64,
        "distributions": {},
        "artifact_digests": {},
        "runner_code_digest": "c" * 64,
    }
    with (
        patch("zink_pdf_runtime.runner._load_manifest", return_value={}),
        patch("zink_pdf_runtime.runner._runtime_identity", return_value=identity),
    ):
        response = _dispatch(request)
else:
    ok_probe = {
        "protocol_version": PROTOCOL_VERSION,
        "status": "ok",
        "pdf_runtime_lock_digest": "b" * 64,
        "distributions": {},
        "artifact_digests": {},
        "runner_code_digest": "c" * 64,
    }
    failure = sys.argv[3]
    error = (
        OcrRuntimeError(failure)
        if failure.startswith("PDF_")
        else RuntimeError(failure)
    )
    with (
        patch("zink_pdf_runtime.runner._probe", return_value=ok_probe),
        patch("zink_pdf_runtime.runner._safe_source_path", return_value="book.pdf"),
        patch("zink_pdf_runtime.runner._docling_extract", side_effect=error),
    ):
        response = _dispatch(request)
sys.stdout.write(json.dumps(response, sort_keys=True))
"""


def run_child(request: dict, mode: str, failure: str = "") -> dict:
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(CHILD_SRC), environment.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            CHILD_PROGRAM,
            json.dumps(request),
            mode,
            failure,
        ],
        capture_output=True,
        text=True,
        env=environment,
        timeout=120,
    )
    if completed.returncode != 0:
        raise AssertionError(f"the child program failed: {completed.stderr}")
    return json.loads(completed.stdout)


class ChildErrorCodeTests(unittest.TestCase):
    """F-283 (R7-C3-02): the codes the parent classifies on must survive."""

    def test_the_ocr_deadline_survives_the_child_boundary(self) -> None:
        response = run_child(EXTRACT_REQUEST, "extract", "PDF_RUNTIME_TIMEOUT")
        self.assertEqual(response["status"], "error")
        self.assertEqual(response["code"], "PDF_RUNTIME_TIMEOUT")

    def test_the_ocr_output_cap_survives_the_child_boundary(self) -> None:
        response = run_child(EXTRACT_REQUEST, "extract", "PDF_RUNTIME_OUTPUT_LIMIT")
        self.assertEqual(response["status"], "error")
        self.assertEqual(response["code"], "PDF_RUNTIME_OUTPUT_LIMIT")

    def test_a_genuine_crash_is_still_the_generic_failure(self) -> None:
        response = run_child(EXTRACT_REQUEST, "extract", "boom")
        self.assertEqual(response["status"], "error")
        self.assertEqual(response["code"], "PDF_RUNTIME_FAILED")


class ChildIdentityTests(unittest.TestCase):
    """F-286 (R7-C3-05): the identity echo verified nothing."""

    def test_the_probe_reports_recomputed_evidence_only(self) -> None:
        response = run_child(PROBE_REQUEST, "probe")
        self.assertEqual(response["status"], "ok")
        self.assertNotIn("processing_identity_digest", response)
        self.assertEqual(response["runner_code_digest"], "c" * 64)

    def test_the_parent_refuses_a_probe_that_echoes_the_identity(self) -> None:
        # The boundary is closed: a response that carries the identity back
        # is not a response this protocol version accepts.
        echoed = {
            "protocol_version": PARENT_PROTOCOL_VERSION,
            "status": "ok",
            "processing_identity_digest": "a" * 64,
            "pdf_runtime_lock_digest": "b" * 64,
            "distributions": {},
            "artifact_digests": {},
            "runner_code_digest": "c" * 64,
        }

        with self.assertRaises(PdfRuntimeError) as caught:
            _validate_response(json.dumps(echoed, sort_keys=True).encode("utf-8"), PROBE_REQUEST)
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")


class ParentExtractRequestTests(unittest.IsolatedAsyncioTestCase):
    """F-437 (R9-L09-1): the parent's remaining budget is identity-safe."""

    @staticmethod
    def client() -> PdfRuntimeClient:
        return PdfRuntimeClient(
            PdfRuntimeSettings(
                python=Path("/opt/pdf-runtime/.venv/bin/python"),
                module="zink_pdf_runtime",
                vault_root=Path("/vault"),
                artifacts_root=Path("/opt/pdf-artifacts"),
                manifest_path=Path("/opt/pdf-artifacts/manifest.json"),
                lock_path=Path("/opt/pdf-runtime/uv.lock"),
                tesseract_binary=Path("/usr/bin/tesseract"),
                tessdata_path=Path("/usr/share/tesseract-ocr/5/tessdata"),
                temp_root=Path("/tmp/pdf-runtime"),
            )
        )

    async def test_a_fractional_remaining_budget_reaches_the_spawn_as_an_integer(self) -> None:
        """A float budget is refused by the canonical encoder before the spawn.

        The request is serialised with the identity encoder, which admits no
        floats. A remaining budget computed from the event-loop clock is
        fractional in the general case, so the value that reaches the child
        must be an integer that the child's own positive-budget validation
        still accepts.
        """

        client = self.client()
        seen: dict[str, object] = {}
        spawns: list[tuple[object, ...]] = []
        encoder = canonical_json_bytes

        def recording_encoder(value: dict[str, object]) -> bytes:
            seen["budget"] = value.get("deadline_budget_seconds")
            return encoder(value)

        async def spawn(*args: object, **kwargs: object) -> None:
            spawns.append(args)
            raise OSError("spawn reached")

        with (
            patch("app.pdf_runtime.canonical_vault_path", return_value="book.pdf"),
            patch("app.pdf_runtime.canonical_json_bytes", side_effect=recording_encoder),
            patch("app.pdf_runtime.asyncio.create_subprocess_exec", side_effect=spawn),
        ):
            deadline = asyncio.get_running_loop().time() + 119.999
            with self.assertRaises(PdfRuntimeError) as caught:
                await client.extract_range("book.pdf", 1, 1, "a" * 64, deadline)

        # The encoder passed (otherwise it would have raised
        # PDF_IDENTITY_INVALID) and the request reached the spawn, where the
        # deliberately failing spawn becomes the runtime-unavailable code.
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_UNAVAILABLE")
        self.assertEqual(len(spawns), 1)
        self.assertIs(type(seen["budget"]), int)
        self.assertGreater(seen["budget"], 0)

    async def test_a_sub_second_remaining_budget_still_sends_a_positive_integer(self) -> None:
        """A positive budget below one second must not truncate to zero."""

        client = self.client()
        seen: dict[str, object] = {}
        encoder = canonical_json_bytes

        def recording_encoder(value: dict[str, object]) -> bytes:
            seen["budget"] = value.get("deadline_budget_seconds")
            return encoder(value)

        async def spawn(*args: object, **kwargs: object) -> None:
            raise OSError("spawn reached")

        with (
            patch("app.pdf_runtime.canonical_vault_path", return_value="book.pdf"),
            patch("app.pdf_runtime.canonical_json_bytes", side_effect=recording_encoder),
            patch("app.pdf_runtime.asyncio.create_subprocess_exec", side_effect=spawn),
        ):
            deadline = asyncio.get_running_loop().time() + 0.5
            with self.assertRaises(PdfRuntimeError) as caught:
                await client.extract_range("book.pdf", 1, 1, "a" * 64, deadline)

        self.assertEqual(caught.exception.code, "PDF_RUNTIME_UNAVAILABLE")
        self.assertIs(type(seen["budget"]), int)
        self.assertGreaterEqual(seen["budget"], 1)


if __name__ == "__main__":
    unittest.main()
