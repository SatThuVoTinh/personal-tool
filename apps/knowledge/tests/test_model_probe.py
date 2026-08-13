from __future__ import annotations

import unittest

import httpx

from app.model_probe import ModelProbeError, OllamaModelProbe


class OllamaModelProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_validates_digest_and_finite_probe_vector(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/tags":
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            return httpx.Response(200, json={"embeddings": [[0.0, 1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            resolved = await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(resolved.digest, "a" * 64)
        self.assertEqual(resolved.dimensions, 2)

    async def test_resolve_rejects_malformed_digest_without_embedding(self) -> None:
        embed_called = False

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal embed_called
            if request.url.path == "/api/tags":
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "unsafe"}]},
                )
            embed_called = True
            return httpx.Response(200, json={"embeddings": [[0.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with self.assertRaises(ModelProbeError):
                await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertFalse(embed_called)

    async def test_embed_rejects_nonfinite_values(self) -> None:
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=b'{"embeddings":[[Infinity]]}',
                headers={"content-type": "application/json"},
            )

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with self.assertRaises(ModelProbeError):
                await probe.embed("bge-m3:latest", ["text"])
        finally:
            await probe.close()
