"""M4-owned bounded Tesseract runner.

It deliberately does not subclass Docling's process runner.  The child
runtime retains responsibility for timeout, bounded stream consumption, and
cleanup; the parent process-group contract remains the final containment layer.
"""

from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time
from pathlib import Path

OCR_LANGUAGES = "eng+vie+chi_sim"
OCR_TIMEOUT_SECONDS = 90
OCR_OUTPUT_CAP = 16 * 1024 * 1024


class OcrRuntimeError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def require_deadline(overall_deadline: float | None) -> float:
    """The extraction deadline, or a refusal when there is none.

    F-284 (R7-C3-03): the child could not compose the parent's operation
    ceiling on its own -- its worst case was twelve times that ceiling -- so
    an extraction without a deadline is refused instead of being bounded by a
    per-region constant that overstates it.
    """

    if overall_deadline is None or time.monotonic() >= overall_deadline:
        raise OcrRuntimeError("PDF_RUNTIME_TIMEOUT")
    return overall_deadline


def region_deadline(overall_deadline: float) -> float:
    """The deadline one OCR region may run until.

    F-284 (R7-C3-03): every region used to get its own fresh ninety
    seconds, so thirty-two regions on each of four pages could take 11520
    seconds against a 900 second ceiling. A region now stops at the
    extraction deadline the parent sent, so the composition of the regions
    cannot exceed the budget.
    """

    return min(time.monotonic() + OCR_TIMEOUT_SECONDS, overall_deadline)


def run_tesseract(image: Path, *, deadline: float) -> str:
    """Extract one OCR region with fixed arguments and streaming output cap."""

    executable = Path(os.environ["ZINK_TESSERACT_BIN"])
    tessdata = Path(os.environ["ZINK_TESSDATA_PREFIX"])
    # F-441 (R9-L09-5): the deadline can expire during the page render and the
    # PNG write that precede this call, so the expiry is classified FIRST. The
    # combined arm reported an expired deadline as PDF_RUNTIME_UNAVAILABLE,
    # which the parent does not map as a timeout.
    if deadline <= time.monotonic():
        raise OcrRuntimeError("PDF_RUNTIME_TIMEOUT")
    if not executable.is_file() or not tessdata.is_dir():
        raise OcrRuntimeError("PDF_RUNTIME_UNAVAILABLE")
    environment = {
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/usr/bin:/bin",
        "TESSDATA_PREFIX": str(tessdata),
    }
    process = subprocess.Popen(
        [str(executable), str(image), "stdout", "-l", OCR_LANGUAGES, "--psm", "3", "tsv"],
        shell=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
        close_fds=True,
    )
    assert process.stdout is not None and process.stderr is not None
    try:
        output = _read_output(process, min(deadline, time.monotonic() + OCR_TIMEOUT_SECONDS))
    except OcrRuntimeError:
        _terminate_and_reap(process)
        raise
    if process.returncode != 0:
        raise OcrRuntimeError("PDF_RUNTIME_FAILED")
    try:
        return output.decode("utf-8")
    except UnicodeDecodeError as error:
        raise OcrRuntimeError("PDF_RUNTIME_FAILED") from error


def _read_output(process: subprocess.Popen[bytes], deadline: float) -> bytes:
    assert process.stdout is not None and process.stderr is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    selector.register(process.stderr, selectors.EVENT_READ)
    total = 0
    stdout: list[bytes] = []
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise OcrRuntimeError("PDF_RUNTIME_TIMEOUT")
            events = selector.select(remaining)
            if not events:
                raise OcrRuntimeError("PDF_RUNTIME_TIMEOUT")
            for key, _ in events:
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                total += len(block)
                if total > OCR_OUTPUT_CAP:
                    raise OcrRuntimeError("PDF_RUNTIME_OUTPUT_LIMIT")
                if key.fileobj is process.stdout:
                    stdout.append(block)
        process.wait(timeout=max(0.01, deadline - time.monotonic()))
    except subprocess.TimeoutExpired as error:
        raise OcrRuntimeError("PDF_RUNTIME_TIMEOUT") from error
    finally:
        selector.close()
    return b"".join(stdout)


def _terminate_and_reap(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
