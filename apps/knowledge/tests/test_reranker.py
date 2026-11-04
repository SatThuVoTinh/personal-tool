from __future__ import annotations

import asyncio
import hashlib
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from app.markdown_adapter import ARTIFACT_SHA256_EXPECTED
from app.reranker import ArtifactManifest, OnnxReranker, RerankerUnavailableError
from app.reranker_contract import (
    RERANKER_MODEL_NAME,
    RERANKER_REVISION,
    SOURCE_MODEL_SHA256,
)


@dataclass
class _Encoding:
    ids: list[int]
    attention_mask: list[int]
    type_ids: list[int]


class _Budget:
    pad_token_id = 9

    def encode_pair(self, query: str, retrieval_text: str) -> _Encoding:
        size = 3 if retrieval_text == "short" else 5
        return _Encoding([1] * size, [1] * size, [0] * size)


@dataclass
class _Input:
    name: str
    type: str = "tensor(int64)"
    shape: tuple[object, ...] = ("batch", "sequence")


@dataclass
class _Output:
    name: str = "logits"
    type: str = "tensor(float)"
    shape: tuple[object, ...] = ("batch", 1)


class _Session:
    def __init__(self, block: threading.Event | None = None) -> None:
        self.block = block
        self.started = threading.Event()
        self.calls = 0
        self.active = 0
        self.maximum_active = 0
        self.last_feeds: dict[str, np.ndarray] | None = None

    def get_inputs(self) -> list[_Input]:
        return [_Input("input_ids"), _Input("attention_mask")]

    def get_outputs(self) -> list[_Output]:
        return [_Output()]

    def get_providers(self) -> list[str]:
        return ["CPUExecutionProvider"]

    def run(self, _: object, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.calls += 1
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.last_feeds = feeds
        self.started.set()
        try:
            if self.block is not None and not self.block.wait(timeout=3):
                raise RuntimeError("fake inference was not released")
            return [np.arange(feeds["input_ids"].shape[0], dtype=np.float32).reshape(-1, 1)]
        finally:
            self.active -= 1


def _reranker(session: _Session) -> OnnxReranker:
    reranker = object.__new__(OnnxReranker)
    reranker._token_budget = _Budget()
    reranker._np = np
    reranker._session = session
    reranker._input_names = tuple(item.name for item in session.get_inputs())
    reranker._executor = ThreadPoolExecutor(max_workers=1)
    return reranker


class RerankerConstructorTests(unittest.TestCase):
    """F-312 (R7-E2-02): the constructor was executed by no test.

    Every other case builds the object around its constructor, so the
    manifest load, the contract check, the ARTIFACT DIGEST verification and
    the session construction ordering were never run, and the negative
    cases asserted only the shared exception type. These cases drive the
    real constructor against a real artifact directory and each one asserts
    its own failure code.
    """

    def _artifacts(self, root: Path) -> tuple[Path, Path]:
        model = root / "model.int8.onnx"
        model.write_bytes(b"not-a-real-onnx-graph")
        tokenizer = root / "tokenizer.json"
        tokenizer.write_bytes(b"{}")
        # F-309 (R7-E1-04): the fidelity evidence is part of the shipped file
        # set, so the fixture ships it too.
        fidelity = root / "reranker-fidelity.json"
        fidelity.write_bytes(b"{}")
        digests = {
            "model.int8.onnx": hashlib.sha256(model.read_bytes()).hexdigest(),
            "tokenizer.json": hashlib.sha256(tokenizer.read_bytes()).hexdigest(),
            "reranker-fidelity.json": hashlib.sha256(fidelity.read_bytes()).hexdigest(),
        }
        manifest = {
            "model_name": RERANKER_MODEL_NAME,
            "revision": RERANKER_REVISION,
            "source_model_sha256": SOURCE_MODEL_SHA256,
            "tokenizer_sha256": ARTIFACT_SHA256_EXPECTED,
            "files": digests,
            "runtime_files": dict(digests),
            "inputs": [],
            "outputs": [],
            "graph_contract": {},
            # F-309 (R7-E1-04): the fidelity evidence is shipped and pinned.
            "fidelity_evidence_sha256": digests["reranker-fidelity.json"],
        }
        manifest_path = root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return model, manifest_path

    def _construct(self, model: Path, manifest_path: Path) -> str:
        try:
            OnnxReranker(model, manifest_path, _Budget())
        except RerankerUnavailableError as error:
            code = str(error)
            if code == "ONNX_RUNTIME_UNAVAILABLE":
                self.skipTest("the ONNX runtime is not installed in this environment")
            return code
        self.fail("the fixture is not a real ONNX graph, so the session cannot open")

    def test_the_constructor_passes_every_verification_step(self) -> None:
        with TemporaryDirectory() as directory:
            model, manifest_path = self._artifacts(Path(directory))

            code = self._construct(model, manifest_path)

            # The manifest, the provenance contract and the artifact digests
            # all passed; the fixture is not a real ONNX graph, so the session
            # is what fails.
            self.assertEqual(code, "RERANKER_UNAVAILABLE")

    def test_a_tampered_artifact_is_refused_with_its_own_code(self) -> None:
        with TemporaryDirectory() as directory:
            model, manifest_path = self._artifacts(Path(directory))
            model.write_bytes(b"tampered")

            self.assertEqual(self._construct(model, manifest_path), "RERANKER_ARTIFACT_MISMATCH")

    def test_a_missing_artifact_is_refused_with_its_own_code(self) -> None:
        with TemporaryDirectory() as directory:
            model, manifest_path = self._artifacts(Path(directory))
            model.unlink()

            self.assertEqual(self._construct(model, manifest_path), "RERANKER_ARTIFACT_MISSING")

    def test_a_wrong_provenance_is_refused_with_its_own_code(self) -> None:
        with TemporaryDirectory() as directory:
            model, manifest_path = self._artifacts(Path(directory))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["revision"] = "main"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            self.assertEqual(
                self._construct(model, manifest_path), "RERANKER_PROVENANCE_MISMATCH"
            )

    def test_a_malformed_manifest_is_refused_with_its_own_code(self) -> None:
        with TemporaryDirectory() as directory:
            model, manifest_path = self._artifacts(Path(directory))
            manifest_path.write_text("{not json", encoding="utf-8")

            self.assertEqual(
                self._construct(model, manifest_path), "RERANKER_MANIFEST_INVALID"
            )


class RerankerTests(unittest.IsolatedAsyncioTestCase):
    def test_manifest_provenance_is_exact_and_paths_cannot_escape(self) -> None:
        artifact_hash = "0" * 64
        fidelity_hash = "1" * 64
        manifest = ArtifactManifest(
            model_name=RERANKER_MODEL_NAME,
            revision=RERANKER_REVISION,
            source_model_sha256=SOURCE_MODEL_SHA256,
            tokenizer_sha256=ARTIFACT_SHA256_EXPECTED,
            files={
                "model.int8.onnx": artifact_hash,
                "tokenizer.json": ARTIFACT_SHA256_EXPECTED,
                "reranker-fidelity.json": fidelity_hash,
            },
            runtime_files={
                "model.int8.onnx": artifact_hash,
                "tokenizer.json": ARTIFACT_SHA256_EXPECTED,
                "reranker-fidelity.json": fidelity_hash,
            },
            inputs=(),
            outputs=(),
            graph_contract={},
            # F-309 (R7-E1-04): the fidelity evidence is shipped and pinned.
            fidelity_evidence_sha256=fidelity_hash,
        )
        reranker = object.__new__(OnnxReranker)
        reranker._model_path = Path("model.int8.onnx")
        reranker._manifest = manifest
        reranker._verify_contract()
        reranker._manifest = replace(manifest, revision="main")
        with self.assertRaises(RerankerUnavailableError):
            reranker._verify_contract()
        reranker._manifest = replace(
            manifest,
            files={"../model.int8.onnx": artifact_hash},
            runtime_files={"../model.int8.onnx": artifact_hash},
        )
        with self.assertRaises(RerankerUnavailableError):
            reranker._verify_contract()

    def test_graph_rejects_a_fixed_sequence_axis(self) -> None:
        session = _Session()
        session.get_inputs = lambda: [
            _Input("input_ids", shape=("batch", 1024)),
            _Input("attention_mask", shape=("batch", 1024)),
        ]
        reranker = object.__new__(OnnxReranker)
        reranker._session = session
        reranker._manifest = type(
            "Manifest",
            (),
            {
                "graph_contract": {
                    "batch_axis": 0,
                    "sequence_axis": 1,
                    "max_batch_size": 20,
                    "max_sequence_length": 1024,
                    "one_logit_per_pair": True,
                },
                "inputs": (
                    {
                        "name": "input_ids",
                        "dtype": "tensor(int64)",
                        "rank": 2,
                        "shape": ["batch", 1024],
                    },
                    {
                        "name": "attention_mask",
                        "dtype": "tensor(int64)",
                        "rank": 2,
                        "shape": ["batch", 1024],
                    },
                ),
                "outputs": (
                    {
                        "name": "logits",
                        "dtype": "tensor(float)",
                        "rank": 2,
                        "shape": ["batch", 1],
                    },
                ),
            },
        )()
        with self.assertRaises(RerankerUnavailableError):
            reranker._validate_graph()

    async def test_entire_candidate_set_uses_one_manually_padded_run(self) -> None:
        session = _Session()
        reranker = _reranker(session)
        try:
            logits = await reranker.predict([("q", "short"), ("q", "long")])
            self.assertEqual(logits, [0.0, 1.0])
            self.assertEqual(session.calls, 1)
            self.assertEqual(session.last_feeds["input_ids"].shape, (2, 5))
            self.assertEqual(session.last_feeds["input_ids"][0].tolist(), [1, 1, 1, 9, 9])
            self.assertEqual(session.last_feeds["attention_mask"][0].tolist(), [1, 1, 1, 0, 0])
        finally:
            await reranker.close()

    async def test_cancelled_caller_cannot_overlap_native_inference(self) -> None:
        release = threading.Event()
        session = _Session(block=release)
        reranker = _reranker(session)
        try:
            first = asyncio.create_task(reranker.predict([("q", "long")]))
            self.assertTrue(await asyncio.to_thread(session.started.wait, 1))
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            second = asyncio.create_task(reranker.predict([("q", "short")]))
            await asyncio.sleep(0.05)
            self.assertEqual(session.calls, 1)
            self.assertEqual(session.maximum_active, 1)
            release.set()
            self.assertEqual(await second, [0.0])
            self.assertEqual(session.maximum_active, 1)
        finally:
            release.set()
            await reranker.close()
