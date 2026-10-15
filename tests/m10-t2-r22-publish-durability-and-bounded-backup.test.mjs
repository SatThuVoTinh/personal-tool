// M10/T2-R22 - publish durability ordering, and a bounded backup subprocess.
//
// Every source assertion in this file runs against COMMENT-STRIPPED source. That
// is deliberate: twice in this work an explanatory comment quoting the old
// expression satisfied a source assertion meant to prove the opposite.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The ESM loader needs a URL, not a bare filesystem path.
const url = (rel) => pathToFileURL(path.join(REPO, rel)).href;
const readSource = (rel) => readFileSync(path.join(REPO, rel), "utf8");

const { promoteApprovedSkill, describeVersionRollbackState } = await import(
  url("zink-skill-store/src/catalog.mjs")
);
const NATIVE = await import(
  url("integrations/openclaw/topology/lib/native-patch.mjs")
);
const {
  NATIVE_RUNTIME_PINS,
  NATIVE_BRIDGE_RELATIVE,
  nativePatchedRuntimeRelatives,
  nativePatchedDiscordChannelRelatives,
} = NATIVE;
const { SNAPSHOT_TARGETS } = await import(
  url("integrations/openclaw/topology/lib/transaction-snapshot.mjs")
);

const CATALOG_SRC = readSource("zink-skill-store/src/catalog.mjs");
const BACKUP_SRC = readSource(
  "integrations/openclaw/topology/lib/runtime-backup.mjs",
);

/** Strip JS comments so an explanatory comment cannot satisfy a source assertion. */
const code = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/u, "$1"))
    .join("\n");

test("R22-01: the staging directory is fsynced BEFORE it is renamed into place", () => {
  // The gap: writeFileAtomic fsynced each file's BYTES and the publish path
  // fsynced parentDir after the rename - but nothing persisted the two
  // directory entries inside stagingDir. A crash after the rename could leave a
  // canonical versionDir that exists yet is missing SKILL.md or manifest.json:
  // a published skill the catalog rejects, and one whose incompleteness is
  // silent because the directory name is present.
  const src = code(CATALOG_SRC);
  const sync = src.indexOf("fsyncDirectoryBestEffort(stagingDir)");
  const rename = src.indexOf("rename(stagingDir, versionDir)");
  assert.ok(sync > 0, "the staging directory must be fsynced");
  assert.ok(
    rename > 0,
    "the staged directory must still be published by rename",
  );
  assert.ok(
    sync < rename,
    "the staging entries must be durable BEFORE the directory becomes visible",
  );

  // And the parent directory is still synced after the rename, so the name swap
  // itself is durable. Both halves are required; neither alone is sufficient.
  const parent = src.indexOf("fsyncDirectoryBestEffort(parentDir)");
  assert.ok(
    parent > rename,
    "the rename must still be followed by a parent sync",
  );
});

