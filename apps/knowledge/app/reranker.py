from __future__ import annotations

import asyncio
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .markdown_adapter import ARTIFACT_SHA256_EXPECTED, PAIR_MAX_TOKENS, TokenBudget
from .reranker_contract import (
    RERANKER_MODEL_NAME,
    RERANKER_REVISION,
    SOURCE_MODEL_SHA256,
)


class RerankerUnavailableError(RuntimeError):
    pass


# F-309 (R7-E1-04): the fidelity evidence the export step produced is shipped
# with the artifacts and pinned by the manifest, so the runtime re-verifies it
# at load instead of dropping it.
FIDELITY_EVIDENCE_FILE = "reranker-fidelity.json"
# The runtime's own batch ceiling. The manifest's `max_batch_size` is a
# MEASUREMENT the export step took; this constant is the runtime's policy, so
# the two are compared rather than one program agreeing with its own literal.
RERANKER_MAX_BATCH = 20


class PairTokenBudgetError(ValueError):
    pass


@dataclass(frozen=True)
class ArtifactManifest:
    model_name: str
    revision: str
    source_model_sha256: str
    tokenizer_sha256: str
    files: dict[str, str]
    runtime_files: dict[str, str]
    inputs: tuple[dict[str, Any], ...]
    outputs: tuple[dict[str, Any], ...]
    graph_contract: dict[str, Any]
    # F-309 (R7-E1-04): the digest of the shipped fidelity evidence. It used
    # to be written into the manifest and then discarded at load, because the
    # dataclass had no member for it and the evidence file itself was not in
    # the shipped file set.
    fidelity_evidence_sha256: str


