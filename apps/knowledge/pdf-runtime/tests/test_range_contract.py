from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend

from zink_pdf_runtime.runner import (
    PROTOCOL_VERSION,
    _dispatch,
    _docling_extract,
)


class PageRangeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = Path(os.environ["ZINK_TEST_PDF"])

    def test_only_requested_backend_page_is_loaded(self) -> None:
        loaded: list[int] = []
        original = PyPdfiumDocumentBackend.load_page

        def traced(backend: PyPdfiumDocumentBackend, page_no: int):
            loaded.append(page_no)
            return original(backend, page_no)

        with patch.object(PyPdfiumDocumentBackend, "load_page", traced):
            items = _docling_extract(self.fixture, 2, 2)

        self.assertEqual(loaded, [1])
        self.assertTrue(items)
        self.assertTrue(all(item["page_start"] == 2 and item["page_end"] == 2 for item in items))

    def test_protocol_rejects_unknown_fields_and_boolean_pages(self) -> None:
        base = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "extract_range",
            "source_path": "02. Books/native.pdf",
            "page_start": 1,
            "page_end": 1,
            "expected_processing_identity_digest": "a" * 64,
        }
        self.assertEqual(_dispatch({**base, "unexpected": True})["code"], "PDF_RUNTIME_OUTPUT_INVALID")
        self.assertEqual(_dispatch({**base, "page_start": True})["code"], "PDF_RUNTIME_OUTPUT_INVALID")

if __name__ == "__main__":
    unittest.main()
