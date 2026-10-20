from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pdf_runtime import (
    MAX_RESPONSE_BYTES,
    MAX_STDERR_BYTES,
    PROTOCOL_VERSION,
    SEGMENTATION_ALGORITHM_VERSION,
    PdfRuntimeClient,
    PdfRuntimeError,
    PdfRuntimeSettings,
    _OutputCapExceeded,
    _terminate_child_group,
    _read_capped,
    _validate_response,
    processing_identity_for_runtime,
    verify_runtime_probe,
)


class ParentIsolationTests(unittest.TestCase):
    # F-212 (R5-E09-04): the parent project gained the pytest configuration
    # the Knowledgebase lane needs (`[tool.pytest.ini_options]`). The
    # isolation invariant below still holds: no docling/transformers/torch
    # closure leaks into the parent project. Any further change to these
    # files must advance these digests deliberately and re-prove the negative
    # assertions.
    EXPECTED_PARENT_LOCK_SHA256 = "f72af19a34094109bcb7e6d4d6d24c0c2d5c1fa1de7d9a9f470c45fac3720c92"
    EXPECTED_PARENT_PROJECT_SHA256 = "46c5c960598c00b7f26ac9aaf62608bc0447f0a36aa5a76a2ffa56f4aa3dd1e5"

    def test_parent_lock_and_import_closure_excludes_pdf_runtime_dependencies(self) -> None:
        root = Path(__file__).resolve().parents[1]
        lock_bytes = (root / "uv.lock").read_bytes()
        project_bytes = (root / "pyproject.toml").read_bytes()
        self.assertEqual(hashlib.sha256(lock_bytes).hexdigest(), self.EXPECTED_PARENT_LOCK_SHA256)
        self.assertEqual(hashlib.sha256(project_bytes).hexdigest(), self.EXPECTED_PARENT_PROJECT_SHA256)
        parent_lock = lock_bytes.decode("utf-8")
        parent_project = project_bytes.decode("utf-8")
        self.assertIn('"tokenizers==0.23.1"', parent_project)
        self.assertIn('name = "tokenizers"', parent_lock)
        for dependency in ("docling", "transformers", "torch", "docling-ibm-models"):
            self.assertNotIn(f'name = "{dependency}"', parent_lock)
            self.assertNotIn(f'"{dependency}', parent_project)
        self.assertIsNone(importlib.util.find_spec("docling"))
        self.assertIsNone(importlib.util.find_spec("transformers"))
        self.assertIsNone(importlib.util.find_spec("torch"))

    def test_isolated_runtime_is_not_on_parent_sys_path(self) -> None:
        root = Path(__file__).resolve().parents[1]
        isolated = (root / "pdf-runtime").resolve()
        import sys
        self.assertFalse(any(isolated == Path(entry).resolve() or isolated in Path(entry).resolve().parents for entry in sys.path if entry))


class IsolatedLockContractTests(unittest.TestCase):
    def test_candidate_is_exact_cpu_only_and_models_use_immutable_revisions(self) -> None:
        root = Path(__file__).resolve().parents[1] / "pdf-runtime"
        project = (root / "pyproject.toml").read_text(encoding="utf-8")
        lock = (root / "uv.lock").read_text(encoding="utf-8")
        requirements = (root / "requirements.txt").read_text(encoding="utf-8")
        downloader = (root / "src" / "zink_pdf_runtime" / "download_models.py").read_text(
            encoding="utf-8"
        )
        for requirement in (
            '"docling==2.121.0"',
            '"docling-core==2.92.0"',
            '"docling-ibm-models==3.14.0"',
            '"docling-parse==7.15.0"',
            '"pypdfium2==5.13.0"',
            '"torch==2.13.0+cpu"',
            '"torchvision==0.28.0+cpu"',
            '"transformers==5.15.1"',
        ):
            self.assertIn(requirement, project)
        self.assertIn('name = "tokenizers"', lock)
        self.assertIn('version = "0.22.2"', lock)
        self.assertNotRegex(lock.casefold(), r'name = "(?:nvidia|cuda|rocm|xpu)')
        for package in ("docling", "docling-core", "torch", "torchvision", "transformers"):
            self.assertRegex(requirements, rf"(?m)^{re.escape(package)}==[^\s]+.*\\$")
        revisions = re.findall(r'"[^"]+/[^"]+": "([0-9a-f]{40})"', downloader)
        self.assertEqual(len(revisions), 3)


