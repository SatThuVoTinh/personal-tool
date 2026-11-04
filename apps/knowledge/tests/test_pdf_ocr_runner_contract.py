"""F-285 (R7-C3-04): the child's OCR runner contract was asserted by nothing.

The child's only runner test replaced the process constructor and the
streaming reader wholesale and then asserted the argument vector tail, so
every statement that makes the bounded-execution contract real -- the deadline
comparison, the byte cap, the terminate-and-reap path, the return-code check
and the decode guard -- was inside the patched region or after it. The suite
stayed green with those bodies deleted.

This lane drives the REAL reader and the REAL process lifecycle against a
fixture executable, in a separate process exactly as the deployment drives
the child, so the parent's isolation invariant (the child's runtime path is
never on the parent's sys.path) still holds.

The runner selects on the child's pipes, which is a POSIX capability, so the
cases are POSIX-only: the deployed child runs on Linux and the CI python
lane executes them there. On this host they are reported as NOT RUN.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CHILD_SRC = Path(__file__).resolve().parents[1] / "pdf-runtime" / "src"

CHILD_PROGRAM = """
import json, sys, time
from pathlib import Path

from zink_pdf_runtime.ocr import OcrRuntimeError, run_tesseract

image = Path(sys.argv[1])
deadline = float(sys.argv[2])
try:
    output = run_tesseract(image, deadline=time.monotonic() + deadline)
except OcrRuntimeError as error:
    sys.stdout.write(json.dumps({"status": "error", "code": error.code}))
else:
    sys.stdout.write(json.dumps({"status": "ok", "output": output}))
"""

# The fixture executable is the interpreter itself and the "image" argument is
# a program it runs, so the child's process lifecycle is the real one. PIDFILE
# is replaced with the path the fixture writes its own PID to, because the
# runner's argument vector is fixed and cannot carry it.
FIXTURES = {
    "sleep": (
        "import os, time\n"
        "open('PIDFILE', 'w').write(str(os.getpid()))\n"
        "time.sleep(120)\n"
    ),
    "flood": (
        "import os, sys\n"
        "open('PIDFILE', 'w').write(str(os.getpid()))\n"
        "chunk = b'x' * 65536\n"
        "for _ in range(400):\n"
        "    sys.stdout.buffer.write(chunk)\n"
        "sys.stdout.buffer.flush()\n"
    ),
    "undecodable": (
        "import os, sys\n"
        "open('PIDFILE', 'w').write(str(os.getpid()))\n"
        "sys.stdout.buffer.write(b'\\xff\\xfe\\xfa')\n"
        "sys.stdout.buffer.flush()\n"
    ),
    "failing": (
        "import os, sys\n"
        "open('PIDFILE', 'w').write(str(os.getpid()))\n"
        "sys.stdout.buffer.write(b'tsv')\n"
        "sys.stdout.buffer.flush()\n"
        "sys.exit(3)\n"
    ),
}


def run_child(image: Path, deadline: float) -> dict:
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(CHILD_SRC), environment.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    completed = subprocess.run(
        [sys.executable, "-c", CHILD_PROGRAM, str(image), str(deadline)],
        capture_output=True,
        text=True,
        env=environment,
        timeout=180,
    )
    if completed.returncode != 0:
        raise AssertionError(f"the child program failed: {completed.stderr}")
    return json.loads(completed.stdout)


class OcrDeadlineClassificationTests(unittest.TestCase):
    """F-441 (R9-L09-5): an expired region deadline is a timeout.

    The surviving window is the page render and the PNG write that sit
    between the extraction-wide deadline check and the tesseract call, so the
    deadline the runner receives can already have passed while the binary and
    the tessdata directory are present. The combined arm used to report that
    as PDF_RUNTIME_UNAVAILABLE, which the parent does not map as a timeout.
    """

    def test_an_expired_region_deadline_is_a_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "region.png"
            image.write_bytes(b"fixture")
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = sys.executable
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, -1.0)

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["code"], "PDF_RUNTIME_TIMEOUT")

    def test_a_missing_binary_with_a_live_deadline_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "region.png"
            image.write_bytes(b"fixture")
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = str(Path(directory) / "absent")
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, 30.0)

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["code"], "PDF_RUNTIME_UNAVAILABLE")


@unittest.skipUnless(
    os.name == "posix",
    "the runner selects on the child's pipes, which is POSIX-only; the "
    "deployed child and the CI python lane run on Linux",
)
class OcrRunnerLifecycleTests(unittest.TestCase):
    """F-285 (R7-C3-04): the real reader and the real process lifecycle."""

    def fixture(self, name: str, directory: str) -> tuple[Path, Path]:
        image = Path(directory) / "region.png"
        pid_file = Path(directory) / "fixture.pid"
        image.write_text(
            FIXTURES[name].replace("PIDFILE", str(pid_file)), encoding="utf-8"
        )
        return image, pid_file

    def assert_reaped(self, pid_file: Path) -> None:
        self.assertTrue(pid_file.is_file(), "the fixture must have started")
        pid = int(pid_file.read_text(encoding="utf-8").strip())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_a_region_that_overruns_the_deadline_is_a_typed_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image, pid_file = self.fixture("sleep", directory)
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = sys.executable
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, 1.0)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["code"], "PDF_RUNTIME_TIMEOUT")
            self.assert_reaped(pid_file)

    def test_a_region_that_exceeds_the_output_cap_is_a_typed_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image, pid_file = self.fixture("flood", directory)
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = sys.executable
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, 120.0)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["code"], "PDF_RUNTIME_OUTPUT_LIMIT")
            self.assert_reaped(pid_file)

    def test_output_that_is_not_utf8_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image, pid_file = self.fixture("undecodable", directory)
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = sys.executable
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, 60.0)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["code"], "PDF_RUNTIME_FAILED")

    def test_a_nonzero_exit_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image, pid_file = self.fixture("failing", directory)
            environment = dict(os.environ)
            environment["ZINK_TESSERACT_BIN"] = sys.executable
            environment["ZINK_TESSDATA_PREFIX"] = directory
            with mock.patch.dict(os.environ, environment, clear=False):
                result = run_child(image, 60.0)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["code"], "PDF_RUNTIME_FAILED")


if __name__ == "__main__":
    unittest.main()