class OnnxReranker:
    """One CPU-only ONNX session with one physical inference worker."""

    def __init__(self, model_path: Path, manifest_path: Path, token_budget: TokenBudget) -> None:
        self._token_budget = token_budget
        self._model_path = model_path
        try:
            import numpy as np
            import onnxruntime as ort
        except ImportError as error:  # pragma: no cover - covered by readiness integration
            raise RerankerUnavailableError("ONNX_RUNTIME_UNAVAILABLE") from error
        self._np = np
        try:
            self._manifest = self._load_manifest(manifest_path)
            self._verify_contract()
            self._verify_files(manifest_path.parent)
            options = ort.SessionOptions()
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            options.intra_op_num_threads = 4
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._session = ort.InferenceSession(
                str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
            )
            self._validate_graph()
            self._input_names = tuple(
                item.name for item in self._session.get_inputs()
            )
            self._executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="knowledge-reranker"
            )
        except RerankerUnavailableError:
            raise
        except Exception as error:
            raise RerankerUnavailableError("RERANKER_UNAVAILABLE") from error

    @staticmethod
    def _load_manifest(path: Path) -> ArtifactManifest:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return ArtifactManifest(
                model_name=raw["model_name"],
                revision=raw["revision"],
                source_model_sha256=raw["source_model_sha256"],
                tokenizer_sha256=raw["tokenizer_sha256"],
                files=dict(raw["files"]),
                runtime_files=dict(raw["runtime_files"]),
                inputs=tuple(raw["inputs"]),
                outputs=tuple(raw["outputs"]),
                graph_contract=dict(raw["graph_contract"]),
                fidelity_evidence_sha256=raw["fidelity_evidence_sha256"],
            )
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RerankerUnavailableError("RERANKER_MANIFEST_INVALID") from error

    def _verify_contract(self) -> None:
        if (
            self._manifest.model_name != RERANKER_MODEL_NAME
            or self._manifest.revision != RERANKER_REVISION
            or self._manifest.source_model_sha256 != SOURCE_MODEL_SHA256
            or self._manifest.tokenizer_sha256 != ARTIFACT_SHA256_EXPECTED
        ):
            raise RerankerUnavailableError("RERANKER_PROVENANCE_MISMATCH")
        if not {self._model_path.name, "tokenizer.json"}.issubset(
            self._manifest.runtime_files
        ):
            raise RerankerUnavailableError("RERANKER_MANIFEST_INVALID")
        for relative, expected in self._manifest.runtime_files.items():
            if (
                Path(relative).name != relative
                or len(expected) != 64
                or any(character not in "0123456789abcdef" for character in expected)
                or self._manifest.files.get(relative) != expected
            ):
                raise RerankerUnavailableError("RERANKER_MANIFEST_INVALID")
        # F-309 (R7-E1-04): the fidelity evidence is shipped and pinned. The
        # manifest must carry the evidence file in its runtime set AND the
        # digest of that file, so the measurement the export step took is
        # re-verified at load instead of being dropped on the floor.
        fidelity_digest = self._manifest.fidelity_evidence_sha256
        if (
            not isinstance(fidelity_digest, str)
            or len(fidelity_digest) != 64
            or any(character not in "0123456789abcdef" for character in fidelity_digest)
            or self._manifest.runtime_files.get(FIDELITY_EVIDENCE_FILE) != fidelity_digest
        ):
            raise RerankerUnavailableError("RERANKER_MANIFEST_INVALID")

    def _verify_files(self, artifact_directory: Path) -> None:
        if self._model_path.parent.resolve() != artifact_directory.resolve() or self._model_path.name not in self._manifest.runtime_files:
            raise RerankerUnavailableError("RERANKER_ARTIFACT_MISMATCH")
        for relative, expected in self._manifest.runtime_files.items():
            target = artifact_directory / relative
            try:
                actual = _sha256(target)
            except OSError as error:
                raise RerankerUnavailableError("RERANKER_ARTIFACT_MISSING") from error
            if actual != expected:
                raise RerankerUnavailableError("RERANKER_ARTIFACT_MISMATCH")

    def _validate_graph(self) -> None:
        actual_inputs = self._session.get_inputs()
        actual_outputs = self._session.get_outputs()
        contract = self._manifest.graph_contract
        # F-309 (R7-E1-04): the axes and the one-logit-per-pair flag are read
        # from the session that was actually loaded. The manifest used to be
        # compared against the same literals the export script stamped into
        # it, so the guard could only ever agree with the file it trusted.
        measured = _measured_graph_contract(actual_inputs, actual_outputs)
        if (
            contract.get("batch_axis") != measured["batch_axis"]
            or contract.get("sequence_axis") != measured["sequence_axis"]
            or contract.get("max_batch_size") != RERANKER_MAX_BATCH
            or contract.get("max_sequence_length") != PAIR_MAX_TOKENS
            or contract.get("one_logit_per_pair") is not measured["one_logit_per_pair"]
            or len(actual_outputs) != 1
            or len(self._manifest.outputs) != 1
            or self._session.get_providers() != ["CPUExecutionProvider"]
        ):
            raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")
        expected_names = [item["name"] for item in self._manifest.inputs]
        if [item.name for item in actual_inputs] != expected_names:
            raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")
        for item, expected in zip(actual_inputs, self._manifest.inputs, strict=True):
            if (
                item.type != expected["dtype"]
                or len(item.shape) != expected["rank"]
                or list(item.shape) != expected["shape"]
            ):
                raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")
            # Both axes must remain runtime-dynamic; ORT exposes these as a
            # symbolic name or None rather than a fixed positive integer.
            if len(item.shape) < 2 or any(
                isinstance(value, int) for value in item.shape[:2]
            ):
                raise RerankerUnavailableError("RERANKER_GRAPH_NOT_DYNAMIC")
        actual_names = {item.name for item in actual_inputs}
        if (
            not {"input_ids", "attention_mask"}.issubset(actual_names)
            or not actual_names.issubset(
                {"input_ids", "attention_mask", "token_type_ids"}
            )
            or any(item.type != "tensor(int64)" for item in actual_inputs)
        ):
            raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")
        output, expected_output = actual_outputs[0], self._manifest.outputs[0]
        if (
            output.name != expected_output["name"]
            or output.type != expected_output["dtype"]
            or len(output.shape) != expected_output["rank"]
            or list(output.shape) != expected_output["shape"]
            or output.type != "tensor(float)"
            or not output.shape
            or isinstance(output.shape[0], int) and output.shape[0] > 0
        ):
            raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")

    async def close(self) -> None:
        await asyncio.to_thread(
            self._executor.shutdown, wait=True, cancel_futures=False
        )

    async def predict(self, pairs: list[tuple[str, str]]) -> list[float]:
        if not pairs:
            return []
        if len(pairs) > 20:
            raise RerankerUnavailableError("RERANKER_BATCH_TOO_LARGE")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._predict_sync, pairs)

    def _predict_sync(self, pairs: list[tuple[str, str]]) -> list[float]:
        encodings = []
        for query, retrieval_text in pairs:
            encoding = self._token_budget.encode_pair(query, retrieval_text)
            if len(encoding.ids) > PAIR_MAX_TOKENS:
                raise PairTokenBudgetError("PAIR_TOKEN_BUDGET_EXCEEDED")
            encodings.append(encoding)
        longest = max(len(encoding.ids) for encoding in encodings)
        if longest > PAIR_MAX_TOKENS:
            raise PairTokenBudgetError("PAIR_TOKEN_BUDGET_EXCEEDED")
        pad_token_id = self._token_budget.pad_token_id
        values_by_name = {
            "input_ids": ("ids", pad_token_id),
            "attention_mask": ("attention_mask", 0),
            "token_type_ids": ("type_ids", 0),
        }
        feeds: dict[str, Any] = {}
        for input_name in self._input_names:
            encoding_field, pad = values_by_name[input_name]
            rows = []
            for encoding in encodings:
                values = list(getattr(encoding, encoding_field))
                rows.append(values + [pad] * (longest - len(values)))
            feeds[input_name] = self._np.asarray(rows, dtype=self._np.int64)
        # Exactly one ONNX call handles the complete candidate set.
        outputs = self._session.run(None, feeds)
        logits = self._np.asarray(outputs[0]).reshape(-1)
        if len(logits) != len(pairs) or not self._np.isfinite(logits).all():
            raise RerankerUnavailableError("RERANKER_INVALID_OUTPUT")
        return [float(value) for value in logits]


def _measured_graph_contract(
    inputs: list[Any], outputs: list[Any]
) -> dict[str, object]:
    """The graph contract, measured from the loaded session.

    F-309 (R7-E1-04): the values are derived from the graph that was loaded,
    not typed here and not copied from the manifest.
    """

    ranks = {len(item.shape) for item in inputs}
    if len(ranks) != 1 or not inputs:
        raise RerankerUnavailableError("RERANKER_GRAPH_INVALID")
    rank = ranks.pop()
    sequence_axis = rank - 1
    return {
        "batch_axis": sequence_axis - 1,
        "sequence_axis": sequence_axis,
        "one_logit_per_pair": len(outputs) == 1 and len(outputs[0].shape) == 1,
    }


def stable_sigmoid(raw_logit: float) -> float:
    if not math.isfinite(raw_logit):
        raise RerankerUnavailableError("RERANKER_INVALID_OUTPUT")
    if raw_logit >= 0:
        return 1.0 / (1.0 + math.exp(-raw_logit))
    exp_logit = math.exp(raw_logit)
    return exp_logit / (1.0 + exp_logit)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for block in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