class ProtocolValidationTests(unittest.TestCase):
    def response(self, value: dict[str, object]) -> bytes:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

    def test_canonical_success_response_is_accepted(self) -> None:
        request = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "extract_range",
            "page_start": 5,
            "page_end": 8,
        }
        response = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "ok",
            "page_start": 5,
            "page_end": 8,
            "items": [{
                "kind": "text",
                "ordinal": 0,
                "content": "bounded text",
                "page_start": 5,
                "page_end": 5,
                "bbox": [0.1, 0.2, 0.3, 0.4],
            }],
        })
        self.assertEqual(_validate_response(response, request)["status"], "ok")

    def test_preflight_accepts_only_a_canonical_page_count(self) -> None:
        request = {"protocol_version": PROTOCOL_VERSION, "operation": "preflight"}
        accepted = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "ok",
            "page_count": 12,
        })
        self.assertEqual(_validate_response(accepted, request)["page_count"], 12)
        invalid = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "ok",
            "page_count": True,
        })
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            _validate_response(invalid, request)

    def test_out_of_range_or_unexpected_item_data_is_rejected(self) -> None:
        request = {
            "protocol_version": PROTOCOL_VERSION,
            "operation": "extract_range",
            "page_start": 5,
            "page_end": 8,
        }
        base = {
            "protocol_version": PROTOCOL_VERSION,
            "status": "ok",
            "page_start": 5,
            "page_end": 8,
            "items": [{
                "kind": "text",
                "ordinal": 0,
                "content": "outside",
                "page_start": 4,
                "page_end": 4,
                "bbox": None,
            }],
        }
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            _validate_response(self.response(base), request)
        base["items"][0]["page_start"] = 5
        base["items"][0]["page_end"] = 5
        base["items"][0]["absolute_path"] = "/vault/private.pdf"
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            _validate_response(self.response(base), request)

    def test_noncanonical_or_unexpected_response_is_rejected(self) -> None:
        request = {"protocol_version": PROTOCOL_VERSION, "operation": "probe"}
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            _validate_response(b'{"status":"ok", "protocol_version":"zink:pdf-runtime-protocol:v1"}', request)
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_PROTOCOL_MISMATCH"):
            _validate_response(self.response({"protocol_version": "wrong", "status": "ok"}), request)

    def test_safe_child_error_is_preserved_without_stderr(self) -> None:
        request = {"protocol_version": PROTOCOL_VERSION, "operation": "probe"}
        raw = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "error",
            "code": "PDF_RUNTIME_MISMATCH",
        })
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_MISMATCH"):
            _validate_response(raw, request)
        encrypted = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "error",
            "code": "PDF_DOCUMENT_ENCRYPTED",
        })
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_DOCUMENT_ENCRYPTED"):
            _validate_response(encrypted, request)
        unsafe = self.response({
            "protocol_version": PROTOCOL_VERSION,
            "status": "error",
            "code": "PDF_RUNTIME_/vault/private.pdf",
        })
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            _validate_response(unsafe, request)


class ClientRequestTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
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

    async def test_invalid_range_never_spawns_child(self) -> None:
        client = self.client()
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            await client.extract_range("02. Books/a.pdf", 0, 1, "a" * 64, asyncio.get_running_loop().time() + 1)
        with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_OUTPUT_INVALID"):
            await client.extract_range(
                "02. Books/a.pdf",
                True,
                1,
                "a" * 64,
                asyncio.get_running_loop().time() + 1,
            )

    async def test_stdout_and_stderr_caps_are_enforced_while_streaming(self) -> None:
        for configured_cap in (MAX_RESPONSE_BYTES, MAX_STDERR_BYTES):
            reader = asyncio.StreamReader()
            reader.feed_data(b"x" * 2)
            reader.feed_eof()
            with self.assertRaises(_OutputCapExceeded):
                await _read_capped(reader, min(configured_cap, 1))

    async def test_invocations_are_strictly_sequential(self) -> None:
        client = self.client()
        active = 0
        maximum_active = 0

        async def controlled_invocation(_request, _deadline):
            nonlocal active, maximum_active
            active += 1
            maximum_active = max(maximum_active, active)
            await asyncio.sleep(0.02)
            active -= 1
            return {"status": "ok"}

        with patch.object(client, "_invoke_locked", new=controlled_invocation):
            await asyncio.gather(
                client._invoke({"operation": "first"}, 1),
                client._invoke({"operation": "second"}, 1),
            )
        self.assertEqual(maximum_active, 1)

    async def test_unreaped_child_after_sigkill_fail_stops_within_bound(self) -> None:
        class FailStopTriggered(BaseException):
            pass

        class UnreapedProcess:
            returncode = None
            pid = 123

            def __init__(self) -> None:
                self.terminated = False
                self.killed = False

            def terminate(self) -> None:
                self.terminated = True

            def kill(self) -> None:
                self.killed = True

            async def wait(self) -> int:
                await asyncio.Event().wait()
                return 0

        process = UnreapedProcess()
        with (
            patch("app.pdf_runtime.os.name", "nt"),
            patch("app.pdf_runtime.CHILD_TERMINATION_GRACE_SECONDS", 0.001),
            patch("app.pdf_runtime.CHILD_KILL_REAP_SECONDS", 0.001),
            patch(
                "app.pdf_runtime._fail_stop_unreaped_child",
                side_effect=FailStopTriggered,
            ) as fail_stop,
        ):
            with self.assertRaises(FailStopTriggered):
                await _terminate_child_group(process)  # type: ignore[arg-type]

        self.assertTrue(process.terminated)
        self.assertTrue(process.killed)
        fail_stop.assert_called_once_with()

    @unittest.skipUnless(os.name == "posix", "process-group contract is Linux-only")
    async def test_timeout_kills_the_child_process_group(self) -> None:
        client = self.client()
        original_spawn = asyncio.create_subprocess_exec
        with tempfile.TemporaryDirectory() as directory:
            pid_path = Path(directory) / "descendant.pid"
            program = (
                "import pathlib, subprocess, sys, time; "
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import time; time.sleep(60)']); "
                f"pathlib.Path({str(pid_path)!r}).write_text(str(child.pid)); "
                "time.sleep(60)"
            )

            async def spawn_test_group(*_args, **kwargs):
                return await original_spawn(sys.executable, "-c", program, **kwargs)

            deadline = asyncio.get_running_loop().time() + 0.5
            with patch("app.pdf_runtime.asyncio.create_subprocess_exec", spawn_test_group):
                with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_TIMEOUT"):
                    await client._invoke(
                        {
                            "protocol_version": PROTOCOL_VERSION,
                            "operation": "probe",
                            "expected_processing_identity_digest": "a" * 64,
                        },
                        deadline,
                    )

            descendant_pid = int(pid_path.read_text(encoding="utf-8"))
            for _ in range(100):
                try:
                    state = Path(f"/proc/{descendant_pid}/stat").read_text(
                        encoding="utf-8"
                    ).split()[2]
                except FileNotFoundError:
                    break
                if state == "Z":
                    break
                await asyncio.sleep(0.01)
            else:
                self.fail("timed-out runtime descendant remained alive")


