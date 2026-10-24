"""F-442 (R9-L09-6): a killed OCR child must not leave its region behind.

The child writes each OCR region inside a ``TemporaryDirectory`` under
``ZINK_PDF_TEMP_ROOT``, and the parent kills the child's whole process group
when the deadline expires.  The context manager therefore never unwinds, and
nothing in the child used to sweep the root, so every killed extraction left a
region directory inside the container's 768m ``/tmp`` tmpfs.

This lane models that kill: a child enters the same context manager, writes a
region, and is then terminated by this process.  The next child runs the real
OCR entry point and the temp root must be empty.  The docling imports are
stubbed in the child process because the parent lane deliberately does not
install the child's closure; everything this row exercises -- the root
preparation and the sweep -- is the production code.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

CHILD_SRC = Path(__file__).resolve().parents[1] / "pdf-runtime" / "src"

CHILD_PROGRAM = """
import sys
import types


def _module(name, **attributes):
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class _BaseOcrModel:
    def __init__(self, *, enabled, artifacts_path, options, accelerator_options):
        self.enabled = enabled


class _OcrOptions:
    pass


class _TesseractCliOcrOptions(_OcrOptions):
    def __init__(self, **kwargs):
        self.scale = 3.0


class _StandardPdfPipeline:
    pass


_module("docling")
_module("docling.datamodel")
_module("docling.datamodel.accelerator_options", AcceleratorOptions=object)
_module("docling.datamodel.base_models", Page=object)
_module("docling.datamodel.document", ConversionResult=object)
_module(
    "docling.datamodel.pipeline_options",
    OcrOptions=_OcrOptions,
    TesseractCliOcrOptions=_TesseractCliOcrOptions,
)
_module("docling.models")
_module("docling.models.base_ocr_model", BaseOcrModel=_BaseOcrModel)
_module("docling.pipeline")
_module(
    "docling.pipeline.standard_pdf_pipeline",
    StandardPdfPipeline=_StandardPdfPipeline,
)
_module("docling.utils")
_module(
    "docling.utils.ocr_utils",
    tesseract_box_to_bounding_rectangle=lambda *args, **kwargs: None,
)
_module("docling_core")
_module("docling_core.types")
_module("docling_core.types.doc", BoundingBox=object, CoordOrigin=object)
_module("docling_core.types.doc.page", TextCell=object)

from pathlib import Path

from zink_pdf_runtime import docling_ocr

mode = sys.argv[1]
temp_root = Path(sys.argv[2])
if mode == "leave":
    import tempfile

    temporary = tempfile.TemporaryDirectory(dir=temp_root)
    directory = Path(temporary.name)
    (directory / "region.png").write_bytes(b"residue")
    Path(sys.argv[3]).write_text(str(directory), encoding="utf-8")
    import time

    time.sleep(60)
else:
    # The deployed child is Linux, where the 0700 mode check is meaningful.
    # This lane also runs on Windows, where chmod cannot express that mode.
    docling_ocr.stat.S_IMODE = lambda mode: 0o700
    model = docling_ocr.M4TesseractOcrModel(
        enabled=True,
        artifacts_path=None,
        options=None,
        accelerator_options=None,
    )
    list(model(object(), ()))
"""


class KilledChildRegionResidueTests(unittest.TestCase):
    """F-442 (R9-L09-6): the next invocation sweeps a killed child's region."""

    def environment(self, temp_root: Path) -> dict[str, str]:
        environment = dict(os.environ)
        environment["ZINK_PDF_TEMP_ROOT"] = str(temp_root)
        environment["PYTHONPATH"] = os.pathsep.join(
            [str(CHILD_SRC), environment.get("PYTHONPATH", "")]
        ).rstrip(os.pathsep)
        return environment

    def test_a_killed_childs_region_directory_is_swept_by_the_next_invocation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            temp_root = root / "pdf-runtime"
            temp_root.mkdir()
            ready = root / "ready.txt"
            environment = self.environment(temp_root)
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    CHILD_PROGRAM,
                    "leave",
                    str(temp_root),
                    str(ready),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
            try:
                deadline = time.monotonic() + 30
                while not ready.is_file():
                    if child.poll() is not None:
                        stdout, stderr = child.communicate()
                        self.fail(
                            "the residue child exited before writing its region: "
                            f"{stdout} {stderr}"
                        )
                    if time.monotonic() >= deadline:
                        self.fail("the residue child never wrote its region")
                    time.sleep(0.05)
                residue = Path(ready.read_text(encoding="utf-8"))
            finally:
                child.kill()
                child.wait(timeout=10)

            self.assertTrue(
                residue.is_dir(), "the kill must model a leaked region directory"
            )

            completed = subprocess.run(
                [sys.executable, "-c", CHILD_PROGRAM, "clean", str(temp_root)],
                capture_output=True,
                text=True,
                env=environment,
                timeout=60,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(temp_root.is_dir(), "the sweep must keep the temp root")
            self.assertEqual(
                list(temp_root.iterdir()),
                [],
                "a killed child's region directory survived the next invocation",
            )


if __name__ == "__main__":
    unittest.main()