test("R22-02: publishing a skill produces a complete version directory", async () => {
  // Behavioural check of the same invariant: whatever the ordering guarantees on
  // disk, a published version must carry BOTH members of the pair, because the
  // catalog recognises only complete validated pairs - and no staging residue
  // may survive the publish.
  const { mkdtemp, rm, readdir, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;

  const skillsRoot = await mkdtemp(path.join(tmpdir(), "r22-catalog-"));
  const newline = String.fromCharCode(10);
  const body = "# R22 proof" + newline + newline + "A short body." + newline;
  try {
    const result = await promoteApprovedSkill({
      skillsRoot,
      namespace: ["office"],
      capability: "r22-proof",
      version: "1.0.0",
      content: body,
      decisionRef: "PLAN:M10/T2-R22",
    });

    const versions = await readdir(
      path.join(skillsRoot, "office", "r22-proof"),
    );
    const versionDir = versions.find((v) => !v.includes(".pending-"));
    assert.ok(
      versionDir,
      "a version directory must be published, saw " + versions,
    );
    assert.ok(
      !versions.some((v) => v.includes(".pending-")),
      "no staging residue may survive the publish",
    );

    const members = await readdir(
      path.join(skillsRoot, "office", "r22-proof", versionDir),
    );
    assert.ok(members.includes("SKILL.md"), "SKILL.md must be published");
    assert.ok(
      members.includes("manifest.json"),
      "manifest.json must be published",
    );

    // The published content must be byte-identical to what was approved.
    assert.equal(
      await readFile(
        path.join(skillsRoot, "office", "r22-proof", versionDir, "SKILL.md"),
        "utf8",
      ),
      body,
      "the published SKILL.md must be exactly the approved content",
    );

    // And the writer must report the record it actually made.
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.version, "1.0.0");
    assert.deepEqual(result.namespace, ["office"]);
    assert.match(result.content_sha256, /^[a-f0-9]{64}$/u);
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("R22-03: the git read on the apply critical path is bounded in time", () => {
  // maxBuffer caps what git may RETURN; it does nothing about git never
  // returning. createRuntimeBackup runs inside the synchronous
  // configure.mjs --apply path, so an unbounded git show can hang the apply with
  // no error at all.
  const src = code(BACKUP_SRC);
  const call = src.slice(src.indexOf("execFileSync("));
  const gitShow = call.slice(0, call.indexOf("));"));
  assert.match(gitShow, /timeout:\s*\d/u, "git must be bounded by a timeout");
  assert.match(gitShow, /maxBuffer:/u, "the output cap must be kept");
});

test("R22-04: every runtime file the native patch mutates is transaction-tracked", () => {
  // This is the invariant that makes the PREDECESSOR upgrade branch safe even
  // though it has no local try/catch of its own. nativePatchedRuntimeRelatives
  // seeds the set with the bridge and derives the rest from the pins, so the
  // apply orchestrator's snapshot covers every byte that branch can write. If the
  // bridge were dropped from that set, a mid-loop failure would leave the bridge
  // rewritten after rollback: mutated but untracked.
  const tracked = nativePatchedRuntimeRelatives();
  assert.ok(
    tracked.includes(NATIVE_BRIDGE_RELATIVE),
    "the bridge must be transaction-tracked",
  );
  const expected = new Set([NATIVE_BRIDGE_RELATIVE]);
  for (const pin of Object.values(NATIVE_RUNTIME_PINS))
    for (const [file, entry] of Object.entries(pin.sources))
      if ((entry.scope ?? "runtime") === "runtime")
        expected.add("dist/" + file);
  for (const relative of expected)
    assert.ok(
      tracked.includes(relative),
      relative + " is mutated by the native patch but not transaction-tracked",
    );
  assert.deepEqual(
    [...tracked].sort(),
    [...expected].sort(),
    "the tracked set must be exactly the mutated set",
  );
  assert.deepEqual(
    SNAPSHOT_TARGETS.runtime,
    tracked,
    "the snapshot must use the derived set, not a separately maintained list",
  );
});

test("R22-05: channel-scope pins are tracked as state-relative targets", () => {
  // A pinned artifact can live in the installed channel package instead of the
  // runtime root. Those bytes are mutated by the same apply, so they must be
  // tracked too - otherwise the same "mutated but untracked" hole reappears one
  // tree over.
  const channel = nativePatchedDiscordChannelRelatives();
  assert.ok(Array.isArray(channel));
  const scopes = new Set();
  for (const pin of Object.values(NATIVE_RUNTIME_PINS))
    for (const entry of Object.values(pin.sources))
      scopes.add(entry.scope ?? "runtime");
  if (scopes.has("discordChannel"))
    for (const relative of channel)
      assert.ok(
        SNAPSHOT_TARGETS.discordChannel.includes(relative),
        relative + " must be a state-relative snapshot target",
      );
});

// T2.1-2 (R5-E04-03): a rejected promotion rolls its version directory back, and
// the caller must be told whether canonical state is actually clean afterwards.
//
// MANIFEST_LIMIT_EXCEEDED is the only rule able to fire AFTER the rename:
// validateStagedVersion counts the one staged pair while scanCatalog counts the
// whole tree, and the pre-promotion check refuses a tree that is already dirty.
// So the fixture fills the tree to exactly 1,000 valid manifests and the 1,001st
// is the promotion under test.
test("R22-08: a rolled-back promotion states whether canonical state is clean", async () => {
  // 1,000 pairs is a lot of small writes; the sync forms are measurably cheaper
  // here and nothing in the fixture needs to be concurrent.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { mkdtemp, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createHash } = await import("node:crypto");
  const path = (await import("node:path")).default;

  const skillsRoot = await mkdtemp(path.join(tmpdir(), "r22-rollback-"));
  const namespace = ["office"];
  const capability = "r22-proof";
  const markdown = "# R22 rollback proof" + String.fromCharCode(10);
  const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
  try {
    for (let index = 0; index < 1000; index += 1) {
      const version = `1.0.${index}`;
      const directory = path.join(
        skillsRoot,
        ...namespace,
        capability,
        version,
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "SKILL.md"), markdown);
      writeFileSync(
        path.join(directory, "manifest.json"),
        JSON.stringify({
          schema_version: 1,
          identity: { namespace, capability, version },
          content: { path: "SKILL.md", sha256 },
          provenance: { source_type: "research", references: [] },
          lifecycle: [
            {
              status: "CANDIDATE",
              at: "2026-10-15T01:00:00Z",
              actor: "owner",
            },
          ],
        }),
      );
    }
    // A dirty fixture would be refused as "catalog has pre-existing errors"
    // instead, so asserting the limit code below also proves the tree was clean
    // before the rename put the 1,001st manifest into it.
    const failure = await promoteApprovedSkill({
      skillsRoot,
      namespace,
      capability,
      version: "1.0.1000",
      content: markdown,
      // The DECISION grammar has no slot for a dotted sub-task, so the tier is
      // named at its parent (M12/T2) with this revision.
      decisionRef: "PLAN:M12/T2-R3",
    }).then(
      () => null,
      (error) => error,
    );
    assert.equal(failure?.code, "CATALOG_INVALID");
    assert.match(failure.message, /MANIFEST_LIMIT_EXCEEDED/u);
    assert.match(
      failure.message,
      /rollback: canonical state is clean \(the version directory is absent\)/u,
      "the rejection must state the rollback outcome, not only the code",
    );
    assert.equal(
      await stat(
        path.join(skillsRoot, ...namespace, capability, "1.0.1000"),
      ).then(
        () => false,
        (error) => error?.code === "ENOENT",
      ),
      true,
      "the stated cleanliness must match the filesystem",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

// The residue the writer may not be able to clear is the half of R5-E04-03 an
// errno on a live drvfs root produces; it cannot be forced deterministically
// against the real promotion, so the reporter is driven directly for every
// state it has to distinguish.
test("R22-09: the rollback reporter separates clean, residue and unreadable", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;

  const root = await mkdtemp(path.join(tmpdir(), "r22-residue-"));
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  try {
    const absent = path.join(root, "absent");
    assert.match(
      await describeVersionRollbackState(absent, null),
      /^canonical state is clean \(the version directory is absent\)$/u,
    );
    // `force: true` makes `rm` swallow ENOENT, so a delete that reported an errno
    // and still left nothing must not be folded into the clean case above.
    assert.match(
      await describeVersionRollbackState(absent, busy),
      /^canonical state is clean \(removal failed with EBUSY; the version directory is absent\)$/u,
    );

    const residue = path.join(root, "residue");
    await mkdir(residue, { recursive: true });
    assert.match(
      await describeVersionRollbackState(residue, null),
      /^canonical state is NOT clean \(the version directory remains and is empty\)$/u,
    );
    await writeFile(path.join(residue, "SKILL.md"), "# Skill\n");
    assert.match(
      await describeVersionRollbackState(residue, busy),
      /^canonical state is NOT clean \(removal failed with EBUSY; the version directory still holds 1 entry\)$/u,
    );

    // A path that cannot be listed is reported as unknown, never as clean.
    const notADirectory = path.join(root, "a-file");
    await writeFile(notADirectory, "x");
    assert.match(
      await describeVersionRollbackState(notADirectory, null),
      /^canonical state is UNKNOWN \(the version directory could not be read with ENOTDIR\)$/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
