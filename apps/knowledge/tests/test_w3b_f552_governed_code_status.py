"""F-552 (R10-T06-4): one governed code, one status, one retry verdict.

`EMBEDDING_MODEL_DRIFT` has a single producer (`index_lifecycle.py:127`) and two
HTTP answers: `/v1/search` raised it with 503, `/v1/index-runs` with 409. The
caller's retry decision is a status-integer set, so the identical model swap was
retried three times against one route and never against the other -- the
retryable answer was derived from the transport rather than from the cause.

The table these cases pin is the single owner of both answers for every code the
producer can raise. `/readyz` is deliberately outside it: its status is the
orchestrator's health signal, not a governed refusal, and a readiness probe must
answer 503 for a service that cannot serve.

These cases run in the non-skippable B5 harness, so the contract is executed on
every host, not only where the pinned tokenizer artifact exists.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from app.main import GOVERNED_LIFECYCLE_ERRORS
from app.model_probe import ResolvedEmbeddingModel
from test_b5_knowledge_http_surface import ACTIVE, KnowledgeHttpSurface

# A model that is neither the ACTIVE index's name, digest nor width.
DRIFT = ResolvedEmbeddingModel("other-model:latest", "b" * 64, 1024)


def _producer_vocabulary() -> set[str]:
    """Every code the single producer of `LifecycleError` can raise with."""

    source = (
        Path(__file__).resolve().parents[1] / "app" / "index_lifecycle.py"
    ).read_text(encoding="utf-8")
    return set(re.findall(r'LifecycleError\("([A-Z][A-Z0-9_]{0,63})"', source))


class GovernedCodeTableTests(unittest.TestCase):
    def test_the_table_covers_the_whole_producer_vocabulary(self) -> None:
        """A code with no row must not reach a route's status lookup."""

        self.assertEqual(_producer_vocabulary(), set(GOVERNED_LIFECYCLE_ERRORS))

    def test_drift_carries_one_status_and_one_retry_verdict(self) -> None:
        status, retryable = GOVERNED_LIFECYCLE_ERRORS["EMBEDDING_MODEL_DRIFT"]

        self.assertEqual(status, 409)
        self.assertFalse(
            retryable,
            "a permanent model/config conflict must be reported, not retried",
        )


class GovernedCodeStatusAgreementTests(KnowledgeHttpSurface):
    async def test_both_routes_answer_the_table_status_for_the_same_code(
        self,
    ) -> None:
        self.app.state.model_probe.resolve = AsyncMock(return_value=DRIFT)
        self.app.state.coordinator.reserve = AsyncMock()
        self.app.state.coordinator.release_reservation = AsyncMock()

        search = await self.request(
            "POST", "/v1/search", json={"query": "topic", "rerank": False}
        )
        index_run = await self.request(
            "POST", "/v1/index-runs", json={"kind": "INCREMENTAL"}
        )

        self.assertEqual(
            search.json()["detail"]["code"], "EMBEDDING_MODEL_DRIFT"
        )
        self.assertEqual(
            index_run.json()["detail"]["code"], "EMBEDDING_MODEL_DRIFT"
        )
        expected = GOVERNED_LIFECYCLE_ERRORS["EMBEDDING_MODEL_DRIFT"][0]
        self.assertEqual(
            search.status_code,
            expected,
            "/v1/search chose its own status for a governed code",
        )
        self.assertEqual(
            index_run.status_code,
            expected,
            "/v1/index-runs chose its own status for a governed code",
        )
        self.assertEqual(ACTIVE.embedding_model_name, "bge-m3:latest")


if __name__ == "__main__":
    unittest.main()
