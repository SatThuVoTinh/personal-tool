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

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from app.pdf_runtime import PROTOCOL_VERSION as PARENT_PROTOCOL_VERSION
from app.pdf_runtime import PdfRuntimeError, _validate_response

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


if __name__ == "__main__":
    unittest.main()
