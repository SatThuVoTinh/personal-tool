// F-415 (R9-T03-2) — the durability gate's predicate and its population.
//
// The row has three parts, and each one is a way the gate could be green while
// proving nothing:
//
//   1. the predicate recognised only the sync API (`renameSync`, `fsyncSync`,
//      `openSync`), so an async writer that IS correct could not satisfy it and
//      an async writer that is NOT durable produced zero rename sites, i.e. a
//      vacuous pass. The predicate now reads both forms, and the async fixtures
//      below prove it accepts one and refuses the other;
//   2. the writer population was a hand-typed literal in two lanes, so
//      `zink-skill-store/src/catalog.mjs` — an async atomic writer — was absent
//      from both. The population is now derived from `git ls-files` plus a
//      rename-usage scan, and the counters fail loudly on an empty or truncated
//      enumeration instead of proving an empty population;
//   3. every derived writer is proved. The one that does not pass is filed
//      against a production row (F-410/F-411) and is listed in
//      REPORTED_UNDURABLE_WRITERS; the ledger is proved to be EXACTLY the set of
//      failures, so it reddens when a new writer regresses and when a listed
//      writer is fixed without deleting its entry.
//
// The residue-cleanup half of the acceptance criterion ("every atomic writer
// carries one residue-cleanup assertion") needs the writer's own cleanup path,
// which is the production change in F-410/F-411; see the lane's report.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  REPORTED_UNDURABLE_WRITERS,
  REGISTERED_DURABILITY_WRITERS,
  discoverAtomicWriters,
  isAtomicWriterSource,
  proveDurableWriterSource,
  proveEveryRenameIsFollowedByADirectoryFsync,
} from "./helpers/directory-fsync.mjs";

const SKILL_STORE_WRITER = "zink-tools/adapters/skill-store/skill-adapter.mjs";
const ASYNC_SKILL_STORE_WRITER = "zink-skill-store/src/catalog.mjs";

test("F-415: the predicate accepts the async rename/sync/open forms", () => {
  const fixture = (body) => `
import path from "node:path";
import { open, rename } from "node:fs/promises";
async function publish(paths, temp) {
${body}
}
`;

  const fileWrite = `
  const file = path.join(paths.root, "record.json");
  const handle = await open(temp, "w");
  try {
    await handle.writeFile("record");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);`;

  // The positive control: the async four-step write, with a directory fsync
  // opened on the destination's own parent. A predicate that still matches only
  // `renameSync` reports "must publish with a rename" here, which is exactly the
  // false refusal this row is about.
  assert.doesNotThrow(
    () =>
      proveDurableWriterSource({
        label: "fixture:async-parent-directory",
        source: fixture(`${fileWrite}
  const directoryHandle = await open(paths.root, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }`),
      }),
    "a correct async writer (await open / await handle.sync / await rename) must be accepted",
  );

  // The discriminating negative control: the same async writer WITHOUT its
  // directory fsync. Accepting the positive control is only evidence if the
  // same source shape can be refused.
  assert.throws(
    () =>
      proveDurableWriterSource({
        label: "fixture:async-no-directory-fsync",
        source: fixture(fileWrite),
      }),
    /no such fsync follows this rename/u,
    "an async rename with no directory fsync must be refused, not silently treated as having no rename site",
  );

  // And the async equivalent of the sync retarget fixture: the directory handle
  // is opened, but the handle actually flushed is the temporary file's own.
  assert.throws(
    () =>
      proveDurableWriterSource({
        label: "fixture:async-file-handle-retarget",
        source: fixture(`${fileWrite}
  await handle.sync();`),
      }),
    /already-durable file handle|no such fsync follows this rename/u,
    "re-syncing the temporary file's handle after the rename does not flush the directory entry",
  );
});

test("F-415: the atomic-writer population is derived from the repository", () => {
  const { files, scanned, writers } = discoverAtomicWriters();
  assert.ok(
    files > 50,
    `the derivation must scan the writer trees (scanned ${files})`,
  );
  assert.equal(scanned, files, "every candidate file must be read");
  assert.ok(
    writers.length >= 8,
    `the derivation must find every tracked atomic writer (found ${writers.length}: ${writers.join(", ")})`,
  );

  // The writers the register names are a SUBSET of the derived population: a
  // register that omits a real writer is the exact defect (catalog.mjs was in
  // neither lane's literal list).
  for (const relative of [
    ...REGISTERED_DURABILITY_WRITERS,
    SKILL_STORE_WRITER,
    ASYNC_SKILL_STORE_WRITER,
    "integrations/openclaw/plugins/zink-governance/index.mjs",
    "integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs",
  ]) {
    assert.ok(
      writers.includes(relative),
      `${relative} is an atomic writer in the repository but the derivation did not find it`,
    );
  }

  // The async writer must be recognised as a writer by the same source rule the
  // sync writers satisfy, not only as a path.
  assert.equal(
    isAtomicWriterSource(
      readFileSync(
        new URL(`../${ASYNC_SKILL_STORE_WRITER}`, import.meta.url),
        "utf8",
      ),
    ),
    true,
    "the async Skill Store writer must satisfy the same atomic-writer rule as the sync writers",
  );
});

test("F-415: a silent zero or truncated enumeration reddens", () => {
  // Fault injection, deterministically: an empty `git ls-files` result and an
  // unreadable candidate must both fail rather than return an empty population.
  assert.throws(
    () => discoverAtomicWriters({ listFiles: () => [] }),
    /enumerated zero candidate files/u,
    "an empty scan must fail loudly, not prove an empty population",
  );
  assert.throws(
    () =>
      discoverAtomicWriters({
        listFiles: () => [ASYNC_SKILL_STORE_WRITER],
        readSource: () => null,
      }),
    /read 0 of 1 candidate files/u,
    "a file that is silently skipped must be counted as unread",
  );
});

test("F-415: every derived writer is proved, and the reported defect list is exact", () => {
  const { writers } = discoverAtomicWriters();
  const failing = [];
  for (const relative of writers) {
    try {
      proveEveryRenameIsFollowedByADirectoryFsync(relative);
    } catch (error) {
      failing.push({ writer: relative, reason: error.message });
    }
  }
  assert.deepEqual(
    failing.map((entry) => entry.writer).sort(),
    REPORTED_UNDURABLE_WRITERS.map((entry) => entry.writer).sort(),
    `the derived writers that fail must be EXACTLY the ones filed against a production row.\n` +
      `failed:\n${failing.map((entry) => `  ${entry.writer}: ${entry.reason}`).join("\n") || "  (none)"}\n` +
      `reported: ${REPORTED_UNDURABLE_WRITERS.map((entry) => `${entry.writer} (${entry.row})`).join(", ") || "(none)"}`,
  );
});
