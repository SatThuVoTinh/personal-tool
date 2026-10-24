-- zink-skill-store/migrations/005_retirement_state_domain_verification.sql
-- M12/T9-R4 F-509 (R10-L05-2) — the retirement state's DOMAIN postcondition.
--
-- `004_skill_retirement_state.sql` widens TWO CHECK constraints on
-- `skills.catalog_index` and then verifies only one of them: its `DO $$` block
-- filters `con.conname = 'catalog_index_status_check'`, so the `sync_status`
-- widening it performs has no postcondition at all.
--
-- That asymmetry is the harm, not a cosmetic gap. PostgreSQL permits SEVERAL
-- CHECK constraints on one column, `DROP CONSTRAINT IF EXISTS` silently no-ops
-- on a name it does not find, and the runner then records the file as applied
-- (`skills.schema_migrations`) and refuses any later byte change. A database
-- whose narrow `sync_status` CHECK was created under a different name — by
-- hand-applied DDL, or restored from a dump — therefore keeps refusing
-- `TOMBSTONED` while the ledger says the retirement state is migrated, and only
-- a new forward migration can repair it.
--
-- 004 is APPLIED by filename and digest-pinned, so it is never edited: the
-- missing half lands here, as a NEW forward migration. It asserts both widened
-- domains, and it asserts the property the name-keyed check cannot: no OTHER
-- CHECK constraint on `skills.catalog_index.sync_status` may omit TOMBSTONED.
-- The queries select by `con.contype` and `con.conrelid` rather than by one
-- predicted constraint name, so a hand-named narrow CHECK is found too.
--
-- This file changes no schema. It fails the migration (and therefore leaves it
-- unrecorded) instead of letting an unverified domain be frozen as applied.

DO $$
DECLARE
  v_narrow_sync_checks integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'skills'
      AND rel.relname = 'catalog_index'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
      AND pg_get_constraintdef(con.oid) LIKE '%DEPRECATED%'
  ) THEN
    RAISE EXCEPTION
      'skills.catalog_index still refuses the DEPRECATED retirement state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'skills'
      AND rel.relname = 'catalog_index'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%sync_status%'
      AND pg_get_constraintdef(con.oid) LIKE '%TOMBSTONED%'
  ) THEN
    RAISE EXCEPTION
      'skills.catalog_index still refuses the TOMBSTONED retirement sync state';
  END IF;

  SELECT count(*) INTO v_narrow_sync_checks
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'skills'
    AND rel.relname = 'catalog_index'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%sync_status%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%TOMBSTONED%';

  IF v_narrow_sync_checks > 0 THEN
    RAISE EXCEPTION
      'skills.catalog_index carries % CHECK constraint(s) on sync_status that refuse the TOMBSTONED retirement state (a widened CHECK does not replace them)',
      v_narrow_sync_checks;
  END IF;
END $$;
