-- F-547 / F-541 (R10-T05-4, R10-T03-6): the applied-migration ledger records
-- WHAT IT RAN, not only which filename it saw.
--
-- Adoption was keyed on the filename alone, so editing an already-applied
-- `apps/knowledge/migrations/00x.sql` in place changed nothing on every database
-- that had adopted it and the boot stayed green: the published digest manifest
-- and `tests/m12-t2.2-a4-migration-digest.test.mjs` could see the drift in the
-- repository, but the module that applies migrations enforced no such rule. The
-- Skill Store runner reads its published manifest at the apply seam; this column
-- lets the Knowledgebase runner do the same, and gives each database its own
-- witness — a recorded digest that no later manifest roll can re-legitimise.
--
-- Nullable, because every row written before this migration carries no digest:
-- the runner binds such a row to the bytes it can still identify it by, so from
-- this boot forward the cross-check is against what THIS database ran rather
-- than against a pin file someone could rewrite.
ALTER TABLE knowledge.schema_migrations
  ADD COLUMN digest text CHECK (digest IS NULL OR digest ~ '^[a-f0-9]{64}$');
