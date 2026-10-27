// M12/T9-R4 B6 — F-430 (legacy R9-L06-5).
//
// The CLI's `deprecate` committed the retirement under the writer lock but
// triggered NO sync — and no sync command existed in the CLI at all — so the
// retired skill stayed ACTIVE/READY in the derived index (and searchable
// through the adapter's `status = 'ACTIVE' AND sync_status = 'READY'` filter)
// until an UNRELATED plugin approval happened to run a full sync.
//
// This lane pins the propagation half the acceptance criteria name:
//   1. one `skill-store deprecate` command propagates the retirement toward the
//      derived index: the command either reports the derived sync succeeded or
//      reports its failure BY NAME with the committed retirement attached —
//      it can never exit 0 while the propagation did not run. The test points
//      POSTGRES_CONTAINER at an absent container, so the retirement marker
//      provably fails and the honest envelope is the only green shape;
//   2. the CLI carries a `sync` command as the documented retry path, and an
//      empty unnamed store refuses its zero-row tombstone (F-176) without
//      touching any database.
//
// The real-database adapter-query half of the acceptance (serve one query with
// no manual sync) needs the shared PostgreSQL container; it is NOT RUN in this
// wave because the Docker daemon is down, and it is unsafe to rehearse against
// the SHARED catalog_index: a scratch-store sync tombstones every ACTIVE row
// the scratch catalog does not contain.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "src", "catalog.mjs"),
).href;
const CLI_URL = pathToFileURL(
  path.join(REPO, "zink-skill-store", "bin", "skill-store.mjs"),
).href;

const { withSkillStoreWriterLock, promoteApprovedSkillUnlocked } = await import(
  CATALOG_URL
);
const { executeCli } = await import(CLI_URL);

const GOVERNED = {
  requestingActor: "excel",
  ownerActor: "owner",
  sourceType: "research",
  references: [{ type: "plan", ref: "M12/T9-R4" }],
  decisionRef: "PLAN:M12/T9-R4",
};

// A shape-valid container name that does not exist: every `docker exec` the
// sync attempts fails deterministically, on a host with OR without Docker.
const ABSENT_CONTAINER = "m12-t9-f430-absent";

async function freshStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-t9-f430-"));
  return { root, skillsRoot: path.join(root, "skills") };
}

function payloadOf(result) {
  return JSON.parse(`${result.stdout}${result.stderr}`);
}

test("F-430: deprecate propagates the retirement and never hides a failed sync", async () => {
  const { root, skillsRoot } = await freshStore();
  const savedContainer = process.env.POSTGRES_CONTAINER;
  process.env.POSTGRES_CONTAINER = ABSENT_CONTAINER;
  try {
    await withSkillStoreWriterLock(skillsRoot, () =>
      promoteApprovedSkillUnlocked({
        skillsRoot,
        namespace: ["office"],
        capability: "retire-me",
        version: "1.0.0",
        content: "# Retire me\n\nbody\n",
        ...GOVERNED,
      }),
    );

    const result = await executeCli(
      [
        "deprecate",
        "--namespace",
        "office",
        "--capability",
        "retire-me",
        "--version",
        "1.0.0",
        "--decision-ref",
        "PLAN:M12/T9-R4",
        "--actor",
        "owner",
      ],
      skillsRoot,
    );
    const payload = payloadOf(result);

    // The single command attempted the derived propagation. At the pre-fix
    // HEAD the payload is `{status, skill}` with exit code 0 and NOTHING
    // derived — this assertion is the red.
    assert.ok(
      payload.derived_sync !== undefined ||
        payload.error?.code === "DERIVED_SYNC_FAILED",
      `deprecate must propagate to the derived index, got ${JSON.stringify(payload)}`,
    );

    // The canonical retirement committed, and the envelope says so.
    const retired = payload.retired ?? payload.skill;
    assert.equal(retired.capability, "retire-me");

    // Against the absent container the retirement marker provably failed, so
    // the command must refuse to report success: named error, the failed sync
    // attached, non-zero exit.
    assert.equal(result.exitCode, 5);
    assert.equal(payload.error.code, "DERIVED_SYNC_FAILED");
    assert.equal(payload.derived_sync.status, "FAILED");
    assert.equal(
      payload.derived_sync.error_code,
      "VECTOR_RETIREMENT_MARK_FAILED",
    );
  } finally {
    if (savedContainer === undefined) delete process.env.POSTGRES_CONTAINER;
    else process.env.POSTGRES_CONTAINER = savedContainer;
    await rm(root, { recursive: true, force: true });
  }
});

test("F-430: the CLI carries a sync command as the documented retry path", async () => {
  const { root, skillsRoot } = await freshStore();
  const savedContainer = process.env.POSTGRES_CONTAINER;
  process.env.POSTGRES_CONTAINER = ABSENT_CONTAINER;
  try {
    // An empty store is still a directory: the scan reads it, finds no
    // records, and the destructive zero-row tombstone must be REFUSED.
    mkdirSync(skillsRoot, { recursive: true });
    const result = await executeCli(["sync"], skillsRoot);
    assert.notEqual(
      result.exitCode,
      4,
      "`sync` must be a command, not CLI_INPUT_INVALID",
    );
    assert.equal(
      result.exitCode,
      0,
      `sync of an empty store must succeed, got ${result.stdout}${result.stderr}`,
    );
    const payload = payloadOf(result);
    // An empty store with no declared identity: the destructive zero-row
    // tombstone is REFUSED (F-176) and no database is touched.
    assert.equal(payload.derived_sync.tombstone_status, "REFUSED");
  } finally {
    if (savedContainer === undefined) delete process.env.POSTGRES_CONTAINER;
    else process.env.POSTGRES_CONTAINER = savedContainer;
    await rm(root, { recursive: true, force: true });
  }
});
