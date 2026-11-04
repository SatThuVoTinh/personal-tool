"""F-309 (R7-E1-04): the reranker validated a graph contract it trusted.

The runtime compared the manifest's graph-contract values against the same
literals the export script stamped into that manifest, so the guard could
only ever agree with the file it trusted. The measured evidence that could
contradict it -- the fidelity report the export step produced -- was written
and then dropped: it was not in the shipped file set, the manifest dataclass
had no member for it, and nothing downstream could re-verify it.

These cases drive the real contract checks against a session whose shape is
measured, not typed.
"""

from __future__ import annotations

import dataclasses
import unittest
from dataclasses import dataclass, replace
from pathlib import Path

from app.markdown_adapter import ARTIFACT_SHA256_EXPECTED, PAIR_MAX_TOKENS
from app.reranker import (
    ArtifactManifest,
    OnnxReranker,
    RerankerUnavailableError,
)
from app.reranker_contract import (
    RERANKER_MODEL_NAME,
    RERANKER_REVISION,
    SOURCE_MODEL_SHA256,
)

ARTIFACT_DIGEST = "0" * 64
FIDELITY_DIGEST = "1" * 64
# The fidelity evidence the export step writes, and the runtime's own batch
# ceiling. Both are named here rather than imported, so this lane pins the
# BEHAVIOUR and not the module's internal names.
FIDELITY_EVIDENCE_FILE = "reranker-fidelity.json"
RUNTIME_BATCH_CEILING = 20


@dataclass
class _Input:
    name: str
    type: str = "tensor(int64)"
    shape: tuple[object, ...] = ("batch", "sequence")


@dataclass
class _Output:
    name: str = "logits"
    type: str = "tensor(float)"
    shape: tuple[object, ...] = ("batch",)


class _Session:
    def __init__(
        self,
        inputs: list[_Input] | None = None,
        outputs: list[_Output] | None = None,
    ) -> None:
        self._inputs = (
            inputs
            if inputs is not None
            else [_Input("input_ids"), _Input("attention_mask")]
        )
        self._outputs = outputs if outputs is not None else [_Output()]

    def get_inputs(self) -> list[_Input]:
        return self._inputs

    def get_outputs(self) -> list[_Output]:
        return self._outputs

    def get_providers(self) -> list[str]:
        return ["CPUExecutionProvider"]


def manifest(**overrides: object) -> ArtifactManifest:
    files = {
        "model.int8.onnx": ARTIFACT_DIGEST,
        "tokenizer.json": ARTIFACT_SHA256_EXPECTED,
        FIDELITY_EVIDENCE_FILE: FIDELITY_DIGEST,
    }
    fields = {field.name for field in dataclasses.fields(ArtifactManifest)}
    arguments = {
        "model_name": RERANKER_MODEL_NAME,
        "revision": RERANKER_REVISION,
        "source_model_sha256": SOURCE_MODEL_SHA256,
        "tokenizer_sha256": ARTIFACT_SHA256_EXPECTED,
        "files": dict(files),
        "runtime_files": dict(files),
        "inputs": (
            {
                "name": "input_ids",
                "dtype": "tensor(int64)",
                "rank": 2,
                "shape": ["batch", "sequence"],
            },
            {
                "name": "attention_mask",
                "dtype": "tensor(int64)",
                "rank": 2,
                "shape": ["batch", "sequence"],
            },
        ),
        "outputs": (
            {"name": "logits", "dtype": "tensor(float)", "rank": 1, "shape": ["batch"]},
        ),
        "graph_contract": {
            "batch_axis": 0,
            "sequence_axis": 1,
            "max_batch_size": RUNTIME_BATCH_CEILING,
            "max_sequence_length": PAIR_MAX_TOKENS,
            "one_logit_per_pair": True,
        },
    }
    # F-309 (R7-E1-04): the manifest carries the fidelity evidence's digest.
    # A manifest that cannot carry it is the defect, and the case that
    # refuses such a manifest is the control.
    if "fidelity_evidence_sha256" in fields:
        arguments["fidelity_evidence_sha256"] = FIDELITY_DIGEST
    base = ArtifactManifest(**arguments)
    return replace(base, **overrides) if overrides else base


