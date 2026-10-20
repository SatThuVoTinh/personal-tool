"""M10/T2-R24: the PDF runtime trust boundary must type its own rejections.

Two defects, both proven by execution before the fix:

1. `_validate_response` performed its byte-exactness round trip OUTSIDE the
   try/except above it. `json.loads` accepts the non-standard NaN / Infinity /
   -Infinity literals and out-of-range exponents such as 1e400 as ordinary
   floats, and a lone surrogate survives decoding; those then reached
   `json.dumps(..., allow_nan=False)`, which raises ValueError, or `.encode`,
   which raises UnicodeEncodeError. `PdfRuntimeError` derives from RuntimeError,
   not ValueError, so neither was converted. In the preflight path
   pdf_pipeline catches only PdfRuntimeError, so the ValueError escaped build()
   entirely; in the batch path a blanket except caught it but reported a generic
   PDF_RUNTIME_FAILED, hiding that the child had violated the protocol.

2. The stderr cap aborted the child. Its purpose was to bound memory, but
   exceeding it terminated a child whose response was valid and whose stderr
   bytes the parent then discarded anyway.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pdf_runtime import (
    MAX_STDERR_BYTES,
    PROTOCOL_VERSION,
    PdfRuntimeClient,
    PdfRuntimeError,
    PdfRuntimeSettings,
    _read_capped,
    _validate_response,
)

PREFIX = '{"protocol_version":' + json.dumps(PROTOCOL_VERSION) + ',"status":"ok","x":'

NAN_PAYLOADS = {
    "NaN literal": PREFIX + "NaN}",
    "Infinity literal": PREFIX + "Infinity}",
    "negative Infinity": PREFIX + "-Infinity}",
    "out-of-range exponent": PREFIX + "1e400}",
    "lone surrogate": PREFIX + json.dumps("\ud800") + "}",
}

DIGEST = "a" * 64


def probe_response() -> dict:
    # F-286 (R7-C3-05): the child no longer echoes the processing identity
    # it was sent, so the response carries only what the child recomputed.
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "ok",
        "pdf_runtime_lock_digest": "b" * 64,
        "distributions": {},
        "artifact_digests": {},
        "runner_code_digest": "c" * 64,
    }


def canonical(value: dict) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


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


PROBE_REQUEST = {
    "protocol_version": PROTOCOL_VERSION,
    "operation": "probe",
    "expected_processing_identity_digest": DIGEST,
}


class ValidatorTypingTests(unittest.TestCase):
    def test_non_finite_and_surrogate_payloads_raise_the_typed_error(self) -> None:
        # Each of these passed json.loads silently and then escaped the
        # validator as ValueError or UnicodeEncodeError.
        for label, text in NAN_PAYLOADS.items():
            with self.subTest(payload=label):
                with self.assertRaises(PdfRuntimeError) as caught:
                    _validate_response(text.encode("utf-8"), PROBE_REQUEST)
                self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")

    def test_the_typed_error_is_not_a_value_error(self) -> None:
        # Pin the class relationship the escape depended on.
        self.assertFalse(issubclass(PdfRuntimeError, ValueError))
        self.assertTrue(issubclass(PdfRuntimeError, RuntimeError))

    def test_a_control_case_still_passes(self) -> None:
        response = _validate_response(canonical(probe_response()), PROBE_REQUEST)
        self.assertEqual(response["status"], "ok")

    def test_byte_exactness_is_still_enforced(self) -> None:
        # The round trip must remain a real check, not one that swallows
        # everything into a pass.
        reordered = json.dumps(probe_response(), separators=(", ", ": "))
        with self.assertRaises(PdfRuntimeError) as caught:
            _validate_response(reordered.encode("utf-8"), PROBE_REQUEST)
        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_INVALID")


class ReaderCapTests(unittest.IsolatedAsyncioTestCase):
    async def test_response_stream_still_aborts_on_overflow(self) -> None:
        # The response IS the payload, so exceeding its cap must stay fatal.
        reader = asyncio.StreamReader()
        reader.feed_data(b"x" * (64 * 1024))
        reader.feed_eof()
        with self.assertRaises(Exception) as caught:
            await _read_capped(reader, 1024)
        self.assertEqual(type(caught.exception).__name__, "_OutputCapExceeded")

    async def test_diagnostic_stream_drains_and_bounds_instead(self) -> None:
        reader = asyncio.StreamReader()
        reader.feed_data(b"y" * (64 * 1024))
        reader.feed_eof()
        result = await _read_capped(reader, 1024, abort_on_overflow=False)
        self.assertLessEqual(len(result), 1024)
        self.assertGreater(len(result), 0)

    async def test_diagnostic_stream_never_holds_more_than_the_cap(self) -> None:
        reader = asyncio.StreamReader()
        for _ in range(64):
            reader.feed_data(b"z" * 65536)
        reader.feed_eof()
        result = await _read_capped(reader, MAX_STDERR_BYTES, abort_on_overflow=False)
        self.assertLessEqual(len(result), MAX_STDERR_BYTES)


class StderrDoesNotKillAHealthyChildTests(unittest.IsolatedAsyncioTestCase):
    async def test_flooded_stderr_still_yields_a_valid_response(self) -> None:
        # The defect: ~1.8 MiB of per-page UserWarning text on stderr preceded a
        # perfectly valid 7-page probe, and the parent killed the child and
        # reported PDF_RUNTIME_OUTPUT_LIMIT -- on the strength of bytes it then
        # threw away.
        payload = canonical(probe_response()).decode("utf-8")
        program = (
            "import sys\n"
            "line = 'UserWarning: page %d: slow layout model fallback\\n'\n"
            "for i in range(30000):\n"
            "    sys.stderr.write(line % i)\n"
            "sys.stderr.flush()\n"
            f"sys.stdout.write({payload!r})\n"
            "sys.stdout.flush()\n"
        )

        original_spawn = asyncio.create_subprocess_exec

        async def spawn(*_args, **kwargs):
            return await original_spawn(sys.executable, "-c", program, **kwargs)

        loop = asyncio.get_running_loop()
        deadline = loop.time() + 60.0
        with patch("app.pdf_runtime.asyncio.create_subprocess_exec", spawn):
            response = await client()._invoke(PROBE_REQUEST, deadline)

        self.assertEqual(response["status"], "ok")
        # F-286 (R7-C3-05): the response carries the evidence the child
        # recomputed, and no echoed identity to compare back.
        self.assertNotIn("processing_identity_digest", response)
        self.assertEqual(response["runner_code_digest"], "c" * 64)

    async def test_a_genuinely_oversized_response_is_still_rejected(self) -> None:
        # The other direction: draining stderr must not weaken the response cap.
        program = (
            "import sys\n"
            "sys.stdout.write('{\"pad\":\"' + 'x' * (80 * 1024 * 1024) + '\"}')\n"
            "sys.stdout.flush()\n"
        )

        original_spawn = asyncio.create_subprocess_exec

        async def spawn(*_args, **kwargs):
            return await original_spawn(sys.executable, "-c", program, **kwargs)

        loop = asyncio.get_running_loop()
        deadline = loop.time() + 60.0
        with patch("app.pdf_runtime.asyncio.create_subprocess_exec", spawn):
            with self.assertRaises(PdfRuntimeError) as caught:
                await client()._invoke(PROBE_REQUEST, deadline)

        self.assertEqual(caught.exception.code, "PDF_RUNTIME_OUTPUT_LIMIT")


class ChildFailureAttributionTests(unittest.IsolatedAsyncioTestCase):
    async def _run_failing_child(self, program: str) -> PdfRuntimeError:
        original_spawn = asyncio.create_subprocess_exec

        async def spawn(*_args, **kwargs):
            return await original_spawn(sys.executable, "-c", program, **kwargs)

        loop = asyncio.get_running_loop()
        with patch("app.pdf_runtime.asyncio.create_subprocess_exec", spawn):
            with self.assertRaises(PdfRuntimeError) as caught:
                await client()._invoke(PROBE_REQUEST, loop.time() + 60.0)
        return caught.exception

    async def test_a_crash_reports_its_exit_code(self) -> None:
        error = await self._run_failing_child(
            "import sys; sys.stderr.write('Model artifact missing: layout.onnx\n'); sys.exit(1)"
        )

        self.assertEqual(error.code, "PDF_RUNTIME_FAILED")
        self.assertIsNotNone(error.detail)
        self.assertIn("exit=1", error.detail)
        self.assertIn("layout.onnx", error.detail)

    async def test_an_oom_kill_is_distinguishable_from_a_normal_exit(self) -> None:
        # The defect this closes: an OOM kill and a missing artifact produced
        # byte-identical, unattributable PDF_RUNTIME_FAILED to the operator.
        killed = await self._run_failing_child(
            "import os, signal; os.kill(os.getpid(), signal.SIGKILL)"
        )
        normal = await self._run_failing_child(
            "import sys; sys.stderr.write('boom\n'); sys.exit(1)"
        )

        self.assertEqual(killed.code, normal.code)
        self.assertNotEqual(killed.detail, normal.detail)
        self.assertIn("exit=", killed.detail)

    async def test_the_detail_is_bounded(self) -> None:
        from app.pdf_runtime import _CHILD_DETAIL_LIMIT

        error = await self._run_failing_child(
            "import sys; sys.stderr.write('x' * 500000); sys.exit(3)"
        )

        self.assertLessEqual(len(error.detail), _CHILD_DETAIL_LIMIT)
        self.assertIn("exit=3", error.detail)

    async def test_the_detail_is_single_line(self) -> None:
        error = await self._run_failing_child(
            "import sys; sys.stderr.write('line one\\nline two\\nline three\\n'); sys.exit(2)"
        )

        self.assertNotIn("\n", error.detail)
        self.assertNotIn("\r", error.detail)

    def test_a_lone_exit_code_still_produces_a_detail(self) -> None:
        from app.pdf_runtime import _child_failure_detail

        self.assertEqual(_child_failure_detail(None, b""), None)
        self.assertEqual(_child_failure_detail(0, b""), "exit=0")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()