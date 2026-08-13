from __future__ import annotations

import math
import re
from dataclasses import dataclass

import httpx

_MODEL_DIGEST = re.compile(r"^[a-f0-9]{64}$")


class ModelProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResolvedEmbeddingModel:
    name: str
    digest: str
    dimensions: int


class OllamaModelProbe:
    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=3.0))

    async def close(self) -> None:
        await self._client.aclose()

    async def resolve(self, model_name: str) -> ResolvedEmbeddingModel:
        timeout = httpx.Timeout(10.0, connect=3.0)
        tags_response = await self._client.get(
            f"{self._base_url}/api/tags", timeout=timeout
        )
        tags_response.raise_for_status()
        try:
            tags_payload = tags_response.json()
        except ValueError as error:
            raise ModelProbeError("EMBEDDING_MODEL_INVALID_RESPONSE") from error
        models = tags_payload.get("models") if isinstance(tags_payload, dict) else None
        if not isinstance(models, list):
            raise ModelProbeError("EMBEDDING_MODEL_INVALID_RESPONSE")
        model = next(
            (
                candidate
                for candidate in models
                if isinstance(candidate, dict)
                if candidate.get("name") == model_name
            ),
            None,
        )
        digest = model.get("digest") if isinstance(model, dict) else None
        if not isinstance(digest, str) or not _MODEL_DIGEST.fullmatch(digest):
            raise ModelProbeError("EMBEDDING_MODEL_UNAVAILABLE")

        embedding_response = await self._client.post(
            f"{self._base_url}/api/embed",
            json={"model": model_name, "input": "knowledge-model-preflight"},
            timeout=timeout,
        )
        embedding_response.raise_for_status()
        embeddings = self._response_embeddings(embedding_response, 1)

        return ResolvedEmbeddingModel(
            name=model_name,
            digest=digest,
            dimensions=len(embeddings[0]),
        )

    async def embed(self, model_name: str, texts: list[str]) -> list[list[float]]:
        """Return one finite embedding per supplied retrieval text."""
        if not texts:
            return []
        response = await self._client.post(
            f"{self._base_url}/api/embed",
            json={"model": model_name, "input": texts},
        )
        response.raise_for_status()
        return self._response_embeddings(response, len(texts))

    @staticmethod
    def _response_embeddings(
        response: httpx.Response, expected_count: int
    ) -> list[list[float]]:
        try:
            payload = response.json()
        except ValueError as error:
            raise ModelProbeError("EMBEDDING_INVALID_RESPONSE") from error
        embeddings = payload.get("embeddings") if isinstance(payload, dict) else None
        if not isinstance(embeddings, list) or len(embeddings) != expected_count:
            raise ModelProbeError("EMBEDDING_INVALID_RESPONSE")
        normalized: list[list[float]] = []
        for embedding in embeddings:
            if not isinstance(embedding, list) or not embedding:
                raise ModelProbeError("EMBEDDING_INVALID_RESPONSE")
            try:
                vector = [float(value) for value in embedding]
            except (TypeError, ValueError) as error:
                raise ModelProbeError("EMBEDDING_INVALID_RESPONSE") from error
            if not all(math.isfinite(value) for value in vector):
                raise ModelProbeError("EMBEDDING_INVALID_RESPONSE")
            normalized.append(vector)
        return normalized
