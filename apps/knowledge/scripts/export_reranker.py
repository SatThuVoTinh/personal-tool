"""Build-time only export, quantization, manifest, and fidelity gate."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification

from app.markdown_adapter import ARTIFACT_SHA256_EXPECTED
from app.reranker_contract import (
    RERANKER_MODEL_NAME,
    RERANKER_REVISION,
    SOURCE_MODEL_SHA256,
)

# Clear relevance ordering avoids a guessed numeric quantization tolerance.
GOLDEN: tuple[tuple[str, tuple[str, str, str]], ...] = (
    ("What is safety stock?", ("Safety stock protects inventory from uncertainty.", "Inventory reviews occur monthly.", "Cloud networking uses routing tables.")),
    ("Safety stock dùng để làm gì?", ("Safety stock giúp bảo vệ tồn kho trước biến động.", "Kho hàng được kiểm kê định kỳ.", "Mây có thể tạo mưa.")),
    ("安全库存有什么作用？", ("安全库存用于应对需求和交货期的不确定性。", "仓库每月盘点一次。", "云计算提供远程资源。")),
)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as artifact:
        for block in iter(lambda: artifact.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value)) if value >= 0 else math.exp(value) / (1.0 + math.exp(value))


def ort_logits(session: ort.InferenceSession, batch: dict[str, np.ndarray]) -> list[float]:
    inputs = {item.name: batch[item.name] for item in session.get_inputs()}
    return np.asarray(session.run(None, inputs)[0]).reshape(-1).astype(float).tolist()


def encode_batch(tokenizer, query: str, documents: tuple[str, ...]) -> dict[str, np.ndarray]:
    """Canonical pair encoding followed by manual right padding only."""
    tokenizer.no_truncation()
    tokenizer.no_padding()
    encodings = [tokenizer.encode(query, pair=document, add_special_tokens=True) for document in documents]
    longest = max(len(item.ids) for item in encodings)
    if longest > 1024:
        raise RuntimeError("GOLDEN_PAIR_TOKEN_BUDGET_EXCEEDED")
    pad_token_id = tokenizer.token_to_id("<pad>")
    if pad_token_id is None:
        raise RuntimeError("TOKENIZER_PAD_TOKEN_MISSING")
    return {
        "input_ids": np.asarray([item.ids + [pad_token_id] * (longest - len(item.ids)) for item in encodings], dtype=np.int64),
        "attention_mask": np.asarray([item.attention_mask + [0] * (longest - len(item.ids)) for item in encodings], dtype=np.int64),
        "token_type_ids": np.asarray([item.type_ids + [0] * (longest - len(item.ids)) for item in encodings], dtype=np.int64),
    }


def _ranking(values: list[float]) -> list[int]:
    return sorted(range(len(values)), key=lambda index: (-values[index], index))


def _deviation(reference: list[float], candidate: list[float]) -> dict[str, object]:
    reference_rank = _ranking(reference)
    candidate_rank = _ranking(candidate)
    return {
        "ordering_preserved": reference_rank == candidate_rank,
        "max_absolute_logit_delta": max(abs(left - right) for left, right in zip(reference, candidate, strict=True)),
        "rank_positions_changed": sum(left != right for left, right in zip(reference_rank, candidate_rank, strict=True)),
    }


def external_data_files(graph_path: Path) -> set[Path]:
    graph = onnx.load_model(graph_path, load_external_data=False)
    files: set[Path] = set()
    for initializer in graph.graph.initializer:
        if initializer.data_location != onnx.TensorProto.EXTERNAL:
            continue
        metadata = {entry.key: entry.value for entry in initializer.external_data}
        location = metadata.get("location")
        if not location:
            raise RuntimeError("ONNX_EXTERNAL_DATA_LOCATION_MISSING")
        target = (graph_path.parent / location).resolve()
        if target.parent != graph_path.parent.resolve():
            raise RuntimeError("ONNX_EXTERNAL_DATA_PATH_INVALID")
        files.add(target)
    return files


def assert_dynamic_graph_contract(
    sessions: tuple[ort.InferenceSession, ...],
) -> list[dict[str, int | str]]:
    evidence: list[dict[str, int | str]] = []
    for session_name, session in zip(("fp32", "int8"), sessions, strict=True):
        input_names = {item.name for item in session.get_inputs()}
        for batch_size, sequence_length in ((1, 8), (20, 17), (1, 1024)):
            batch = {
                "input_ids": np.full(
                    (batch_size, sequence_length), 5, dtype=np.int64
                ),
                "attention_mask": np.ones(
                    (batch_size, sequence_length), dtype=np.int64
                ),
                "token_type_ids": np.zeros(
                    (batch_size, sequence_length), dtype=np.int64
                ),
            }
            inputs = {name: batch[name] for name in input_names}
            logits = np.asarray(session.run(None, inputs)[0]).reshape(-1)
            if len(logits) != batch_size or not np.isfinite(logits).all():
                raise RuntimeError("ONNX_DYNAMIC_GRAPH_CONTRACT_FAILED")
            evidence.append(
                {
                    "graph": session_name,
                    "batch_size": batch_size,
                    "sequence_length": sequence_length,
                }
            )
    return evidence


def assert_fidelity(
    model, tokenizer, sessions: tuple[ort.InferenceSession, ...]
) -> list[dict[str, object]]:
    evidence: list[dict[str, object]] = []
    model.eval()
    for query, documents in GOLDEN:
        batch = encode_batch(tokenizer, query, documents)
        with torch.inference_mode():
            reference = model(**{key: torch.from_numpy(value) for key, value in batch.items()}).logits.reshape(-1).tolist()
            reference_repeat = model(**{key: torch.from_numpy(value) for key, value in batch.items()}).logits.reshape(-1).tolist()
        fp32, int8 = [ort_logits(session, batch) for session in sessions]
        repeat_fp32, repeat_int8 = [ort_logits(session, batch) for session in sessions]
        expected = [0, 1, 2]
        for name, values in (("reference", reference), ("fp32", fp32), ("int8", int8)):
            if not all(math.isfinite(value) for value in values):
                raise RuntimeError(f"{name.upper()}_NONFINITE_LOGIT")
            if _ranking(values) != expected:
                raise RuntimeError(f"{name.upper()}_RELEVANCE_ORDERING_FAILED")
        if reference != reference_repeat or fp32 != repeat_fp32 or int8 != repeat_int8:
            raise RuntimeError("ONNX_NONDETERMINISTIC_OUTPUT")
        fp32_deviation, int8_deviation = _deviation(reference, fp32), _deviation(reference, int8)
        if not fp32_deviation["ordering_preserved"] or not int8_deviation["ordering_preserved"]:
            raise RuntimeError("QUANTIZATION_RELEVANCE_ORDERING_FAILED")
        evidence.append({"query": query, "reference_logits": reference, "fp32_logits": fp32, "int8_logits": int8, "sigmoid_scores": {"reference": [sigmoid(value) for value in reference], "fp32": [sigmoid(value) for value in fp32], "int8": [sigmoid(value) for value in int8]}, "fp32_deviation": fp32_deviation, "int8_deviation": int8_deviation})
    return evidence


def main() -> None:
    source = Path("/opt/reranker-source")
    artifacts = Path("/app/artifacts")
    if digest(source / "model.safetensors") != SOURCE_MODEL_SHA256:
        raise RuntimeError("SOURCE_MODEL_SHA256_MISMATCH")
    if digest(artifacts / "tokenizer.json") != ARTIFACT_SHA256_EXPECTED:
        raise RuntimeError("TOKENIZER_SHA256_MISMATCH")
    model = AutoModelForSequenceClassification.from_pretrained(source, local_files_only=True)
    model.eval()
    input_ids = torch.ones((1, 8), dtype=torch.long)
    attention_mask = torch.ones((1, 8), dtype=torch.long)
    fp32 = artifacts / "model.onnx"
    torch.onnx.export(
        model,
        (input_ids, attention_mask),
        # The legacy exporter only enables ONNX external-data output for
        # models above protobuf's 2 GiB limit when given a file-name string.
        str(fp32),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "sequence"}, "attention_mask": {0: "batch", 1: "sequence"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    int8 = artifacts / "model.int8.onnx"
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, per_channel=False, reduce_range=True)
    # The tokenizer is already checksum-pinned by the Dockerfile and remains
    # the canonical pair encoder for fidelity as well as runtime.
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(str(artifacts / "tokenizer.json"))
    fidelity_path = artifacts / "reranker-fidelity.json"
    sessions = (
        ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"]),
        ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"]),
    )
    graph_evidence = assert_dynamic_graph_contract(sessions)
    fidelity_evidence = assert_fidelity(model, tokenizer, sessions)
    fidelity_path.write_text(
        json.dumps(
            {"graph_contract": graph_evidence, "fidelity": fidelity_evidence},
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    session = sessions[1]
    inputs = [{"name": item.name, "dtype": item.type, "rank": len(item.shape), "shape": item.shape} for item in session.get_inputs()]
    outputs = [{"name": item.name, "dtype": item.type, "rank": len(item.shape), "shape": item.shape} for item in session.get_outputs()]
    graph_files = {fp32, int8}
    graph_files.update(external_data_files(fp32))
    graph_files.update(external_data_files(int8))
    files = {path.name: digest(path) for path in sorted(graph_files, key=str)}
    files["tokenizer.json"] = ARTIFACT_SHA256_EXPECTED
    runtime_paths = {int8, *external_data_files(int8), artifacts / "tokenizer.json"}
    runtime_files = {path.name: files[path.name] for path in runtime_paths}
    runtime_artifacts = Path("/app/runtime-artifacts")
    runtime_artifacts.mkdir(exist_ok=True)
    for source_path in runtime_paths:
        shutil.copy2(source_path, runtime_artifacts / source_path.name)
    (runtime_artifacts / "reranker-manifest.json").write_text(
        json.dumps({"model_name": RERANKER_MODEL_NAME, "revision": RERANKER_REVISION, "source_model_sha256": SOURCE_MODEL_SHA256, "tokenizer_sha256": ARTIFACT_SHA256_EXPECTED, "files": files, "runtime_files": runtime_files, "inputs": inputs, "outputs": outputs, "graph_contract": {"batch_axis": 0, "sequence_axis": 1, "max_batch_size": 20, "max_sequence_length": 1024, "one_logit_per_pair": True}, "exporter": {"torch": torch.__version__, "transformers": __import__("transformers").__version__, "opset": 17, "dynamo": False}, "quantizer": {"onnxruntime": ort.__version__, "kind": "dynamic-int8", "weight_type": "QInt8", "per_channel": False, "reduce_range": True}, "fidelity_evidence_sha256": digest(fidelity_path)}, sort_keys=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
