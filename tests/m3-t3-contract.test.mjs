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

test("M3/T3 protects deletion and rebuild recovery", () => {
  assert.match(lifecycle, /EMPTY_SNAPSHOT_DELETION_BLOCKED/);
  assert.match(lifecycle, /if failed:/);
  assert.match(database, /WHERE status = 'RUNNING'/);
  assert.match(database, /ORPHANED_BUILDING_INDEX/);
  assert.match(database, /PROCESS_RESTART/);
  assert.match(lifecycle, /asyncio\.create_task\(self\._cleanup/);
});

test("M3/T3 serializes only bounded safe errors", () => {
  assert.match(errors, /MAX_ERROR_ENTRIES = 50/);
  assert.match(errors, /key=lambda item: \(item\[0\] or "", item\[1\]\)/);
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
