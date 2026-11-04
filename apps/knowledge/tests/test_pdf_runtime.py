from __future__ import annotations

import asyncio
import ast
import contextlib
import hashlib
import importlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from app.markdown_adapter import ARTIFACT_SHA256_EXPECTED

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


# F-517 (R10-L08-1): the three immutable snapshot revisions are DATA here and
# the downloader must declare exactly this mapping. The pin used to count
# 40-hex shapes anywhere in the file, so a swapped revision kept every gate
# green while the manifest attested a revision the image did not carry.
EXPECTED_MODEL_REVISIONS = {
    "docling-project/docling-layout-heron": "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8",
    "docling-project/docling-layout-heron-onnx": "40bde044036bb181c130ddf6c51792187268748f",
    "docling-project/docling-models": "fc0f2d45e2218ea24bce5045f58a389aed16dc23",
}
EXPECTED_TOKENIZERS_VERSION = "0.22.2"


def _declared_model_revisions(source: str) -> dict[str, str]:
    """The MODEL_REVISIONS mapping exactly as the downloader declares it."""

    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "MODEL_REVISIONS"
            for target in node.targets
        ):
            assert isinstance(node.value, ast.Dict)
            return {
                key.value: value.value
                for key, value in zip(node.value.keys, node.value.values)
            }
    raise AssertionError("download_models.py declares no MODEL_REVISIONS mapping")


PACKAGE_SOURCE = (
    Path(__file__).resolve().parents[1] / "pdf-runtime" / "src" / "zink_pdf_runtime"
)
REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT_PIN_CARRIERS = (
    ".github/workflows/ci.yml",
    "apps/knowledge/Dockerfile",
    "tests/m3-t2-contract.test.mjs",
    "tests/repository-policy.test.mjs",
)
REQUIREMENTS_PIN_CARRIERS = (
    "apps/knowledge/pdf-runtime/src/zink_pdf_runtime/manifest.py",
    "apps/knowledge/tests/test_pdf_runtime.py",
)


@contextlib.contextmanager
def _runtime_module(name: str):
    """Import one module of the isolated child package by its file path.

    The child package is deliberately not on the parent's `sys.path`
    (`test_isolated_runtime_is_not_on_parent_sys_path`), so the parent lane
    loads the shipped guard through a temporary package object and removes it
    again. The modules it imports pull `huggingface_hub`, which is not a
    parent dependency; a stub is injected only when it is genuinely absent.
    """

    package_name = "zink_pdf_runtime"
    child_names = (
        f"{package_name}.{name}",
        f"{package_name}.download_models",
        f"{package_name}.pins",
    )
    saved_package = sys.modules.get(package_name)
    saved_children = {child: sys.modules.get(child) for child in child_names}
    saved_hub = sys.modules.get("huggingface_hub")

    package = types.ModuleType(package_name)
    package.__path__ = [str(PACKAGE_SOURCE)]
    sys.modules[package_name] = package
    if saved_hub is None and importlib.util.find_spec("huggingface_hub") is None:
        stub = types.ModuleType("huggingface_hub")
        stub.snapshot_download = lambda **_kwargs: None  # type: ignore[attr-defined]
        sys.modules["huggingface_hub"] = stub
    try:
        yield importlib.import_module(f"{package_name}.{name}")
    finally:
        for child in child_names:
            if saved_children[child] is None:
                sys.modules.pop(child, None)
            else:
                sys.modules[child] = saved_children[child]
        if saved_package is None:
            sys.modules.pop(package_name, None)
        else:
            sys.modules[package_name] = saved_package
        if saved_hub is None:
            sys.modules.pop("huggingface_hub", None)
        else:
            sys.modules["huggingface_hub"] = saved_hub


def _requirements_pin() -> str:
    with _runtime_module("pins") as pins:
        return str(pins.EXPECTED_HASHED_REQUIREMENTS_SHA256)


def _requirements_carrier_drift(root: Path, pin: str) -> list[str]:
    """The artifact digest every carrier of this family must still agree on."""

    drift: list[str] = []
    artifact = root / "apps/knowledge/pdf-runtime/requirements.txt"
    if hashlib.sha256(artifact.read_bytes()).hexdigest() != pin:
        drift.append("apps/knowledge/pdf-runtime/requirements.txt")
    for relative in REQUIREMENTS_PIN_CARRIERS:
        if pin in (root / relative).read_text(encoding="utf-8"):
            drift.append(relative)
    return drift


