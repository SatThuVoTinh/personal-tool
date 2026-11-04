"""M12/T2.2-R2 B-18 (`R6-V03-02`): no codeless 500 out of the index-run routes.

`/v1/search` maps an unmapped fault to a terminal
`HTTPException(500, {"code": "INTERNAL_ERROR"})`. `create_index_run` and
`get_index_run` stop at their specific mappers, so any fault outside the mapped
classes escapes as an unhandled exception and FastAPI answers its default 500 --
an empty body. `knowledge-adapter.mjs` then flattens that to `HTTP_500` with
nothing to attribute, which is two of the three routes being unattributable at
the place the audit item did not point.

The fix reuses the mapping the search route already performs. Nothing else
moves: the status stays 500, the code matches `_SAFE_ERROR_CODE`, no logging
channel is introduced (`run_errors.py` stays read-only per §3), and every
response a caller can get today is byte-identical.

External seams are patched on the app's own state objects, exactly as
`test_m11_api_attribution.py` does, so no database, Ollama, or PDF runtime is
contacted.
"""

from __future__ import annotations

import asyncio
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

os.environ.setdefault("KNOWLEDGE_DATABASE_PASSWORD", "unit-test-only")

_TOKENIZER = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
if not _TOKENIZER or not Path(_TOKENIZER).is_file():
    pytest.skip(
        "the pinned tokenizer is not provisioned; CI fetches it "
        "(.github/workflows/ci.yml), so this module is NOT RUN rather than passed",
        allow_module_level=True,
    )

from app.config import Settings
from app.database import ActiveIndex, IndexRunState
from app.main import IndexRunRequest, create_app

ACTIVE = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)
FAULT_TEXT = "adapter closed mid-write: pool detail that must not reach a client"


class IndexRunAttributionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.vault = TemporaryDirectory()
        (Path(self.vault.name) / "01. Knowledge").mkdir()
        self.app = create_app(
            Settings(
                database_host="unused",
                database_port=5432,
                database_name="unused",
                database_user="unused",
                database_password="unused",
                ollama_url="http://unused",
                embedding_model="bge-m3:latest",
                embedding_dimensions=1024,
                advisory_lock_key=1,
                migration_directory=Path("/app/migrations"),
                vault_root=Path(self.vault.name),
                tokenizer_path=Path(os.environ["KNOWLEDGE_TOKENIZER_PATH"]),
            )
        )
        self.app.state.database._pool = object()  # type: ignore[assignment]
        self.app.state.coordinator.reserve = AsyncMock()
        self.app.state.coordinator.release_reservation = AsyncMock()

    async def asyncTearDown(self) -> None:
        await self.app.state.model_probe.close()
        self.vault.cleanup()

    async def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        # `raise_server_exceptions=False` is what makes this a wire-level claim:
        # an unmapped fault is observed as the response the adapter actually
        # receives, not as an exception re-raised into the test process.
        transport = httpx.ASGITransport(app=self.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            return await client.request(method, url, **kwargs)

    def endpoint(self, path: str):
        for route in self.app.routes:
            if getattr(route, "path", None) == path:
                return route.endpoint
        self.fail(f"{path} is no longer a route")

    async def test_an_unmapped_admission_fault_answers_a_code_at_500(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(
            side_effect=RuntimeError(FAULT_TEXT)
        )

        response = await self.request(
            "POST", "/v1/index-runs", json={"kind": "FULL_REBUILD"}
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], {"code": "INTERNAL_ERROR"})
        self.assertNotIn(FAULT_TEXT, response.text)

    async def test_an_unmapped_run_lookup_fault_answers_a_code_at_500(self) -> None:
        self.app.state.database.get_run = AsyncMock(side_effect=RuntimeError(FAULT_TEXT))

        response = await self.request("GET", "/v1/index-runs/run-1")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], {"code": "INTERNAL_ERROR"})
        self.assertNotIn(FAULT_TEXT, response.text)

    async def test_each_route_keeps_the_underlying_error_as_its_cause(self) -> None:
        admission_fault = RuntimeError(FAULT_TEXT)
        self.app.state.database.get_active_index = AsyncMock(
            side_effect=admission_fault
        )
        with self.assertRaises(HTTPException) as raised:
            await self.endpoint("/v1/index-runs")(
                IndexRunRequest(kind="FULL_REBUILD")
            )
        self.assertEqual(raised.exception.status_code, 500)
        self.assertIs(raised.exception.__cause__, admission_fault)

        lookup_fault = RuntimeError(FAULT_TEXT)
        self.app.state.database.get_run = AsyncMock(side_effect=lookup_fault)
        with self.assertRaises(HTTPException) as raised:
            await self.endpoint("/v1/index-runs/{run_id}")(run_id="run-1")
        self.assertEqual(raised.exception.status_code, 500)
        self.assertIs(raised.exception.__cause__, lookup_fault)

    async def test_a_routed_http_exception_keeps_its_own_status(self) -> None:
        # `create_index_run` raises inside its own `try` body, so a terminal
        # `except Exception` without a passthrough would rewrite this 409 as a
        # 500 and turn a documented conflict into a phantom server fault.
        self.app.state.database.get_active_index = AsyncMock(return_value=None)

        response = await self.request(
            "POST", "/v1/index-runs", json={"kind": "INCREMENTAL"}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], {"code": "NO_ACTIVE_INDEX"})

    async def test_a_database_outage_is_still_a_503_not_the_new_500(self) -> None:
        self.app.state.database.get_active_index = AsyncMock(
            side_effect=asyncio.TimeoutError()
        )

        response = await self.request(
            "POST", "/v1/index-runs", json={"kind": "FULL_REBUILD"}
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], {"code": "DATABASE_UNAVAILABLE"})

    async def test_a_successful_run_response_is_unchanged(self) -> None:
        self.app.state.database.get_run = AsyncMock(
            return_value=IndexRunState(
                id="run-1",
                index_id="index-1",
                kind="INCREMENTAL",
                status="SUCCEEDED",
                started_at="2026-10-16T00:00:00Z",
                finished_at="2026-10-16T00:01:00Z",
                sources_discovered=2,
                sources_indexed=2,
                sources_failed=0,
                failure_code=None,
                failure_detail=None,
            )
        )
        self.app.state.database.get_run_source_counts = AsyncMock(return_value=[])

        response = await self.request("GET", "/v1/index-runs/run-1")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["index_run_id"], "run-1")
        self.assertEqual(body["status"], "SUCCEEDED")
        self.assertEqual(
            body["failure"],
            {"errors": [], "total_error_count": 0, "truncated": False},
        )
        self.assertEqual(
            set(body),
            {
                "index_run_id",
                "index_id",
                "kind",
                "status",
                "started_at",
                "finished_at",
                "sources_discovered",
                "sources_indexed",
                "sources_failed",
                "failure_code",
                "failure",
                "source_counts",
            },
        )


if __name__ == "__main__":
    unittest.main()
