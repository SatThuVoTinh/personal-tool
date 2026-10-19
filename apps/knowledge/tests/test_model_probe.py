from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.model_probe import ModelProbeError, OllamaModelProbe


class OllamaModelProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_with_a_known_width_makes_no_embedding_call(self) -> None:
        """F-263 (R7-D10B-01): the identity check must not embed.

        `resolve` used to learn the vector width by embedding a probe
        string. The search called it twice, so one query cost two model-list
        round trips and three embedding round trips.
        """

        embed_calls = 0
        tags_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal embed_calls, tags_calls
            if request.url.path == "/api/tags":
                tags_calls += 1
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            embed_calls += 1
            return httpx.Response(200, json={"embeddings": [[0.0, 1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            resolved = await probe.resolve(
                "bge-m3:latest", expected_dimensions=1024
            )
        finally:
            await probe.close()

        self.assertEqual(embed_calls, 0)
        self.assertEqual(tags_calls, 1)
        self.assertEqual(resolved.digest, "a" * 64)
        self.assertEqual(resolved.dimensions, 1024)

    async def test_the_embedding_deadline_reaches_the_wire(self) -> None:
        """F-165 (R5-E02-06): the bound must be the request's own.

        The query embedding inherited the client's 90 s read timeout, and one
        retry doubled it, so a slow provider held a search slot for roughly
        181 s.
        """

        observed_read_timeouts: list[float] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            observed_read_timeouts.append(request.extensions["timeout"]["read"])
            return httpx.Response(200, json={"embeddings": [[0.0, 1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            timeout=httpx.Timeout(90.0, connect=3.0),
        )
        try:
            await probe.embed("bge-m3:latest", ["hello"], timeout=30.0)
            await probe.embed("bge-m3:latest", ["hello"])
        finally:
            await probe.close()

        self.assertEqual(observed_read_timeouts, [30.0, 90.0])

    async def test_resolve_validates_digest_and_finite_probe_vector(self) -> None:
        observed_preflight_inputs: list[list[str]] = []
        observed_read_timeouts: dict[str, float] = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            observed_read_timeouts[request.url.path] = request.extensions["timeout"][
                "read"
            ]
            if request.url.path == "/api/tags":
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            observed_preflight_inputs.append(json.loads(request.content)["input"])
            return httpx.Response(200, json={"embeddings": [[0.0, 1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            timeout=httpx.Timeout(90.0, connect=3.0),
        )
        try:
            resolved = await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(resolved.digest, "a" * 64)
        self.assertEqual(resolved.dimensions, 2)
        self.assertEqual(observed_preflight_inputs, [["knowledge-model-preflight"]])
        self.assertEqual(
            observed_read_timeouts,
            {"/api/tags": 10.0, "/api/embed": 90.0},
        )

    async def test_resolve_retries_each_transient_model_list_http_status(self) -> None:
        for status in (429, 502, 503, 504):
            with self.subTest(status=status):
                calls = 0

                async def handler(request: httpx.Request) -> httpx.Response:
                    nonlocal calls
                    if request.url.path == "/api/tags":
                        calls += 1
                        if calls == 1:
                            return httpx.Response(status)
                        return httpx.Response(
                            200,
                            json={
                                "models": [
                                    {"name": "bge-m3:latest", "digest": "a" * 64}
                                ]
                            },
                        )
                    return httpx.Response(200, json={"embeddings": [[0.0]]})

                probe = OllamaModelProbe("http://ollama")
                await probe._client.aclose()
                probe._client = httpx.AsyncClient(
                    transport=httpx.MockTransport(handler)
                )
                try:
                    with patch("app.model_probe._EMBED_RETRY_DELAY_SECONDS", 0):
                        resolved = await probe.resolve("bge-m3:latest")
                finally:
                    await probe.close()

                self.assertEqual(calls, 2)
                self.assertEqual(resolved.dimensions, 1)

    async def test_resolve_retries_one_model_list_transport_failure(self) -> None:
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            if request.url.path == "/api/tags":
                calls += 1
                if calls == 1:
                    raise httpx.ConnectError("synthetic transport", request=request)
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            return httpx.Response(200, json={"embeddings": [[0.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        delay = AsyncMock()
        try:
            with patch("app.model_probe.asyncio.sleep", delay):
                resolved = await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(calls, 2)
        self.assertEqual(resolved.dimensions, 1)
        delay.assert_awaited_once_with(1.0)

    async def test_resolve_fails_after_one_model_list_timeout_retry(self) -> None:
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
                    await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(calls, 2)

    async def test_resolve_does_not_retry_permanent_or_invalid_model_list(self) -> None:
        for response in (
            httpx.Response(400),
            httpx.Response(
                200,
                content=b"not-json",
                headers={"content-type": "application/json"},
            ),
        ):
            with self.subTest(status=response.status_code):
                calls = 0

                async def handler(_: httpx.Request) -> httpx.Response:
                    nonlocal calls
                    calls += 1
                    return response

                probe = OllamaModelProbe("http://ollama")
                await probe._client.aclose()
                probe._client = httpx.AsyncClient(
                    transport=httpx.MockTransport(handler)
                )
                try:
                    with self.assertRaises(ModelProbeError):
                        await probe.resolve("bge-m3:latest")
                finally:
                    await probe.close()

                self.assertEqual(calls, 1)

    async def test_resolve_retries_preflight_embedding_once(self) -> None:
        embed_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal embed_calls
            if request.url.path == "/api/tags":
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            embed_calls += 1
            if embed_calls == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={"embeddings": [[0.0, 1.0]]})

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with patch("app.model_probe._EMBED_RETRY_DELAY_SECONDS", 0):
                resolved = await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(embed_calls, 2)
        self.assertEqual(resolved.dimensions, 2)

    async def test_resolve_does_not_retry_nonfinite_preflight_embedding(self) -> None:
        embed_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal embed_calls
            if request.url.path == "/api/tags":
                return httpx.Response(
                    200,
                    json={"models": [{"name": "bge-m3:latest", "digest": "a" * 64}]},
                )
            embed_calls += 1
            return httpx.Response(
                200,
                content=b'{"embeddings":[[Infinity]]}',
                headers={"content-type": "application/json"},
            )

        probe = OllamaModelProbe("http://ollama")
        await probe._client.aclose()
        probe._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(
                ModelProbeError, "^EMBEDDING_INVALID_RESPONSE$"
            ):
                await probe.resolve("bge-m3:latest")
        finally:
            await probe.close()

        self.assertEqual(embed_calls, 1)

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
