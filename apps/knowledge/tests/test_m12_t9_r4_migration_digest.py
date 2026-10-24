"""M12/T9-R4 `F-547` / `F-541`: the module that applies a migration enforces
the published immutability rule.

Both `docs/contracts/*-migration-digests.json` stores published the expected
bytes and NO runner read them: the Knowledgebase keyed its ledger on the filename
alone, so editing an already-applied `.sql` in place was a silent no-op on every
database that had adopted it, and rolling the JSON alongside the edit re-
legitimised the drift in the one repo lane that could see it. The apply seam now
resolves the published digest for every listed file and refuses the boot before
applying anything, and migration `005` gives each database its own witness: a
recorded digest that a later manifest roll cannot satisfy.

These cases drive the real `_apply_migrations` against a recording fake, so the
contract holds without Postgres or Docker.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest import IsolatedAsyncioTestCase, TestCase, main
from unittest.mock import AsyncMock, patch

from app.database import (
    MIGRATION_DIGEST_MANIFEST,
    KnowledgeDatabase,
    MigrationDigestError,
    published_migration_digests,
)

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class _Transaction:
    async def __aenter__(self) -> "_Transaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class RecordingConnection:
    """The migration surface `KnowledgeDatabase` uses, with nothing behind it.

    `adopted` names the versions whose ledger row already exists; `ledger_rows`
    is what the digest pass reads back, so a case can say what THIS database
    recorded independently of what the repository publishes.
    """

    def __init__(
        self,
        *,
        adopted: tuple[str, ...] = (),
        ledger_rows: tuple[dict[str, Any], ...] = (),
    ) -> None:
        self.adopted = set(adopted)
        self.ledger_rows = list(ledger_rows)
        self.calls: list[tuple[str, str, tuple[Any, ...]]] = []

    def is_closed(self) -> bool:
        return False

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def execute(self, sql: str, *args: object) -> None:
        self.calls.append(("execute", " ".join(sql.split()), args))

    async def fetchval(self, sql: str, *args: object) -> object:
        normalized = " ".join(sql.split())
        self.calls.append(("fetchval", normalized, args))
        if "FROM knowledge.schema_migrations WHERE version" in normalized:
            return str(args[0]) in self.adopted
        raise AssertionError(f"unexpected fetchval: {normalized}")

    async def fetch(self, sql: str, *args: object) -> list[dict[str, Any]]:
        normalized = " ".join(sql.split())
        self.calls.append(("fetch", normalized, args))
        if normalized.startswith(
            "SELECT version, digest FROM knowledge.schema_migrations"
        ):
            return self.ledger_rows
        raise AssertionError(f"unexpected fetch: {normalized}")

    def statements(self, verb: str = "execute") -> list[str]:
        return [statement for (called, statement, _) in self.calls if called == verb]

    def args_for(self, prefix: str) -> list[tuple[Any, ...]]:
        return [args for (_, statement, args) in self.calls if statement.startswith(prefix)]


class _Pool:
    """The pool surface the boot path uses, handing out one recording connection."""

    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection
        self.closed = False

    async def acquire(self) -> RecordingConnection:
        return self.connection

    async def release(self, connection: RecordingConnection) -> None:
        return None

    async def close(self) -> None:
        self.closed = True


def database_pointing_at(directory: Path, connection: RecordingConnection) -> KnowledgeDatabase:
    database = KnowledgeDatabase(
        "localhost", 5432, "knowledge", "zink", "secret", directory
    )
    database._pool = _Pool(connection)  # type: ignore[assignment]
    return database


def migration_copy(
    directory: str, name: str, *, mutate: "str | None" = None
) -> Path:
    """Copy a shipped migration into a fixture directory.

    `mutate` is appended to the copy, so the file keeps its published NAME (and
    so the published manifest still carries an expectation for it) while its
    BYTES are no longer the published ones.
    """

    target = Path(directory, name)
    text = (MIGRATIONS_DIR / name).read_text(encoding="utf-8")
    target.write_text(text if mutate is None else text + mutate, encoding="utf-8")
    return target


class PublishedManifestTests(TestCase):
    def test_the_manifest_names_every_shipped_migration_with_its_current_bytes(self) -> None:
        """F-547: the runner trusts this file, so it must be current."""

        published = published_migration_digests()
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            self.assertIn(path.name, published, f"{path.name} carries no published digest")
            self.assertEqual(
                published[path.name],
                sha256_of(path),
                f"{path.name} is not the bytes the manifest publishes",
            )

    def test_the_manifest_is_read_from_the_module_carrier(self) -> None:
        """F-547: the image copies apps/knowledge/ and cannot reach docs/, so the
        runner's carrier is the module's own -- pinned byte-identical to the
        contract by tests/m12-t2.2-a4-migration-digest.test.mjs."""

        self.assertEqual(
            MIGRATION_DIGEST_MANIFEST,
            Path(__file__).resolve().parents[1]
            / "contracts"
            / "knowledgebase-migration-digests.json",
        )
        self.assertTrue(MIGRATION_DIGEST_MANIFEST.exists())
        self.assertEqual(MIGRATION_DIGEST_MANIFEST, MIGRATIONS_DIR.parent / "contracts" / MIGRATION_DIGEST_MANIFEST.name)


class ManifestUnreadableTests(TestCase):
    def test_an_unreadable_manifest_is_a_named_refusal_not_an_empty_table(self) -> None:
        """F-547: a boot that silently lost the published values would adopt
        whatever bytes it found."""

        with TemporaryDirectory() as directory:
            missing = Path(directory, "absent.json")
            with self.assertRaises(MigrationDigestError) as caught:
                published_migration_digests(missing)
            self.assertEqual(caught.exception.code, "KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE")

            malformed = Path(directory, "malformed.json")
            malformed.write_text('{"digestAlgorithm": "sha256"}', encoding="utf-8")
            with self.assertRaises(MigrationDigestError) as caught:
                published_migration_digests(malformed)
            self.assertEqual(caught.exception.code, "KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE")

            truncated = Path(directory, "truncated.json")
            truncated.write_text("{ not json", encoding="utf-8")
            with self.assertRaises(MigrationDigestError) as caught:
                published_migration_digests(truncated)
            self.assertEqual(caught.exception.code, "KNOWLEDGE_MIGRATION_MANIFEST_UNREADABLE")


class ApplySeamDigestTests(IsolatedAsyncioTestCase):
    async def test_a_listed_migration_whose_bytes_are_not_published_refuses(self) -> None:
        """F-547 / F-541: editing an applied .sql in place used to be a silent
        no-op, because the runner compared only the filename."""

        with TemporaryDirectory() as directory:
            drifted = migration_copy(directory, "001_initial.sql", mutate="-- drift\n")
            connection = RecordingConnection(adopted=("001_initial.sql",))
            database = database_pointing_at(Path(directory), connection)

            with self.assertRaises(MigrationDigestError) as caught:
                await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

            self.assertEqual(
                str(caught.exception), f"KNOWLEDGE_MIGRATION_DIGEST_MISMATCH {drifted.name}"
            )
            self.assertEqual(caught.exception.code, "KNOWLEDGE_MIGRATION_DIGEST_MISMATCH")
            # The refusal is the FIRST thing the boot does: nothing in the set is
            # applied, and no ledger row is written, from a migration set the
            # runner will not vouch for.
            self.assertEqual(
                connection.statements(),
                [
                    "CREATE SCHEMA IF NOT EXISTS knowledge",
                    "CREATE TABLE IF NOT EXISTS knowledge.schema_migrations "
                    "(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
                ],
            )

    async def test_an_unlisted_forward_migration_is_still_allowed_and_bound(self) -> None:
        """The manifest's own allowance: a file it does not name carries no
        expectation, and its bytes become the ledger's witness."""

        with TemporaryDirectory() as directory:
            fresh = Path(directory, "001_widgets.sql")
            fresh.write_text("CREATE TABLE knowledge.widgets (id uuid PRIMARY KEY);\n", encoding="utf-8")
            connection = RecordingConnection(
                ledger_rows=({"version": "001_widgets.sql", "digest": None},)
            )
            database = database_pointing_at(Path(directory), connection)

            await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

            self.assertIn("INSERT INTO knowledge.schema_migrations (version) VALUES ($1)", connection.statements())
            updates = connection.args_for("UPDATE knowledge.schema_migrations SET digest")
            self.assertEqual(updates, [("001_widgets.sql", sha256_of(fresh))])

    async def test_a_recorded_digest_that_is_not_the_published_one_refuses(self) -> None:
        """F-547: the rolled-manifest case the repo comparator cannot see.

        The file hashes to what the manifest NOW publishes, so the pin guard is
        satisfied — but this database recorded different bytes when it ran the
        migration, which is what an in-place edit after adoption cannot erase.
        """

        published = published_migration_digests()
        recorded_elsewhere = "0" * 64
        self.assertNotEqual(recorded_elsewhere, published["001_initial.sql"])
        connection = RecordingConnection(
            adopted=("001_initial.sql",),
            ledger_rows=({"version": "001_initial.sql", "digest": recorded_elsewhere},),
        )
        database = database_pointing_at(MIGRATIONS_DIR, connection)

        with self.assertRaises(MigrationDigestError) as caught:
            await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

        self.assertEqual(
            str(caught.exception), "KNOWLEDGE_MIGRATION_DIGEST_ADOPTED_MISMATCH 001_initial.sql"
        )
        self.assertEqual(
            connection.args_for("UPDATE knowledge.schema_migrations SET digest"), []
        )

    async def test_a_row_that_already_records_the_published_digest_is_left_alone(self) -> None:
        published = published_migration_digests()
        connection = RecordingConnection(
            adopted=tuple(published),
            ledger_rows=tuple(
                {"version": name, "digest": published[name]} for name in sorted(published)
            ),
        )
        database = database_pointing_at(MIGRATIONS_DIR, connection)

        await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

        self.assertEqual(
            connection.args_for("UPDATE knowledge.schema_migrations SET digest"), []
        )
        self.assertEqual(
            connection.args_for("INSERT INTO knowledge.schema_migrations"), []
        )

    async def test_a_legacy_row_is_bound_to_the_bytes_the_manifest_publishes(self) -> None:
        """Rows written before migration 005 carry no digest: the runner gives
        them the published value, so the next boot has a witness to check."""

        published = published_migration_digests()
        version = "004_pdf_build_failure_cause.sql"
        connection = RecordingConnection(
            adopted=(version,),
            ledger_rows=({"version": version, "digest": None},),
        )
        database = database_pointing_at(MIGRATIONS_DIR, connection)

        await database._apply_migrations(owner_connection=connection)  # type: ignore[arg-type]

        self.assertEqual(
            connection.args_for("UPDATE knowledge.schema_migrations SET digest"),
            [(version, published[version])],
        )


