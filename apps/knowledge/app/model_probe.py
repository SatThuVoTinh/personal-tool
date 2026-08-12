from __future__ import annotations

from dataclasses import dataclass

import httpx


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

    async def resolve(self, model_name: str) -> ResolvedEmbeddingModel:
        timeout = httpx.Timeout(10.0, connect=3.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            tags_response = await client.get(f"{self._base_url}/api/tags")
            tags_response.raise_for_status()
            model = next(
                (
                    candidate
                    for candidate in tags_response.json().get("models", [])
                    if candidate.get("name") == model_name
                ),
                None,
            )
            if model is None or not model.get("digest"):
                raise ModelProbeError("EMBEDDING_MODEL_UNAVAILABLE")

            embedding_response = await client.post(
                f"{self._base_url}/api/embed",
                json={"model": model_name, "input": "knowledge-model-preflight"},
            )
            embedding_response.raise_for_status()
            embeddings = embedding_response.json().get("embeddings")
            if not isinstance(embeddings, list) or not embeddings or not embeddings[0]:
                raise ModelProbeError("EMBEDDING_MODEL_INVALID_RESPONSE")

            return ResolvedEmbeddingModel(
                name=model_name,
                digest=model["digest"],
                dimensions=len(embeddings[0]),
            )
