"""F-493 (R9-T11-3): the child OCR contract is bound from the parent lane.

The child suite under `pdf-runtime/tests` was executed by no lane: both
sanctioned pytest invocations name `apps/knowledge/tests` and the image never
copies `pdf-runtime/tests`. Its one surviving case patched `Popen` and asserted
only the argv tail, so the four-key environment allowlist and the executable
tail were asserted by nothing. The dead suite is removed and its assertions
live here, in a non-skippable parent case that loads the shipped `ocr.py` by
path; the cases below also pin the population decision itself (no child test
module, no image copy line) so a future claim that the image runs the child
suite reddens this lane.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

KNOWLEDGE_ROOT = Path(__file__).resolve().parents[1]
OCR_PATH = (
    KNOWLEDGE_ROOT / "pdf-runtime" / "src" / "zink_pdf_runtime" / "ocr.py"
)
CHILD_TEST_DIRECTORY = KNOWLEDGE_ROOT / "pdf-runtime" / "tests"
DOCKERFILE = KNOWLEDGE_ROOT / "Dockerfile"
CONFTEST = KNOWLEDGE_ROOT / "tests" / "conftest.py"
RUNNER = KNOWLEDGE_ROOT / "pdf-runtime" / "src" / "zink_pdf_runtime" / "runner.py"


def load_ocr_module():
    spec = importlib.util.spec_from_file_location(
        "zink_pdf_runtime_ocr_process_contract", OCR_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OcrProcessContractTests(unittest.TestCase):
    def test_the_environment_is_the_fixed_four_key_allowlist(self) -> None:
        ocr = load_ocr_module()
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
            # `clear=True` proves the child cannot inherit a parent variable
            # such as the two ZINK_* inputs themselves.
            with (
                patch.dict(
                    os.environ,
                    {
                        "ZINK_TESSERACT_BIN": str(executable),
                        "ZINK_TESSDATA_PREFIX": str(tessdata),
                    },
                    clear=True,
                ),
                patch.object(
                    ocr.subprocess, "Popen", return_value=process
                ) as popen,
                patch.object(ocr, "_read_output", return_value=b"tsv"),
            ):
                self.assertEqual(
                    ocr.run_tesseract(image, deadline=time.monotonic() + 60),
                    "tsv",
                )

            self.assertEqual(
                popen.call_args.kwargs["env"],
                {
                    "LANG": "C.UTF-8",
                    "LC_ALL": "C.UTF-8",
                    "PATH": "/usr/bin:/bin",
                    "TESSDATA_PREFIX": str(tessdata),
                },
            )
            self.assertIs(popen.call_args.kwargs["shell"], False)
            self.assertIs(popen.call_args.kwargs["close_fds"], True)
            self.assertIs(popen.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_the_argv_tail_carries_the_languages_and_tsv_config(self) -> None:
        ocr = load_ocr_module()
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
            with (
                patch.dict(
                    os.environ,
                    {
                        "ZINK_TESSERACT_BIN": str(executable),
                        "ZINK_TESSDATA_PREFIX": str(tessdata),
                    },
                    clear=True,
                ),
                patch.object(
                    ocr.subprocess, "Popen", return_value=process
                ) as popen,
                patch.object(ocr, "_read_output", return_value=b"tsv"),
            ):
                ocr.run_tesseract(image, deadline=time.monotonic() + 60)

            self.assertEqual(ocr.OCR_LANGUAGES, "eng+vie+chi_sim")
            self.assertEqual(
                popen.call_args.args[0],
                [
                    str(executable),
                    str(image),
                    "stdout",
                    "-l",
                    "eng+vie+chi_sim",
                    "--psm",
                    "3",
                    "tsv",
                ],
            )


class ChildSuitePopulationTests(unittest.TestCase):
    def test_no_child_test_module_remains(self) -> None:
        remaining = (
            sorted(CHILD_TEST_DIRECTORY.glob("test_*.py"))
            if CHILD_TEST_DIRECTORY.is_dir()
            else []
        )
        self.assertEqual(
            remaining,
            [],
            "a child test module has no executor; the parent lane binds the "
            "behaviour instead",
        )

    def test_the_image_never_copies_the_child_suite(self) -> None:
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        self.assertNotIn("pdf-runtime/tests", dockerfile)

    def test_the_floor_names_the_population_it_measures(self) -> None:
        docstring = CONFTEST.read_text(encoding="utf-8")
        self.assertIn("apps/knowledge/tests", docstring)
        self.assertIn("pdf-runtime/tests", docstring)
        self.assertIn("no executor", docstring)

    def test_the_runner_docstring_states_the_same_population(self) -> None:
        docstring = RUNNER.read_text(encoding="utf-8")
        self.assertIn("F-493", docstring)
        self.assertIn("parent lane", docstring)


if __name__ == "__main__":
    unittest.main()