class RuntimeIdentityTests(unittest.TestCase):
    def test_processing_identity_tracks_table_segmentation_revision(self) -> None:
        self.assertEqual(SEGMENTATION_ALGORITHM_VERSION, 4)

    def test_parent_recomputes_and_compares_manifest_probe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent_lock = root / "parent.lock"
            runtime_lock = root / "runtime.lock"
            parent_lock.write_text("parent", encoding="utf-8")
            runtime_lock.write_text("runtime", encoding="utf-8")
            requirements = root / "requirements.txt"
            requirements.write_text("docling==2.121.0\n", encoding="utf-8")
            manifest = {
                "artifact_digests": {"layout/model.bin": "a" * 64},
                "distribution_versions": {"docling": "2.121.0", "transformers": "5.15.1"},
                "locked_distribution_hashes": {
                    "docling==2.121.0": ["sha256:" + "e" * 64],
                },
                "hashed_requirements_digest": hashlib.sha256(
                    requirements.read_bytes()
                ).hexdigest(),
                "model_artifact_revisions": {
                    "docling-project/docling-layout-heron": "d" * 40,
                },
                "pdf_runtime_lock_digest": hashlib.sha256(b"runtime").hexdigest(),
                "protocol_version": PROTOCOL_VERSION,
                "runner_code_digest": "b" * 64,
                "tesseract_version": "tesseract 5.3.0",
                "tessdata_source_revision": {"tesseract-ocr": "5.3.0-2"},
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_bytes(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            expected = processing_identity_for_runtime(
                parent_lock,
                runtime_lock,
                manifest_path,
                {"tokenizer_identity": "c" * 64, "embedding_identity": "m3"},
            )
            # The parent still owns the processing identity; the child no
            # longer echoes it back (F-286).
            self.assertEqual(len(expected), 64)
            probe = {
                # F-286 (R7-C3-05): the child recomputes its evidence; it does
                # not echo the processing identity it was sent.
                "pdf_runtime_lock_digest": manifest["pdf_runtime_lock_digest"],
                "distributions": manifest["distribution_versions"],
                "artifact_digests": manifest["artifact_digests"],
                "runner_code_digest": manifest["runner_code_digest"],
            }
            verify_runtime_probe(manifest_path, runtime_lock, probe)
            probe["artifact_digests"] = {}
            with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_MISMATCH"):
                verify_runtime_probe(manifest_path, runtime_lock, probe)

    def test_the_locked_distribution_hashes_are_verified(self) -> None:
        """F-306 (R7-E1-01): the supply-chain fields were presence-only.

        The manifest recorded the lock's hashes and the child reported its
        installed versions, and nothing compared them: a distribution
        installed at a version the lock does not pin passed the probe.
        """

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime_lock = root / "runtime.lock"
            runtime_lock.write_text("runtime", encoding="utf-8")
            requirements = root / "requirements.txt"
            requirements.write_text("docling==2.121.0\n", encoding="utf-8")
            manifest = {
                "artifact_digests": {"layout/model.bin": "a" * 64},
                "distribution_versions": {"docling": "2.121.0"},
                "locked_distribution_hashes": {
                    "docling==2.121.0": ["sha256:" + "e" * 64],
                },
                "hashed_requirements_digest": hashlib.sha256(
                    requirements.read_bytes()
                ).hexdigest(),
                "model_artifact_revisions": {},
                "pdf_runtime_lock_digest": hashlib.sha256(b"runtime").hexdigest(),
                "protocol_version": PROTOCOL_VERSION,
                "runner_code_digest": "b" * 64,
                "tesseract_version": "tesseract 5.3.0",
                "tessdata_source_revision": {"tesseract-ocr": "5.3.0-2"},
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_bytes(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            probe = {
                "pdf_runtime_lock_digest": manifest["pdf_runtime_lock_digest"],
                "distributions": manifest["distribution_versions"],
                "artifact_digests": manifest["artifact_digests"],
                "runner_code_digest": manifest["runner_code_digest"],
            }

            verify_runtime_probe(manifest_path, runtime_lock, probe)

            # The installed distribution is not the one the lock pins.
            manifest["distribution_versions"] = {"docling": "2.120.0"}
            manifest_path.write_bytes(
                json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
            )
            probe["distributions"] = manifest["distribution_versions"]
            with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_MISMATCH"):
                verify_runtime_probe(manifest_path, runtime_lock, probe)

    def test_the_hashed_requirements_digest_is_recomputed(self) -> None:
        """F-306 (R7-E1-01): the digest was demanded to exist, never read.

        The file the lock names could be edited after the manifest was
        written and the probe still passed, because nothing recomputed the
        digest.
        """

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime_lock = root / "runtime.lock"
            runtime_lock.write_text("runtime", encoding="utf-8")
            requirements = root / "requirements.txt"
            requirements.write_text("docling==2.121.0\n", encoding="utf-8")
            manifest = {
                "artifact_digests": {"layout/model.bin": "a" * 64},
                "distribution_versions": {"docling": "2.121.0"},
                "locked_distribution_hashes": {
                    "docling==2.121.0": ["sha256:" + "e" * 64],
                },
                "hashed_requirements_digest": hashlib.sha256(
                    requirements.read_bytes()
                ).hexdigest(),
                "model_artifact_revisions": {},
                "pdf_runtime_lock_digest": hashlib.sha256(b"runtime").hexdigest(),
                "protocol_version": PROTOCOL_VERSION,
                "runner_code_digest": "b" * 64,
                "tesseract_version": "tesseract 5.3.0",
                "tessdata_source_revision": {"tesseract-ocr": "5.3.0-2"},
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_bytes(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            probe = {
                "pdf_runtime_lock_digest": manifest["pdf_runtime_lock_digest"],
                "distributions": manifest["distribution_versions"],
                "artifact_digests": manifest["artifact_digests"],
                "runner_code_digest": manifest["runner_code_digest"],
            }

            verify_runtime_probe(manifest_path, runtime_lock, probe)

            requirements.write_text("docling==2.120.0\n", encoding="utf-8")
            with self.assertRaisesRegex(PdfRuntimeError, "PDF_RUNTIME_MISMATCH"):
                verify_runtime_probe(manifest_path, runtime_lock, probe)


if __name__ == "__main__":
    unittest.main()
