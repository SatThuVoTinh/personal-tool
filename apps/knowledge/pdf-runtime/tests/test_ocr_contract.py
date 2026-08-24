from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from zink_pdf_runtime.ocr import OCR_LANGUAGES, run_tesseract


class OcrProcessContractTests(unittest.TestCase):
    def test_language_and_psm_options_precede_the_tsv_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "tesseract"
            executable.write_bytes(b"fixture")
            tessdata = root / "tessdata"
            tessdata.mkdir()
            image = root / "region.png"
            image.write_bytes(b"fixture")
            process = MagicMock()
            process.stdout = object()
            process.stderr = object()
            process.returncode = 0
            environment = {
                "ZINK_TESSERACT_BIN": str(executable),
                "ZINK_TESSDATA_PREFIX": str(tessdata),
            }
            with (
                patch.dict(os.environ, environment, clear=False),
                patch("zink_pdf_runtime.ocr.subprocess.Popen", return_value=process) as popen,
                patch("zink_pdf_runtime.ocr._read_output", return_value=b"tsv"),
            ):
                self.assertEqual(run_tesseract(image, deadline=time.monotonic() + 1), "tsv")
            command = popen.call_args.args[0]
            self.assertEqual(OCR_LANGUAGES, "eng+vie+chi_sim")
            self.assertEqual(
                command[3:],
                ["-l", "eng+vie+chi_sim", "--psm", "3", "tsv"],
            )


if __name__ == "__main__":
    unittest.main()
