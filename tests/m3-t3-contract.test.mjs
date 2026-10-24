//
// SKIP-FAMILY: docker
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const app = read("apps", "knowledge", "app", "main.py");
const lifecycle = read("apps", "knowledge", "app", "index_lifecycle.py");
const database = read("apps", "knowledge", "app", "database.py");
const coordinator = read("apps", "knowledge", "app", "index_runner.py");
const errors = read("apps", "knowledge", "app", "run_errors.py");
const acceptance = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t3.ps1",
);

test("M3/T3 persists a run before scheduling its background worker", () => {
  assert.match(app, /await coordinator\.reserve\(\)/);
  assert.match(app, /await database\.accept_incremental\(active_index\)/);
  assert.match(app, /await database\.accept_full_rebuild\(/);
  assert.match(app, /await coordinator\.schedule\(/);
  assert.match(app, /@app\.post\("\/v1\/index-runs"/);
  assert.match(app, /@app\.get\("\/v1\/index-runs\/\{run_id\}"\)/);
  assert.match(coordinator, /async def reserve/);
  assert.match(coordinator, /async def schedule/);
});

test("M3/T3 locks final model gates and atomic terminal transitions", () => {
  assert.match(lifecycle, /final gate covers unchanged and empty snapshots/);
  assert.match(lifecycle, /await self\.require_identity\(expected\)/);
  assert.match(database, /UPDATE knowledge\.indexes SET status = 'SUPERSEDED'/);
  assert.match(database, /SET status = 'ACTIVE', activated_at = now\(\)/);
  assert.match(database, /SET status = 'SUCCEEDED', finished_at = now\(\)/);
  assert.match(database, /SET status = 'FAILED', failed_at = now\(\)/);
});

test("M3/T3 protects deletion, ownership, and rebuild recovery", () => {
  assert.match(lifecycle, /EMPTY_SNAPSHOT_DELETION_BLOCKED/);
  assert.match(lifecycle, /if errors:/);
  assert.match(database, /WHERE status = 'RUNNING'/);
  assert.match(database, /ORPHANED_BUILDING_INDEX/);
  assert.match(database, /PROCESS_RESTART/);
  const releasePosition = coordinator.indexOf(
    "await self._database.release_advisory_lock(",
    coordinator.indexOf("async def _run("),
  );
  const cleanupPosition = coordinator.indexOf("await cleanup(cleanup_ids)");
  assert.ok(cleanupPosition >= 0 && releasePosition > cleanupPosition);
  assert.match(
    database,
    /async def cleanup_superseded[\s\S]*?async with self\._mutation_transaction\(\) as connection:/,
  );
});

test("M3/T3 serializes only bounded safe errors", () => {
  assert.match(errors, /MAX_ERROR_ENTRIES = 50/);
  // F-550 (R10-T06-2) widened this key to three members so two rows that differ
  // only by their cause still serialize in a stable order. The control is that
  // the ordering key totals every member the record carries, so the expectation
  // tracks the record rather than its arity.
  assert.match(
    errors,
    /key=lambda item: \(item\[0\] or "", item\[1\], item\[2\] or ""\)\)/u,
  );
  assert.match(errors, /LEGACY_FAILURE_DETAIL/);
  assert.match(errors, /Legacy failure detail is unavailable/);
});

test("M3/T3 acceptance mounts a disposable Vault read-only through Nginx", () => {
  assert.match(acceptance, /personal-tool-m3-t3/);
  assert.match(acceptance, /KNOWLEDGE_ACCEPTANCE_VAULT_ROOT/);
  assert.match(acceptance, /M3\/T3 Vault mount is not read-only/);
  assert.match(acceptance, /Accepted run was not immediately visible/);
  assert.match(acceptance, /EMPTY_SNAPSHOT_DELETION_BLOCKED/);
  assert.match(acceptance, /INTERRUPTED:FAILED:ACTIVE/);
});
