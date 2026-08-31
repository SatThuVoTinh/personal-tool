from __future__ import annotations

import json
import unittest
from unittest.mock import patch

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
        calls = 0

        async def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
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

        self.assertEqual(calls, 1)

    async def test_embed_batches_eight_eight_remainder_in_exact_order(self) -> None:
        inputs = [f"text-{ordinal}" for ordinal in range(19)]
        observed_batches: list[list[str]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            batch = json.loads(request.content)["input"]
            observed_batches.append(batch)
            return httpx.Response(
                200,
                json={
                    "embeddings": [
                        [float(text.removeprefix("text-"))] for text in batch
                    ]
                },
            )

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            embeddings = await probe.embed("bge-m3:latest", inputs)
        finally:
            await probe.close()

        self.assertEqual([len(batch) for batch in observed_batches], [8, 8, 3])
        self.assertEqual([text for batch in observed_batches for text in batch], inputs)
        self.assertEqual(embeddings, [[float(ordinal)] for ordinal in range(19)])

    async def test_embed_retries_one_transient_http_failure(self) -> None:
        calls = 0

        async def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={"embeddings": [[1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with patch("app.model_probe._EMBED_RETRY_DELAY_SECONDS", 0):
                embeddings = await probe.embed("bge-m3:latest", ["text"])
        finally:
            await probe.close()

        self.assertEqual(calls, 2)
        self.assertEqual(embeddings, [[1.0]])

    async def test_embed_fails_after_one_timeout_retry_with_safe_category(self) -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("synthetic timeout", request=request)

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with patch("app.model_probe._EMBED_RETRY_DELAY_SECONDS", 0):
                with self.assertRaisesRegex(ModelProbeError, "^EMBEDDING_TIMEOUT$"):
                    await probe.embed("bge-m3:latest", ["text"])
        finally:
            await probe.close()

        self.assertEqual(calls, 2)

    async def test_embed_fails_after_one_transient_http_retry(self) -> None:
        calls = 0

        async def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(503)

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with patch("app.model_probe._EMBED_RETRY_DELAY_SECONDS", 0):
                with self.assertRaisesRegex(
                    ModelProbeError, "^EMBEDDING_TRANSIENT_HTTP$"
                ):
                    await probe.embed("bge-m3:latest", ["text"])
        finally:
            await probe.close()

        self.assertEqual(calls, 2)

    async def test_embed_does_not_retry_permanent_http_failure(self) -> None:
        calls = 0

        async def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(400)

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(
                ModelProbeError, "^EMBEDDING_PERMANENT_HTTP$"
            ):
                await probe.embed("bge-m3:latest", ["text"])
        finally:
            await probe.close()

        self.assertEqual(calls, 1)

    async def test_embed_empty_input_does_not_call_transport(self) -> None:
        calls = 0

        async def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(500)

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            embeddings = await probe.embed("bge-m3:latest", [])
        finally:
            await probe.close()

        self.assertEqual(embeddings, [])
        self.assertEqual(calls, 0)