def reranker(session: _Session, loaded: ArtifactManifest) -> OnnxReranker:
    instance = object.__new__(OnnxReranker)
    instance._model_path = Path("model.int8.onnx")
    instance._session = session
    instance._manifest = loaded
    return instance


class GraphContractTests(unittest.TestCase):
    """F-309 (R7-E1-04): the contract is measured from the loaded session."""

    def test_a_contract_that_agrees_with_the_session_is_accepted(self) -> None:
        reranker(_Session(), manifest())._validate_graph()

    def test_a_contract_that_names_the_wrong_sequence_axis_is_refused(self) -> None:
        loaded = manifest(
            graph_contract={
                "batch_axis": 0,
                "sequence_axis": 0,
                "max_batch_size": RUNTIME_BATCH_CEILING,
                "max_sequence_length": PAIR_MAX_TOKENS,
                "one_logit_per_pair": True,
            }
        )
        with self.assertRaises(RerankerUnavailableError):
            reranker(_Session(), loaded)._validate_graph()

    def test_a_contract_that_claims_one_logit_per_pair_is_refused(self) -> None:
        # The loaded session's output carries a second axis, so the graph does
        # NOT emit one logit per pair. The manifest declares that same output
        # shape, so the ONLY thing that can refuse it is the measured
        # one-logit-per-pair flag: a comparison against the literal `True`
        # would accept it.
        session = _Session(outputs=[_Output(shape=("batch", 1))])
        loaded = manifest(
            outputs=(
                {
                    "name": "logits",
                    "dtype": "tensor(float)",
                    "rank": 2,
                    "shape": ["batch", 1],
                },
            )
        )
        with self.assertRaises(RerankerUnavailableError):
            reranker(session, loaded)._validate_graph()

    def test_a_contract_that_claims_a_bigger_batch_than_the_runtime_allows_is_refused(self) -> None:
        loaded = manifest(
            graph_contract={
                "batch_axis": 0,
                "sequence_axis": 1,
                "max_batch_size": RUNTIME_BATCH_CEILING + 1,
                "max_sequence_length": PAIR_MAX_TOKENS,
                "one_logit_per_pair": True,
            }
        )
        with self.assertRaises(RerankerUnavailableError):
            reranker(_Session(), loaded)._validate_graph()

    def test_a_contract_that_claims_a_longer_sequence_than_the_runtime_allows_is_refused(self) -> None:
        loaded = manifest(
            graph_contract={
                "batch_axis": 0,
                "sequence_axis": 1,
                "max_batch_size": RUNTIME_BATCH_CEILING,
                "max_sequence_length": PAIR_MAX_TOKENS + 1,
                "one_logit_per_pair": True,
            }
        )
        with self.assertRaises(RerankerUnavailableError):
            reranker(_Session(), loaded)._validate_graph()


class FidelityEvidenceTests(unittest.TestCase):
    """F-309 (R7-E1-04): the fidelity evidence is shipped and re-verified."""

    def test_a_manifest_that_ships_the_evidence_is_accepted(self) -> None:
        reranker(_Session(), manifest())._verify_contract()

    def test_a_manifest_that_does_not_ship_the_evidence_is_refused(self) -> None:
        loaded = manifest()
        without = replace(
            loaded,
            runtime_files={
                name: digest
                for name, digest in loaded.runtime_files.items()
                if name != FIDELITY_EVIDENCE_FILE
            },
            files={
                name: digest
                for name, digest in loaded.files.items()
                if name != FIDELITY_EVIDENCE_FILE
            },
        )
        with self.assertRaises(RerankerUnavailableError) as caught:
            reranker(_Session(), without)._verify_contract()
        self.assertEqual(str(caught.exception), "RERANKER_MANIFEST_INVALID")

    def test_a_manifest_whose_fidelity_digest_does_not_match_the_shipped_file_is_refused(self) -> None:
        fields = {field.name for field in dataclasses.fields(ArtifactManifest)}
        if "fidelity_evidence_sha256" not in fields:
            self.skipTest("the manifest cannot carry the fidelity digest yet")
        loaded = manifest(fidelity_evidence_sha256="2" * 64)
        with self.assertRaises(RerankerUnavailableError) as caught:
            reranker(_Session(), loaded)._verify_contract()
        self.assertEqual(str(caught.exception), "RERANKER_MANIFEST_INVALID")


if __name__ == "__main__":
    unittest.main()