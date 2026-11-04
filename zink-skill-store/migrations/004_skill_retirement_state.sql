-- zink-skill-store/migrations/004_skill_retirement_state.sql
-- M12/T9 F-095 (R5-E04-05) / H8 - the governed DEPRECATED retirement state.
--
-- A FORWARD migration. `003_skills_vector_schema.sql` was applied by filename
-- and is digest-pinned, so it is never edited: the retirement's schema change
-- lands here, as a NEW file, in the Skill Store's own migration set.
--
-- `003` could only admit `status = 'ACTIVE'` and
-- `sync_status IN ('PENDING','READY','FAILED')`, so a retired skill had exactly
-- one representation in the derived index: the row was DELETED. This migration
-- widens the two CHECK constraints so the retirement can be RECORDED:
--
--   status      IN ('ACTIVE', 'DEPRECATED')
--   sync_status IN ('PENDING', 'READY', 'FAILED', 'TOMBSTONED')
--
-- The canonical lifecycle truth stays in the catalog's manifest; the derived
-- row now says WHY it is no longer served.
--
-- PostgreSQL names an unnamed column CHECK constraint `<table>_<column>_check`,
-- WITHOUT the schema: the two constraints `003` creates are therefore
-- `catalog_index_status_check` and `catalog_index_sync_status_check`. The
-- widening is verified at the end of this file, so a constraint this file
-- failed to replace fails the migration instead of leaving the narrow
-- constraint behind.

ALTER TABLE skills.catalog_index
  DROP CONSTRAINT IF EXISTS catalog_index_status_check;

ALTER TABLE skills.catalog_index
  ADD CONSTRAINT catalog_index_status_check
  CHECK (status IN ('ACTIVE', 'DEPRECATED'));

ALTER TABLE skills.catalog_index
  DROP CONSTRAINT IF EXISTS catalog_index_sync_status_check;

ALTER TABLE skills.catalog_index
  ADD CONSTRAINT catalog_index_sync_status_check
  CHECK (sync_status IN ('PENDING', 'READY', 'FAILED', 'TOMBSTONED'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'skills'
      AND rel.relname = 'catalog_index'
      AND con.conname = 'catalog_index_status_check'
      AND pg_get_constraintdef(con.oid) LIKE '%DEPRECATED%'
  ) THEN
    RAISE EXCEPTION
      'skills.catalog_index still refuses the DEPRECATED retirement state';
  END IF;
END $$;