def _artifact_carrier_drift(root: Path) -> list[str]:
    """Every text carrier of the tokenizer artifact pin, checked against it."""

    return [
        relative
        for relative in ARTIFACT_PIN_CARRIERS
        if ARTIFACT_SHA256_EXPECTED not in (root / relative).read_text(encoding="utf-8")
    ]


class RangePathArityTests(unittest.TestCase):
    """F-439 (R9-L09-3): the range extraction's call arity is pinned.

    The stale range-contract suite called `_docling_extract` with three
    arguments against a four-required-parameter signature and asserted item
    dicts against the conversion result. It imported the docling closure,
    which no lane installs, so nothing collected it and the drift was
    invisible. Every call anywhere in the package must carry the whole
    signature.
    """

    def test_every_call_passes_the_whole_extraction_signature(self) -> None:
        root = Path(__file__).resolve().parents[1] / "pdf-runtime"
        definitions: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
        calls: list[ast.Call] = []
        for path in sorted(root.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if node.name == "_docling_extract":
                        definitions.append(node)
                elif (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "_docling_extract"
                ):
                    calls.append(node)
        self.assertEqual(len(definitions), 1, "exactly one extraction definition")
        definition = definitions[0]
        self.assertEqual(
            [argument.arg for argument in definition.args.args],
            ["source", "start", "end", "overall_deadline"],
        )
        self.assertEqual(definition.args.defaults, [], "every parameter is required")
        self.assertTrue(calls, "the extraction must be called")
        for call in calls:
            self.assertEqual(len(call.args), 4, "a call must pass every parameter")
            self.assertEqual(call.keywords, [])


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
    # F-340 (R7-OA-03): the hashed requirements artifact now carries the index
    # its own `+cpu` pins need. F-548 (R10-T05-5 / R10-L08-2): the digest is
    # imported from the runtime's single pin carrier instead of re-declared
    # here, so this end of the supply chain cannot satisfy itself alone.
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
        # F-517 (R10-L08-1): the two assertions below were independent
        # substrings, so a second package carrying 0.22.2 satisfied the
        # version half while the tokenizers block said anything. The parsed
        # lock names the block.
        tokenizers = [
            entry
            for entry in tomllib.loads(lock)["package"]
            if entry["name"] == "tokenizers"
        ]
        self.assertEqual(len(tokenizers), 1, "the lock must carry one tokenizers package")
        self.assertEqual(tokenizers[0]["version"], EXPECTED_TOKENIZERS_VERSION)
        self.assertNotRegex(lock.casefold(), r'name = "(?:nvidia|cuda|rocm|xpu)')
        for package in ("docling", "docling-core", "torch", "torchvision", "transformers"):
            self.assertRegex(requirements, rf"(?m)^{re.escape(package)}==[^\s]+.*\\$")
        # F-517 (R10-L08-1): three 40-hex matches satisfied the old pin, so
        # any revision could be swapped with every gate green. The mapping
        # itself is the pin: a pair outside it, a missing model or an extra
        # model is red.
        self.assertEqual(_declared_model_revisions(downloader), EXPECTED_MODEL_REVISIONS)

    def test_the_hashed_requirements_artifact_is_pinned_and_carries_its_index(self) -> None:
        """F-340 (R7-OA-03): the artifact must be the pinned one, with its index."""

        root = Path(__file__).resolve().parents[1] / "pdf-runtime"
        artifact = (root / "requirements.txt").read_bytes()
        self.assertEqual(
            hashlib.sha256(artifact).hexdigest(),
            _requirements_pin(),
            "the committed requirements artifact must be the pinned one",
        )
        text = artifact.decode("utf-8")
        self.assertIn("--index-url https://pypi.org/simple", text)
        self.assertIn(
            "--extra-index-url https://download.pytorch.org/whl/cpu",
            text,
            "the artifact must declare the index its +cpu pins need",
        )
        for package in ("torch==2.13.0+cpu", "torchvision==0.28.0+cpu"):
            self.assertIn(package, text)

    def test_the_committed_artifact_is_byte_identical_to_the_export(self) -> None:
        """F-340 (R7-OA-03): the artifact must equal what `uv export` produces.

        The image proves the same equivalence with `cmp`; this lane proves it
        on every CI run, in the job that installs the canonical uv.
        """

        root = Path(__file__).resolve().parents[1] / "pdf-runtime"
        uv = shutil.which("uv")
        if uv is None:
            self.skipTest("uv is not installed in this environment")
        completed = subprocess.run(
            [
                uv,
                "export",
                "--frozen",
                "--no-dev",
                "--no-emit-project",
                "--no-header",
                "--format",
                "requirements.txt",
                "--emit-index-url",
            ],
            cwd=root,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            completed.stderr.decode("utf-8", "replace"),
        )
        self.assertEqual(
            completed.stdout,
            (root / "requirements.txt").read_bytes(),
            "the committed artifact must be byte-identical to the export",
        )


class PinCarrierAgreementTests(unittest.TestCase):
    """F-548 (R10-T05-5 / R10-L08-2): the pin carriers and the shipped guard.

    The previous shape let each copy of a digest satisfy its own assertion: the
    parent test re-declared the literal it checked, and the image-side refusal
    in `zink_pdf_runtime.manifest` was imported by no lane. These cases import
    the shipped guard, execute its refusal, and compare every remaining text
    carrier against the imported value.
    """

    def test_the_parent_lane_does_not_redeclare_the_artifact_digest(self) -> None:
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertNotIn(_requirements_pin(), source)

    def test_the_manifest_imports_the_single_pin_carrier(self) -> None:
        with _runtime_module("manifest") as manifest:
            with _runtime_module("pins") as pins:
                self.assertIs(
                    manifest.EXPECTED_HASHED_REQUIREMENTS_SHA256,
                    pins.EXPECTED_HASHED_REQUIREMENTS_SHA256,
                )

    def test_the_shipped_guard_refuses_a_mutated_artifact(self) -> None:
        with _runtime_module("manifest") as manifest:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "requirements.txt").write_text("mutated\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "pinned digest"):
                    manifest._requirements_digest(root / "uv.lock")

    def test_the_shipped_guard_returns_the_pin_for_the_committed_artifact(
        self,
    ) -> None:
        with _runtime_module("manifest") as manifest:
            root = Path(__file__).resolve().parents[1] / "pdf-runtime"
            self.assertEqual(
                manifest._requirements_digest(root / "uv.lock"),
                manifest.EXPECTED_HASHED_REQUIREMENTS_SHA256,
            )

    def test_every_remaining_requirements_carrier_agrees(self) -> None:
        self.assertEqual(
            _requirements_carrier_drift(REPO_ROOT, _requirements_pin()), []
        )

    def test_every_text_carrier_of_the_artifact_pin_agrees(self) -> None:
        self.assertEqual(_artifact_carrier_drift(REPO_ROOT), [])

    def test_the_carrier_checks_redden_on_one_drifted_copy(self) -> None:
        real_artifact = (
            REPO_ROOT / "apps/knowledge/pdf-runtime/requirements.txt"
        ).read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "apps/knowledge/pdf-runtime/requirements.txt"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(real_artifact)
            for relative in REQUIREMENTS_PIN_CARRIERS:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("from .pins import PIN\n", encoding="utf-8")
            self.assertEqual(
                _requirements_carrier_drift(root, _requirements_pin()), []
            )

            artifact.write_text("drifted\n", encoding="utf-8")
            self.assertEqual(
                _requirements_carrier_drift(root, _requirements_pin()),
                ["apps/knowledge/pdf-runtime/requirements.txt"],
            )

            for relative in ARTIFACT_PIN_CARRIERS:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(ARTIFACT_SHA256_EXPECTED + "\n", encoding="utf-8")
            self.assertEqual(_artifact_carrier_drift(root), [])
            (root / ARTIFACT_PIN_CARRIERS[0]).write_text(
                "drifted\n", encoding="utf-8"
            )
            self.assertEqual(
                _artifact_carrier_drift(root), [ARTIFACT_PIN_CARRIERS[0]]
            )


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
            # F-282 (R7-C3-01): the response names the pages it covered and
            # the pages the successful conversion proved empty.
            "covered_pages": [5],
            "blank_pages": [6, 7, 8],
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
            # F-282 (R7-C3-01): the coverage report is part of the response,
            # so this case still exercises the ITEM validation.
            "covered_pages": [4],
            "blank_pages": [5, 6, 7, 8],
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