class BootNamingTests(IsolatedAsyncioTestCase):
    async def test_the_boot_names_the_digest_refusal_instead_of_an_outage(self) -> None:
        """F-547: a schema the store will not trust is not "the database is
        down", and polling cannot repair a file on disk."""

        with TemporaryDirectory() as directory:
            migration_copy(directory, "001_initial.sql", mutate="-- drift\n")
            connection = RecordingConnection(adopted=("001_initial.sql",))
            database = KnowledgeDatabase(
                "localhost", 5432, "knowledge", "zink", "secret", Path(directory)
            )
            pool = _Pool(connection)

            async def create_pool(*_args: object, **_kwargs: object) -> _Pool:
                return pool

            with patch(
                "app.database.asyncpg.create_pool", new=AsyncMock(side_effect=create_pool)
            ):
                await database.start()

            self.assertEqual(
                database.startup_error_code, "KNOWLEDGE_MIGRATION_DIGEST_MISMATCH"
            )
            self.assertIsNone(
                database._reconnect_task,
                "a drifted migration file is not a connectivity fault the next poll heals",
            )
            self.assertTrue(pool.closed)
            self.assertIsNone(database._pool)
            self.assertFalse(database.available)

    async def test_the_reconnect_loop_ends_on_a_digest_refusal(self) -> None:
        """The retry arm is the second half: without it the loop polls forever
        behind a schema it will not accept."""

        with TemporaryDirectory() as directory:
            migration_copy(directory, "001_initial.sql", mutate="-- drift\n")
            connection = RecordingConnection(adopted=("001_initial.sql",))
            database = KnowledgeDatabase(
                "localhost", 5432, "knowledge", "zink", "secret", Path(directory)
            )
            pool = _Pool(connection)

            async def create_pool(*_args: object, **_kwargs: object) -> _Pool:
                return pool

            with patch(
                "app.database.asyncpg.create_pool", new=AsyncMock(side_effect=create_pool)
            ), patch("app.database.RECONNECT_INTERVAL_SECONDS", 0.01):
                # `wait_for` is the red proof: if the loop swallowed the refusal
                # into its generic arm it never returns and this case times out.
                await asyncio.wait_for(database._reconnect_loop(), timeout=10)

            self.assertEqual(
                database.startup_error_code, "KNOWLEDGE_MIGRATION_DIGEST_MISMATCH"
            )
            self.assertTrue(pool.closed)
            self.assertIsNone(database._pool)


class ForwardMigrationShapeTests(TestCase):
    def test_migration_005_adds_a_nullable_digest_bounded_to_64_hex(self) -> None:
        sql = (MIGRATIONS_DIR / "005_schema_migration_digest.sql").read_text(encoding="utf-8")
        statement = sql.split("ALTER TABLE", 1)[1]
        self.assertIn("knowledge.schema_migrations", statement)
        self.assertIn("ADD COLUMN digest text", statement)
        self.assertRegex(statement, r"CHECK \(digest IS NULL OR digest ~ '\^\[a-f0-9\]\{64\}\$'\)")


if __name__ == "__main__":
    main()
