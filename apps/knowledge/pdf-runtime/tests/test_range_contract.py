from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend

from zink_pdf_runtime.runner import (
    PROTOCOL_VERSION,
    _dispatch,
    _docling_extract,
    _page_local_content,
)


class PageRangeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        configured = os.environ.get("ZINK_TEST_PDF")
        if configured:
            cls.fixture = Path(configured)
            cls.fixture_directory = None
        else:
            cls.fixture_directory = tempfile.TemporaryDirectory()
            cls.fixture = Path(cls.fixture_directory.name) / "native.pdf"
            _write_native_fixture(cls.fixture)

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.fixture_directory is not None:
            cls.fixture_directory.cleanup()

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

    def test_preflight_rejects_unknown_fields_before_opening_pdf(self) -> None:
        response = _dispatch({
            "protocol_version": PROTOCOL_VERSION,
            "operation": "preflight",
            "source_path": "02. Books/native.pdf",
            "expected_processing_identity_digest": "a" * 64,
            "unexpected": True,
        })
        self.assertEqual(response["code"], "PDF_RUNTIME_OUTPUT_INVALID")

    def test_preflight_rejects_an_empty_password_security_handler(self) -> None:
        captured: dict[str, object] = {}

        class Document:
            raw = object()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def __len__(self):
                return 1

        def open_document(path, password=None):
            captured["path"], captured["password"] = path, password
            return Document()

        fake_pdfium = types.ModuleType("pypdfium2")
        fake_pdfium.PdfDocument = open_document
        fake_pdfium.PdfiumError = RuntimeError
        fake_raw = types.ModuleType("pypdfium2.raw")
        fake_raw.FPDF_ERR_PASSWORD = 4
        fake_raw.FPDF_ERR_SECURITY = 5
        fake_raw.FPDF_GetSecurityHandlerRevision = lambda _raw: 4
        fake_pdfium.raw = fake_raw
        request = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "preflight",
            "source_path": "02. Books/native.pdf",
            "expected_processing_identity_digest": "a" * 64,
        }
        with patch("zink_pdf_runtime.runner._probe", return_value={"status": "ok"}), patch(
            "zink_pdf_runtime.runner._safe_source_path", return_value=Path("/fixture.pdf")
        ), patch.dict(sys.modules, {"pypdfium2": fake_pdfium, "pypdfium2.raw": fake_raw}):
            response = _dispatch(request)
        self.assertEqual(response["code"], "PDF_DOCUMENT_ENCRYPTED")
        self.assertEqual(captured["password"], None)

    def test_preflight_normalizes_password_and_security_load_errors(self) -> None:
        class PdfiumError(RuntimeError):
            def __init__(self, err_code: int) -> None:
                self.err_code = err_code

        fake_raw = types.ModuleType("pypdfium2.raw")
        fake_raw.FPDF_ERR_PASSWORD = 4
        fake_raw.FPDF_ERR_SECURITY = 5
        fake_raw.FPDF_GetSecurityHandlerRevision = lambda _raw: -1
        request = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "preflight",
            "source_path": "02. Books/native.pdf",
            "expected_processing_identity_digest": "a" * 64,
        }
        for err_code in (fake_raw.FPDF_ERR_PASSWORD, fake_raw.FPDF_ERR_SECURITY):
            with self.subTest(err_code=err_code):
                def open_document(*_args, **_kwargs):
                    raise PdfiumError(err_code)

                fake_pdfium = types.ModuleType("pypdfium2")
                fake_pdfium.PdfiumError = PdfiumError
                fake_pdfium.PdfDocument = open_document
                fake_pdfium.raw = fake_raw
                with patch(
                    "zink_pdf_runtime.runner._probe", return_value={"status": "ok"}
                ), patch(
                    "zink_pdf_runtime.runner._safe_source_path",
                    return_value=Path("/fixture.pdf"),
                ), patch.dict(
                    sys.modules,
                    {"pypdfium2": fake_pdfium, "pypdfium2.raw": fake_raw},
                ):
                    response = _dispatch(request)
                self.assertEqual(response["code"], "PDF_DOCUMENT_ENCRYPTED")

    def test_preflight_reports_a_loadable_zero_page_document_as_empty(self) -> None:
        class Document:
            raw = object()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def __len__(self):
                return 0

        fake_raw = types.ModuleType("pypdfium2.raw")
        fake_raw.FPDF_ERR_PASSWORD = 4
        fake_raw.FPDF_ERR_SECURITY = 5
        fake_raw.FPDF_GetSecurityHandlerRevision = lambda _raw: -1
        fake_pdfium = types.ModuleType("pypdfium2")
        fake_pdfium.PdfDocument = lambda *_args, **_kwargs: Document()
        fake_pdfium.PdfiumError = RuntimeError
        fake_pdfium.raw = fake_raw
        request = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "preflight",
            "source_path": "02. Books/empty.pdf",
            "expected_processing_identity_digest": "a" * 64,
        }
        with patch(
            "zink_pdf_runtime.runner._probe", return_value={"status": "ok"}
        ), patch(
            "zink_pdf_runtime.runner._safe_source_path", return_value=Path("/empty.pdf")
        ), patch.dict(
            sys.modules, {"pypdfium2": fake_pdfium, "pypdfium2.raw": fake_raw}
        ):
            response = _dispatch(request)
        self.assertEqual(response["code"], "PDF_DOCUMENT_EMPTY")

    def test_multi_page_text_is_materialized_from_exact_charspans(self) -> None:
        first = types.SimpleNamespace(
            page_no=1, charspan=(0, 5), bbox=[0.1, 0.1, 0.2, 0.2]
        )
        second = types.SimpleNamespace(
            page_no=2, charspan=(5, 10), bbox=[0.2, 0.2, 0.3, 0.3]
        )
        parts = _page_local_content(
            "text", "firstagain", (first, second), object(), 1, 2
        )
        self.assertEqual(
            parts,
            [
                (1, "first", [0.1, 0.1, 0.2, 0.2]),
                (2, "again", [0.2, 0.2, 0.3, 0.3]),
            ],
        )

def _write_native_fixture(path: Path) -> None:
    streams = (b"BT /F1 16 Tf 72 700 Td (first page) Tj ET", b"BT /F1 16 Tf 72 700 Td (second page) Tj ET")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(streams[0])).encode() + b" >>\nstream\n" + streams[0] + b"\nendstream",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
        b"<< /Length " + str(len(streams[1])).encode() + b" >>\nstream\n" + streams[1] + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    payload = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, body in enumerate(objects, 1):
        offsets.append(len(payload))
        payload.extend(f"{number} 0 obj\n".encode())
        payload.extend(body)
        payload.extend(b"\nendobj\n")
    xref = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    payload.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode())
    payload.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    path.write_bytes(payload)


if __name__ == "__main__":
    unittest.main()
