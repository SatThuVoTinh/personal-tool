"""F-167 (R5-E03-05): the read-only ANN probe the owner reopened the row for.

The claim is a recall loss, not a wrong answer. `accept_incremental` clones the
whole live segment set into a shadow BUILDING index, and the HNSW index is global
and unpartitioned (`001_initial.sql:143-144`: `CREATE INDEX ... USING hnsw
(embedding vector_cosine_ops)`, no `WHERE` clause, no partition). During the run
the graph therefore holds two identical copies of every vector while
`search_candidates` filters `index_id = $1::uuid` under
`hnsw.ef_search = 100` and `LIMIT 40` -- so roughly half of the scanned
neighbours belong to the non-ACTIVE index and are thrown away before the LIMIT
fills.

The acceptance criterion is measured, not argued: candidate recall for a fixed
query set is identical with and without a shadow clone present. That needs
`EXPLAIN (ANALYZE, BUFFERS)` of the dense branch and
`SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1`, taken while no
run holds the advisory lock, against a real PostgreSQL.

GATE STATUS ON THIS HOST: NOT RUN. No Docker, no container and no PostgreSQL is
reachable from this lane, so nothing here has been executed. The case skips with
that reason named rather than reporting a pass.

Safety: the probe writes, so it must never point at a live database. It runs only
against a scratch database whose name starts with `knowledge_probe_`, applies the
pinned migrations to it through the ordinary boot path, and drops the scratch
schema when it finishes. `personal-tool-postgres-1`'s own database is not an
admitted operand.
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

import pytest

PROBE_DSN_VARIABLE = "KNOWLEDGE_POSTGRES_PROBE_DSN"
SCRATCH_PREFIX = "knowledge_probe_"
CORPUS_SIZE = 400
QUERY_SET_SIZE = 10
TOP_K = 40
DIMENSIONS = 1024
EF_SEARCH = 100
MIGRATION_DIRECTORY = Path(__file__).resolve().parents[1] / "migrations"


def _dsn() -> str | None:
    return os.environ.get(PROBE_DSN_VARIABLE) or None


def _split(dsn: str) -> dict[str, object]:
    """`postgresql://user:pass@host:port/database` as keyword arguments."""

    rest = dsn.split("://", 1)[1]
    credentials, _, location = rest.partition("@")
    user, _, password = credentials.partition(":")
    hostport, _, database = location.partition("/")
    host, _, port = hostport.partition(":")
    return {
        "user": user,
        "password": password,
        "host": host or "localhost",
        "port": int(port or 5432),
        "database": database,
    }


SERVICE_ANN_SETTINGS = (
    "SET LOCAL hnsw.iterative_scan = strict_order",
    "SET LOCAL hnsw.ef_search = 100",
    "SET LOCAL hnsw.max_scan_tuples = 20000",
    "SET LOCAL hnsw.scan_mem_multiplier = 1",
)


class ProbeServiceFidelityTests(unittest.TestCase):
    """The probe must measure the query the service actually issues.

    The measurement is only evidence for F-167 if the ANN operand carries the
    same query-scoped pgvector settings as `search_candidates`; a probe that
    omits `iterative_scan`/`scan_mem_multiplier` measures a query shape the
    service never uses. The ground-truth operand's index switch is pinned by
    its exact PostgreSQL GUC name -- the misspelt one does not exist and would
    fail the probe at run time.
    """

    def test_the_probe_issues_the_service_ann_settings(self) -> None:
        service = (
            Path(__file__).resolve().parents[1] / "app" / "database.py"
        ).read_text(encoding="utf-8")
        probe = Path(__file__).read_text(encoding="utf-8")
        for statement in SERVICE_ANN_SETTINGS:
            self.assertIn(statement, service)
            self.assertIn(statement, probe)

    def test_the_ground_truth_operand_disables_the_named_index_guc(self) -> None:
        probe = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("SET LOCAL enable_indexscan = off", probe)
        # Spelled in two pieces so this assertion does not pin itself.
        self.assertNotIn("SET LOCAL enable" "indexscan = off", probe)


def _vectors(count: int, seed: int) -> list[list[float]]:
    """A deterministic fixed set; the probe must compare like with like."""

    state = seed
    values: list[list[float]] = []
    for _ in range(count):
        vector: list[float] = []
        for _ in range(DIMENSIONS):
            state = (1103515245 * state + 12345) % (2**31)
            vector.append((state / 2**31) - 0.5)
        norm = sum(value * value for value in vector) ** 0.5
        values.append([value / norm for value in vector])
    return values


@pytest.mark.skipif(
    _dsn() is None,
    reason=(
        f"{PROBE_DSN_VARIABLE} is unset and no PostgreSQL is reachable from this "
        "lane; the F-167 operand is NOT RUN, never passed"
    ),
)
class DenseBranchRecallProbe(unittest.IsolatedAsyncioTestCase):
    """Recall with and without the shadow clone, plus the two read-only plans."""

    async def asyncSetUp(self) -> None:
        import asyncpg

        dsn = _dsn()
        assert dsn is not None
        arguments = _split(dsn)
        database_name = str(arguments["database"])
        if not database_name.startswith(SCRATCH_PREFIX):
            self.skipTest(
                f"{PROBE_DSN_VARIABLE} must name a scratch database starting "
                f"with {SCRATCH_PREFIX!r}; refusing to probe {database_name!r}"
            )
        self.connection = await asyncpg.connect(**arguments)  # type: ignore[arg-type]
        await self._apply_migrations()

    async def asyncTearDown(self) -> None:
        # Only the probe's own schema goes; `public` carries the `vector`
        # extension the next run needs.
        await self.connection.execute("DROP SCHEMA IF EXISTS knowledge CASCADE")
        await self.connection.close()

    async def _apply_migrations(self) -> None:
        for path in sorted(MIGRATION_DIRECTORY.glob("*.sql")):
            await self.connection.execute(path.read_text(encoding="utf-8"))

    async def _no_run_holds_the_lock(self) -> None:
        running = await self.connection.fetchval(
            "SELECT count(*) FROM knowledge.index_runs WHERE status = 'RUNNING'"
        )
        self.assertEqual(
            running,
            0,
            "the probe must be taken while no index run holds the advisory lock",
        )

    async def _seed_active_index(self, index_id: str, vectors: list[list[float]]) -> None:
        import uuid as uuid_module

        self.active_source_id = str(uuid_module.uuid4())
        self.active_run_id = str(uuid_module.uuid4())
        self.active_index_id = index_id
        await self.connection.execute(
            """
            INSERT INTO knowledge.indexes
                (id, status, embedding_model_name, embedding_model_digest,
                 embedding_dimensions)
            VALUES ($1, 'ACTIVE', 'probe-model', $2, $3)
            """,
            index_id,
            "a" * 64,
            DIMENSIONS,
        )
        await self.connection.execute(
            """
            INSERT INTO knowledge.index_runs
                (id, index_id, kind, status)
            VALUES ($1, $2, 'FULL_REBUILD', 'SUCCEEDED')
            """,
            self.active_run_id,
            index_id,
        )
        await self.connection.execute(
            """
            INSERT INTO knowledge.sources
                (id, index_id, source_type, source_path, sha256, mime_type, title,
                 primary_topic, indexed_by_run_id)
            VALUES ($1, $2, 'MARKDOWN', 'probe/note.md', $3, 'text/markdown',
                    'Probe', 'probe', $4)
            """,
            self.active_source_id,
            index_id,
            "c" * 64,
            self.active_run_id,
        )
        await self.connection.executemany(
            """
            INSERT INTO knowledge.segments
                (id, index_id, source_id, segment_type, chunk_ordinal, source_path,
                 title, primary_topic, text, embedding, indexed_by_run_id)
            VALUES ($1, $2, $3, 'MARKDOWN_PASSAGE', $4, 'probe/note.md', 'Probe',
                    'probe', 'body', $5::vector, $6)
            """,
            [
                (
                    str(uuid_module.uuid4()),
                    index_id,
                    self.active_source_id,
                    ordinal,
                    "[" + ",".join(format(value, ".17g") for value in vector) + "]",
                    self.active_run_id,
                )
                for ordinal, vector in enumerate(vectors)
            ],
        )

    async def _clone_under_a_shadow_index(self, shadow_id: str) -> None:
        """The shape `database.accept_incremental` produces: every live vector
        copied once more under a BUILDING shadow index, keyed to the shadow's
        own staged source rows by `source_path`."""

        import uuid as uuid_module

        shadow_run_id = str(uuid_module.uuid4())
        await self.connection.execute(
            """
            INSERT INTO knowledge.indexes
                (id, status, embedding_model_name, embedding_model_digest,
                 embedding_dimensions)
            VALUES ($1, 'BUILDING', 'probe-model', $2, $3)
            """,
            shadow_id,
            "a" * 64,
            DIMENSIONS,
        )
        await self.connection.execute(
            """
            INSERT INTO knowledge.index_runs
                (id, index_id, kind, status)
            VALUES ($1, $2, 'INCREMENTAL', 'RUNNING')
            """,
            shadow_run_id,
            shadow_id,
        )
        await self.connection.execute(
            """
            INSERT INTO knowledge.sources
                (id, index_id, source_type, source_path, sha256, mime_type, title,
                 primary_topic, indexed_by_run_id)
            SELECT gen_random_uuid(), $1, source_type, source_path, sha256,
                   mime_type, title, primary_topic, $2
            FROM knowledge.sources
            WHERE index_id = $3
            """,
            shadow_id,
            shadow_run_id,
            self.active_index_id,
        )
        await self.connection.execute(
            """
            INSERT INTO knowledge.segments
                (id, index_id, source_id, segment_type, chunk_ordinal, source_path,
                 title, primary_topic, text, embedding, indexed_by_run_id)
            SELECT gen_random_uuid(), $1, staged.id, live.segment_type,
                   live.chunk_ordinal, live.source_path, live.title,
                   live.primary_topic, live.text, live.embedding, $2
            FROM knowledge.segments live
            JOIN knowledge.sources staged
              ON staged.index_id = $1 AND staged.source_path = live.source_path
            WHERE live.index_id = $3
            """,
            shadow_id,
            shadow_run_id,
            self.active_index_id,
        )

    async def _apply_ann_settings(self) -> None:
        """The exact query-scoped settings `search_candidates` issues.

        F-167: the probe used to omit `iterative_scan` and
        `scan_mem_multiplier`, so it measured a query shape the service never
        runs. The static fidelity case above binds these two copies.
        """

        await self.connection.execute("SET LOCAL hnsw.iterative_scan = strict_order")
        await self.connection.execute("SET LOCAL hnsw.ef_search = 100")
        await self.connection.execute("SET LOCAL hnsw.max_scan_tuples = 20000")
        await self.connection.execute("SET LOCAL hnsw.scan_mem_multiplier = 1")

    async def _ann_ids(self, index_id: str, vector: list[float]) -> set[str]:
        """The dense branch of `search_candidates`, verbatim in its settings."""

        literal = "[" + ",".join(format(value, ".17g") for value in vector) + "]"
        async with self.connection.transaction(
            isolation="repeatable_read", readonly=True
        ):
            await self._apply_ann_settings()
            rows = await self.connection.fetch(
                """
                WITH ann AS MATERIALIZED (
                  SELECT segments.id
                  FROM knowledge.segments segments
                  WHERE segments.index_id = $1::uuid
                    AND segments.segment_type = ANY($3::text[])
                  ORDER BY segments.embedding <=> $2::vector ASC
                  LIMIT 40
                )
                SELECT id FROM ann ORDER BY id
                """,
                index_id,
                literal,
                ["MARKDOWN_PASSAGE"],
            )
        return {str(row["id"]) for row in rows}

    async def _exact_ids(self, index_id: str, vector: list[float]) -> set[str]:
        """Ground truth: the same LIMIT without the ANN index."""

        literal = "[" + ",".join(format(value, ".17g") for value in vector) + "]"
        async with self.connection.transaction(
            isolation="repeatable_read", readonly=True
        ):
            await self.connection.execute("SET LOCAL enable_indexscan = off")
            rows = await self.connection.fetch(
                """
                SELECT segments.id
                FROM knowledge.segments segments
                WHERE segments.index_id = $1::uuid
                  AND segments.segment_type = ANY($3::text[])
                ORDER BY segments.embedding <=> $2::vector ASC
                LIMIT 40
                """,
                index_id,
                literal,
                ["MARKDOWN_PASSAGE"],
            )
        return {str(row["id"]) for row in rows}

    async def _explain(self, index_id: str, vector: list[float]) -> object:
        """`EXPLAIN (ANALYZE, BUFFERS)` of the service's own dense branch."""

        literal = "[" + ",".join(format(value, ".17g") for value in vector) + "]"
        async with self.connection.transaction(
            isolation="repeatable_read", readonly=True
        ):
            await self._apply_ann_settings()
            return await self.connection.fetch(
                "EXPLAIN (ANALYZE, BUFFERS) "
                "SELECT segments.id FROM knowledge.segments segments "
                "WHERE segments.index_id = $1::uuid "
                "AND segments.segment_type = ANY($2::text[]) "
                "ORDER BY segments.embedding <=> $3::vector ASC LIMIT 40",
                index_id,
                ["MARKDOWN_PASSAGE"],
                literal,
            )

    async def test_candidate_recall_is_identical_with_and_without_a_shadow_clone(
        self,
    ) -> None:
        import uuid as uuid_module

        active_id = str(uuid_module.uuid4())
        shadow_id = str(uuid_module.uuid4())

        corpus = _vectors(CORPUS_SIZE, seed=7)
        queries = _vectors(QUERY_SET_SIZE, seed=99)

        await self._seed_active_index(active_id, corpus)
        await self._no_run_holds_the_lock()

        clean_recall = []
        for vector in queries:
            truth = await self._exact_ids(active_id, vector)
            found = await self._ann_ids(active_id, vector)
            clean_recall.append(len(truth & found) / len(truth))

        # The EXPLAIN (ANALYZE, BUFFERS) operand the row asks for, taken on the
        # clean graph first so the two plans can be compared line by line.
        clean_plan = await self._explain(active_id, queries[0])

        await self._clone_under_a_shadow_index(shadow_id)
        # Without this the comparison is vacuous: a clone that inserted nothing
        # would leave the two recalls trivially equal and read as a refutation.
        cloned = await self.connection.fetchval(
            "SELECT count(*) FROM knowledge.segments WHERE index_id = $1",
            shadow_id,
        )
        self.assertEqual(
            cloned,
            CORPUS_SIZE,
            "the shadow clone did not copy the live segment set; the probe "
            "measured nothing",
        )

        shadow_recall = []
        for vector in queries:
            truth = await self._exact_ids(active_id, vector)
            found = await self._ann_ids(active_id, vector)
            shadow_recall.append(len(truth & found) / len(truth))

        shadow_plan = await self._explain(active_id, queries[0])

        # The second read-only operand: the per-index segment census, which is
        # what shows the duplicate copies the graph is carrying.
        census = await self.connection.fetch(
            "SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1"
        )

        plan = "\n".join(row[0] for row in (*clean_plan, *shadow_plan))
        census_lines = "\n".join(
            f"{row['index_id']}: {row['count']}" for row in census
        )
        print(f"clean recall {clean_recall}\nshadow recall {shadow_recall}\n{plan}\n{census_lines}")

        self.assertEqual(
            shadow_recall,
            clean_recall,
            "the shadow clone changed dense-branch recall; the row stands",
        )


if __name__ == "__main__":
    unittest.main()
