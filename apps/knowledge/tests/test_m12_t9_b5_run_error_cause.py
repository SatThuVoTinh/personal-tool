"""M12/T9-R4 B5 (`F-550`): a durable run error carries the cause it computed.

A PDF child killed by a signal and a child that could not find its model
artifact both reached the same line, and both persisted the constant
`PDF_RUNTIME_FAILED` with nothing that said WHY. The diagnosis already existed
one call earlier (`_child_failure_detail` returns `exit=N; stderr=…`) and was
dropped, because `SafeRunError` was frozen as a two-member record.

These cases drive the real lifecycle loop against a recording fake database, so
the contract holds without Postgres, Ollama or a tokenizer artifact:

  * two different child exit codes produce two different durable rows, and each
    names its own cause;
  * the cause is bounded and scrubbed, so a chatty child cannot inflate the
    record and no control character lands in it;
  * a row written before the cause member existed still reads back;
  * a state the store refused is recorded as a state failure, not as a runtime
    failure.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from app.database import AcceptedIndexRun, ActiveIndex, StateTransitionError
from app.index_lifecycle import IndexLifecycle, LifecycleDependencies
from app.markdown_adapter import MarkdownScanResult
from app.model_probe import ResolvedEmbeddingModel
from app.pdf_foundation import PdfSidecar
from app.pdf_pipeline import PdfBuildError
from app.pdf_runtime import _CHILD_DETAIL_LIMIT
from app.run_errors import (
    CHILD_DETAIL_LIMIT,
    SafeRunError,
    deserialize_errors,
    serialize_errors,
)

INDEX = ActiveIndex("index-1", "bge-m3:latest", "a" * 64, 1024)
SIDECAR_SOURCE = "02. Books/Authority/report.pdf"


def sidecar() -> PdfSidecar:
    return PdfSidecar(
        sidecar_path="02. Books/Authority/report.md",
        source_path=SIDECAR_SOURCE,
        title="Report",
        canonical_topics=("AI",),
        tags=("ai",),
        pdf_digest="b" * 64,
        sidecar_digest="c" * 64,
    )


class _EmptyScanner:
    def scan_vault(
        self, _: Path, *, include_valid_sources_on_error: bool = False
    ) -> MarkdownScanResult:
        return MarkdownScanResult(True, 0, 0, (), ())


class _MatchingProbe:
    async def resolve(
        self, _: str, expected_dimensions: int | None = None
    ) -> ResolvedEmbeddingModel:
        return ResolvedEmbeddingModel(
            INDEX.embedding_model_name,
            INDEX.embedding_model_digest,
            INDEX.embedding_dimensions,
        )


class _RecordingDatabase:
    def __init__(self) -> None:
        self.failures: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    async def get_index(self, _: str) -> ActiveIndex:
        return INDEX

    async def get_active_index(self) -> ActiveIndex:
        return INDEX

    async def set_discovered(self, _: str, __: int) -> None:
        return None

    async def source_hashes(self, _: str) -> dict[str, str]:
        return {}

    async def source_count(self, _: str) -> int:
        return 0

    async def pdf_content_is_reclaimed(self, *_: object) -> bool:
        return False

    async def fail_run(self, *args: Any, **kwargs: Any) -> None:
        self.failures.append((args, kwargs))

    async def complete_incremental(self, *_: object) -> list[str]:
        raise AssertionError("a failed full rebuild must not complete")

    async def publish_full_rebuild(self, *_: object) -> list[str]:
        raise AssertionError("a failed full rebuild must not publish")

    async def cleanup_superseded(self, _: list[str]) -> None:
        return None


class _FailingBuilder:
    def __init__(self, error: Exception) -> None:
        self.error = error

    async def build(self, *_: object) -> Any:
        raise self.error

    async def revalidate_identity(self, *_: object) -> None:
        raise AssertionError("a refused build must not be revalidated")


def lifecycle(database: _RecordingDatabase, builder: _FailingBuilder) -> IndexLifecycle:
    return IndexLifecycle(
        LifecycleDependencies(
            database=database,  # type: ignore[arg-type]
            model_probe=_MatchingProbe(),  # type: ignore[arg-type]
            scanner=_EmptyScanner(),  # type: ignore[arg-type]
            vault_root=Path("/vault"),
            embedding_model=INDEX.embedding_model_name,
            embedding_dimensions=INDEX.embedding_dimensions,
            pdf_builder=builder,  # type: ignore[arg-type]
            pdf_processing_identity=lambda _: "d" * 64,
        )
    )


async def _durable_detail(error: Exception) -> str:
    """Run one full rebuild whose PDF build raises `error`, read the durable row."""

    database = _RecordingDatabase()
    instance = lifecycle(database, _FailingBuilder(error))
    with patch(
        "app.index_lifecycle.discover_pdf_sidecars", return_value=(sidecar(),)
    ):
        await instance.execute(
            AcceptedIndexRun("run-1", INDEX.id, "FULL_REBUILD", "RUNNING")
        )

    assert len(database.failures) == 1, database.failures
    errors = database.failures[0][0][2]
    return serialize_errors(errors)


class DurableCauseTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_child_exit_codes_produce_different_durable_rows(
        self,
    ) -> None:
        """F-550 (R10-T06-2): the run row says HOW the child died.

        An OOM kill (exit -9) and a missing artifact (exit 1) both surface as
        `PDF_RUNTIME_FAILED` and used to persist byte-identically.
        """

        killed = await _durable_detail(
            PdfBuildError("PDF_RUNTIME_FAILED", "exit=-9; stderr=Killed")
        )
        missing = await _durable_detail(
            PdfBuildError("PDF_RUNTIME_FAILED", "exit=1; stderr=artifact not found")
        )

        self.assertNotEqual(killed, missing)
        self.assertIn("exit=-9", deserialize_errors(killed)["errors"][0]["cause"])
        self.assertIn(
            "artifact not found",
            deserialize_errors(missing)["errors"][0]["cause"],
        )

    async def test_a_state_refusal_is_not_recorded_as_a_runtime_failure(
        self,
    ) -> None:
        """F-550 (R10-T06-2): the store declining a row is not the child dying.

        The cause channel stays with the child: an internal fault's message must
        not ride into the durable row or out through the run response.
        """

        detail = await _durable_detail(
            StateTransitionError("host=internal-db port=5432")
        )

        entry = deserialize_errors(detail)["errors"][0]
        self.assertEqual(entry["code"], "PDF_BUILD_STATE_INVALID")
        self.assertIsNone(entry["cause"])
        self.assertNotIn("internal-db", detail)


class CauseShapeTests(unittest.TestCase):
    """F-550 (R10-T06-2): the carried diagnosis is bounded and scrubbed."""

    def test_an_unbounded_or_control_character_cause_is_cut_to_the_child_bound(
        self,
    ) -> None:
        long = _long("x")
        serialized = deserialize_errors(
            serialize_errors([SafeRunError("PDF_RUNTIME_FAILED", None, long)])
        )
        cause = serialized["errors"][0]["cause"]
        self.assertEqual(len(cause), CHILD_DETAIL_LIMIT)

        control = deserialize_errors(
            serialize_errors([SafeRunError("PDF_RUNTIME_FAILED", None, "killed\x00by\x1binit")])
        )["errors"][0]["cause"]
        self.assertNotIn("\x00", control)
        self.assertNotIn("\x1b", control)
        self.assertIn("killed", control)

    def test_the_bound_is_the_same_number_the_child_summary_uses(self) -> None:
        # Two bounds drift; one bound cannot. The child's summary is the only
        # producer of a cause, so a cause that fits its message always fits the
        # row it lands in.
        self.assertEqual(CHILD_DETAIL_LIMIT, _CHILD_DETAIL_LIMIT)

    def test_a_row_written_before_the_cause_member_still_reads_back(self) -> None:
        legacy = (
            '{"errors":[{"code":"PDF_RUNTIME_FAILED","source_path":null}],'
            '"total_error_count":1,"truncated":false}'
        )

        self.assertEqual(
            deserialize_errors(legacy)["errors"],
            [{"code": "PDF_RUNTIME_FAILED", "source_path": None, "cause": None}],
        )

    def test_an_injected_cause_that_is_not_the_scrubbed_form_is_refused(self) -> None:
        smuggled = (
            '{"errors":[{"code":"PDF_RUNTIME_FAILED","source_path":null,'
            '"cause":"line\\nbreak"}],"total_error_count":1,"truncated":false}'
        )

        self.assertEqual(
            deserialize_errors(smuggled)["errors"][0]["code"], "LEGACY_FAILURE_DETAIL"
        )


def _long(character: str) -> str:
    return character * (CHILD_DETAIL_LIMIT + 64)


if __name__ == "__main__":
    unittest.main()
