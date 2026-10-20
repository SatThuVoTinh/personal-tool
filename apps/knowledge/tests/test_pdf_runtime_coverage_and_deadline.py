"""F-282 (R7-C3-01) and F-284 (R7-C3-03): the PDF extraction's own contract.

F-282: the child asked the converter for a page range and materialised
whatever items came back. It never read the conversion's own outcome, so a
page that produced nothing disappeared from the index while the build was
marked complete; the parent validated only the shape of each item and could
not tell "this page is blank" from "this page was skipped".

F-284: every recognised region received its own fresh ninety-second deadline,
thirty-two regions pass the per-page guard and four pages make a batch, so the
legal worst case was 11520 seconds against a 900 second operation ceiling. The
request carried no deadline, so the child could not compose the parent's
ceiling at all.

The child is driven in a SEPARATE PROCESS, exactly as the deployment drives
it, so the parent's isolation invariant (the child's runtime path is never on
the parent's sys.path) still holds. The Docling conversion itself is NOT RUN
in this lane and is reported as such.
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

REQUEST = {
    "protocol_version": "zink:pdf-runtime-protocol:v1",
    "operation": "extract_range",
    "source_path": "book.pdf",
    "page_start": 5,
    "page_end": 8,
    "expected_processing_identity_digest": "a" * 64,
    "deadline_budget_seconds": 900,
}

CHILD_PROGRAM = """
import json, sys, time
from unittest.mock import patch

from zink_pdf_runtime import runner
from zink_pdf_runtime.ocr import OcrRuntimeError, region_deadline, require_deadline

request = json.loads(sys.argv[1])
mode = sys.argv[2]

ok_probe = {
    "protocol_version": runner.PROTOCOL_VERSION,
    "status": "ok",
    "pdf_runtime_lock_digest": "b" * 64,
    "distributions": {},
    "artifact_digests": {},
    "runner_code_digest": "c" * 64,
}


def item(page):
    return {
        "kind": "text",
        "ordinal": page,
        "content": "body",
        "page_start": page,
        "page_end": page,
        "bbox": None,
    }


class Result:
    def __init__(self, status):
        self.status = status
        self.document = object()


if mode == "coverage":
    items = [item(5), item(6), item(8)]
    with (
        patch("zink_pdf_runtime.runner._probe", return_value=ok_probe),
        patch("zink_pdf_runtime.runner._safe_source_path", return_value="book.pdf"),
        patch("zink_pdf_runtime.runner._docling_extract", return_value=Result("success")),
        patch("zink_pdf_runtime.runner._materialize_document_items", return_value=items),
    ):
        response = runner._dispatch(request)
elif mode == "partial":
    with (
        patch("zink_pdf_runtime.runner._probe", return_value=ok_probe),
        patch("zink_pdf_runtime.runner._safe_source_path", return_value="book.pdf"),
        patch("zink_pdf_runtime.runner._docling_extract", return_value=Result("partial_success")),
        patch("zink_pdf_runtime.runner._materialize_document_items", return_value=[item(5)]),
    ):
        response = runner._dispatch(request)
elif mode == "deadline":
    overall = time.monotonic() + 5.0
    regions = [region_deadline(overall) for _ in range(32 * 4)]
    refused = False
    try:
        require_deadline(None)
    except OcrRuntimeError as error:
        refused = error.code == "PDF_RUNTIME_TIMEOUT"
    response = {
        "every_region_within_overall": all(value <= overall for value in regions),
        "no_region_past_overall": max(regions) <= overall,
        "refused_without_a_deadline": refused,
    }
else:
    raise SystemExit("unknown mode")

sys.stdout.write(json.dumps(response, sort_keys=True))
"""


def run_child(request: dict, mode: str) -> dict:
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
        ],
        capture_output=True,
        text=True,
        env=environment,
        timeout=120,
    )
    if completed.returncode != 0:
        raise AssertionError(f"the child program failed: {completed.stderr}")
    return json.loads(completed.stdout)


def item(page: int) -> dict:
    return {
        "kind": "text",
        "ordinal": page,
        "content": "body",
        "page_start": page,
        "page_end": page,
        "bbox": None,
    }


def canonical(value: dict) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


class ChildCoverageTests(unittest.TestCase):
    """F-282 (R7-C3-01): the response names the pages it covered."""

    def test_a_page_that_produced_no_item_is_reported_as_blank(self) -> None:
        response = run_child(REQUEST, "coverage")

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["covered_pages"], [5, 6, 8])
        self.assertEqual(response["blank_pages"], [7])

    def test_a_conversion_that_did_not_succeed_fails_closed(self) -> None:
        response = run_child(REQUEST, "partial")

        self.assertEqual(response["status"], "error")
        self.assertEqual(response["code"], "PDF_RUNTIME_FAILED")


class ChildDeadlineTests(unittest.TestCase):
    """F-284 (R7-C3-03): the request carries the parent's budget."""

    def test_a_request_without_a_budget_is_refused(self) -> None:
        without_budget = {
            key: value for key, value in REQUEST.items() if key != "deadline_budget_seconds"
        }
        response = run_child(without_budget, "coverage")

        self.assertEqual(response["status"], "error")
        self.assertEqual(response["code"], "PDF_RUNTIME_OUTPUT_INVALID")

    def test_every_ocr_region_is_bounded_by_the_extraction_deadline(self) -> None:
        result = run_child(REQUEST, "deadline")

        self.assertTrue(result["every_region_within_overall"])
        self.assertTrue(result["no_region_past_overall"])
        self.assertTrue(result["refused_without_a_deadline"])


class ParentCoverageTests(unittest.TestCase):
    """F-282 (R7-C3-01): the parent refuses an unaccounted page."""

    def response(self, **overrides: object) -> bytes:
        response = {
            "protocol_version": PARENT_PROTOCOL_VERSION,
            "status": "ok",
            "page_start": 5,
            "page_end": 8,
            "items": [item(5), item(6), item(8)],
            "covered_pages": [5, 6, 8],
            "blank_pages": [7],
        }
        response.update(overrides)
        return canonical(response)

    def test_a_batch_that_names_every_page_is_accepted(self) -> None:
        accepted = _validate_response(self.response(), REQUEST)
        self.assertEqual(accepted["covered_pages"], [5, 6, 8])

    def test_a_batch_that_omits_a_requested_page_is_refused(self) -> None:
        with self.assertRaises(PdfRuntimeError) as caught:
            _validate_response(
                self.response(covered_pages=[5, 6, 8], blank_pages=[]), REQUEST
            )
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")

    def test_a_batch_that_claims_a_page_it_did_not_cover_is_refused(self) -> None:
        with self.assertRaises(PdfRuntimeError) as caught:
            _validate_response(
                self.response(covered_pages=[5, 6, 7, 8], blank_pages=[]), REQUEST
            )
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")

    def test_a_batch_that_reports_a_page_as_covered_without_items_is_refused(self) -> None:
        with self.assertRaises(PdfRuntimeError) as caught:
            _validate_response(
                self.response(covered_pages=[5, 6, 7, 8], blank_pages=[]), REQUEST
            )
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")


if __name__ == "__main__":
    unittest.main()