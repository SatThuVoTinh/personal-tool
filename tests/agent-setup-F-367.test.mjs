// F-367 (R7-IG-07) - the audit record is recoverable only from the unowned
// ignored snapshot directory for everything before 2026-10-17T22:57.
//
// The register became tracked at 3325e5e (2026-10-17T22:57:27Z) while
// backups/ holds 33 register snapshots whose earliest is 13 hours earlier, so
// the rows that existed only in the untracked window could not be
// re-derived from the repository alone.
//
// The acceptance criterion offers two branches: the pre-tracking snapshots
// are moved into a tracked, retention-stated location, or the register's
// section 2 records the deleted rows' identities. Moving 33 archives is the
// owner's action, so the second branch is taken: the identities are recorded
// in a tracked document in this repository, the register's section 2 points
// at that list, and one document names the canonical copy when the two
// disagree.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

const RUNBOOK_PATH = path.join(
  "docs",
  "runbooks",
  "backups-and-recovery-archives.md",
);
const TRACKING_COMMIT_TIME = Date.parse("2026-10-17T22:57:27Z");
const LEGACY_ID = /\b(R\d+-[A-Z0-9]+-\d+)\b/gu;

function runbook() {
  return readFileSync(path.join(root, RUNBOOK_PATH), "utf8");
}

function preTrackingSnapshots() {
  const directory = path.join(root, "backups");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^findings\..*\.md$/u.test(name))
    .map((name) => {
      const file = path.join(directory, name);
      return {
        name,
        mtime: statSync(file).mtime.getTime(),
        ids: new Set(
          [...readFileSync(file, "utf8").matchAll(LEGACY_ID)].map(
            (match) => match[1],
          ),
        ),
      };
    })
    .filter((snapshot) => snapshot.mtime < TRACKING_COMMIT_TIME);
}

function droppedIdentities() {
  const current = new Set(
    [
      ...readFileSync(
        path.join(root, "docs", "execution", "findings.md"),
        "utf8",
      ).matchAll(LEGACY_ID),
    ].map((match) => match[1]),
  );
  const union = new Set();
  for (const snapshot of preTrackingSnapshots()) {
    for (const id of snapshot.ids) union.add(id);
  }
  return [...union].filter((id) => !current.has(id)).sort();
}
test("F-367: one document names the canonical copy when the two disagree", () => {
  const text = runbook();
  assert.match(
    text,
    /the tracked register wins/iu,
    "the document must say which copy is canonical",
  );
  assert.match(text, /never the canonical record/iu);
});

test("F-367: the pre-tracking window's dropped identities are recorded in a tracked document", () => {
  const text = runbook();
  const recorded = new Set(
    [...text.matchAll(/`(R\d+-[A-Z0-9]+-\d+)`/gu)].map((match) => match[1]),
  );
  const dropped = droppedIdentities();
  if (dropped.length === 0) {
    // The snapshots are gone: the recorded list must still stand on its own.
    assert.ok(
      recorded.size > 0,
      "the dropped identities must stay recorded after the snapshots are gone",
    );
    return;
  }
  for (const id of dropped) {
    assert.ok(
      recorded.has(id),
      `the identity ${id} must be recorded, or the pre-tracking window is not answerable`,
    );
  }
});

test("F-367: the recorded list is exactly the dropped set, with no invented identity", () => {
  const dropped = droppedIdentities();
  if (dropped.length === 0) return;
  const text = runbook();
  const recorded = new Set(
    [...text.matchAll(/`(R\d+-[A-Z0-9]+-\d+)`/gu)].map((match) => match[1]),
  );
  const invented = [...recorded].filter((id) => !dropped.includes(id));
  assert.deepEqual(
    invented,
    [],
    `the document must not record an identity the snapshots do not carry: ${invented.join(", ")}`,
  );
});

test("F-367: the document states the window the identities come from", () => {
  const text = runbook();
  assert.match(text, /3325e5e/);
  assert.match(text, /2026-10-17T22:57:27Z/);
});
