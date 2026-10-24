// F-296 (R7-C5-04) -- the Zink Tools half of the durability row.
//
// The register's acceptance criteria applies to EVERY writer:
//
//   "each rename site is individually proven to be followed by a directory
//    fsync, and a mutation that re-targets or removes any one of them reddens
//    the lane."
//
// The Skill Store proposal writer published a record with temp file -> fsync ->
// rename and NO parent-directory fsync: `zink-tools/adapters/skill-store/
// skill-adapter.mjs` renamed the temporary file over the proposal record and
// stopped there. A rename makes the directory entry atomic, but only a
// directory fsync makes it DURABLE: a crash right after the rename can still
// lose the publication, and that record carries the owner's decision about a
// governed skill.
//
// This lane proves the property per SITE, not per file:
//
//   1. statically: after EVERY rename, a handle opened with the READ flag is
//      fsynced, the fsync is BOUND to that handle (and not to the already
//      durable file handle the temporary file was fsynced through), and the
//      handle is named as the directory handle it is. The fsync may be
//      written inline or delegated to a local helper whose own body binds it;
//   2. at runtime: the real Skill Store proposal publication fsyncs a handle
//      that the operating system reports as a DIRECTORY, after the rename.
//
// The four writers the register names besides this one are proved by the same
// per-site predicate, so a mutation that re-targets or removes any one of them
// reddens this lane too.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  REGISTERED_DURABILITY_WRITERS,
  proveDurableWriterSource,
  proveEveryRenameIsFollowedByADirectoryFsync,
} from "./helpers/directory-fsync.mjs";

// The repository root. The lane lives in `tests/` once it is admitted, so the
// root is the parent of the test directory; while the lane is still staged
// outside the tree the root is taken from ZINK_REPO.
function resolveRepositoryRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...Array.from({ length: 6 }, (_v, i) =>
      path.resolve(here, ...Array.from({ length: i + 1 }, () => "..")),
    ),
    process.env.ZINK_REPO,
  ].filter(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "zink-tools", "contracts"))) {
      return candidate;
    }
  }
  throw new Error(
    "the repository root could not be resolved: run this lane from tests/ or set ZINK_REPO",
  );
}

const REPO = resolveRepositoryRoot();

// F-491 (R9-T11-1): this lane used to carry a verbatim copy of the predicate,
// and the two copies had already drifted (different writer registers). The one
// implementation lives in `tests/helpers/directory-fsync.mjs`; the register it
// proves is exported from there, so a lane cannot silently keep proving the
// old predicate and a register cannot be typed twice.

// The Zink Tools writer this lane owns. It is a writer, not a register: the
// governance writers come from the shared register.
const SKILL_STORE_WRITER = "zink-tools/adapters/skill-store/skill-adapter.mjs";

test("F-296: the Skill Store proposal writer fsyncs the parent directory after its rename", () => {
  proveEveryRenameIsFollowedByADirectoryFsync(SKILL_STORE_WRITER);
});

test("F-487: the predicate is proved against fixtures, not only real files", () => {
  // F-487 (R9-L11b-1): the predicate captured the open expression and then
  // never compared it with the rename destination's parent, asserting only that
  // the handle's NAME matched /dir/iu, and it scanned raw source so a comment
  // counted as evidence. A predicate that can only be pointed at the tree's real
  // writers cannot be shown to fail, so it is pointed at known-bad fixtures
  // here: each one reddens the rule it is named for, and none of them is the
  // file the rule exists to protect.
  const fixture = (body) => `
import path from "node:path";
import { closeSync, fsyncSync, openSync, renameSync } from "node:fs";
function publish(paths, temp) {
${body}
}
`;

  // The positive control: a directory fsync opened on the destination's own
  // parent. Without it a case that always throws would look like a pass.
  assert.doesNotThrow(
    () =>
      proveDurableWriterSource({
        label: "fixture:parent-directory",
        source: fixture(`
  const file = path.join(paths.root, "record.json");
  renameSync(temp, file);
  const directoryFd = openSync(paths.root, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }`),
      }),
    "a rename fsynced against its own parent directory must be accepted",
  );

  assert.throws(
    () =>
      proveDurableWriterSource({
        label: "fixture:wrong-directory",
        source: fixture(`
  const file = path.join(paths.identityDir, "record.json");
  renameSync(temp, file);
  const directoryFd = openSync(paths.otherDir, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }`),
      }),
    /not the parent of the rename destination/u,
    "a directory handle named like one but opened on another directory must be refused: the rename is not durable and the old name-only rule stayed green",
  );

  assert.throws(
    () =>
      proveDurableWriterSource({
        label: "fixture:comment-only",
        source: fixture(`
  const file = path.join(paths.root, "record.json");
  renameSync(temp, file);
  // const directoryFd = openSync(paths.root, "r"); fsyncSync(directoryFd);`),
      }),
    /no such fsync follows this rename/u,
    "a commented-out directory fsync is not a directory fsync",
  );

  assert.throws(
    () =>
      proveDurableWriterSource({
        label: "fixture:file-handle-retarget",
        source: fixture(`
  const file = path.join(paths.root, "record.json");
  const fd = openSync(temp, "wx", 0o600);
  fsyncSync(fd);
  renameSync(temp, file);
  fsyncSync(fd);`),
      }),
    /no such fsync follows this rename|already-durable file handle/u,
    "re-fsyncing the temporary file's own handle does not flush the directory entry the rename created",
  );
});

test("F-296: every writer the register names fsyncs the parent directory after each rename", () => {
  for (const relative of REGISTERED_DURABILITY_WRITERS) {
    proveEveryRenameIsFollowedByADirectoryFsync(relative);
  }
});

test("F-491: this lane cannot fork the durability predicate again", () => {
  // The defect was a verbatim copy of the predicate in this file. A copy is not
  // a style question: the two copies drifted, so patching the helper left this
  // lane proving the old property. Any local re-declaration reddens here, and
  // the import above is what supplies the one implementation.
  const source = readFileSync(new URL(import.meta.url), "utf8");
  for (const name of [
    "codeOnly",
    "renameSites",
    "fsyncCalls",
    "readHandleOpens",
    "functionBody",
    "boundDirectoryFsync",
    "directorySyncHelpers",
    "proveEveryRenameIsFollowedByADirectoryFsync",
  ]) {
    assert.equal(
      new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "u").test(source),
      false,
      `this lane must import ${name} from tests/helpers/directory-fsync.mjs instead of declaring its own copy`,
    );
  }
  assert.match(
    source,
    /from "\.\/helpers\/directory-fsync\.mjs"/u,
    "this lane must consume the single durability predicate from the shared helper",
  );
});

test("F-491: the two consumers prove the same writer register", () => {
  // `tests/m10-t2-r15-critical-path-invariants.test.mjs` still types its own
  // copy of the four governance writers. Two copies is how this row happened,
  // so agreement is asserted rather than assumed: a writer added to one list
  // and not the other reddens, and the message names the shared register.
  const lane = readFileSync(
    new URL("./m10-t2-r15-critical-path-invariants.test.mjs", import.meta.url),
    "utf8",
  );
  const block = lane.match(/const writes = \[([\s\S]*?)\];/u);
  assert.ok(
    block,
    "the R15 lane must still prove the governance writers with the shared predicate",
  );
  const typed = [...block[1].matchAll(/"([^"]+)"/gu)].map(
    (entry) => `integrations/openclaw/${entry[1]}`,
  );
  assert.deepEqual(
    [...new Set(typed)].sort(),
    [...REGISTERED_DURABILITY_WRITERS].sort(),
    "the R15 lane's writer list and REGISTERED_DURABILITY_WRITERS must agree: one register, proved by both consumers",
  );
});

test("F-296: the real proposal publication fsyncs a DIRECTORY handle after the rename", () => {
  const child = `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const calls = [];
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
const originalOpen = fs.openSync;
const originalFsync = fs.fsyncSync;
const originalRename = fs.renameSync;
fs.openSync = function (...args) {
  const fd = originalOpen.apply(this, args);
  calls.push({ kind: "open", fd, path: String(args[0]) });
  return fd;
};
fs.fsyncSync = function (fd) {
  calls.push({ kind: "fsync", fd });
  return originalFsync.call(this, fd);
};
fs.renameSync = function (...args) {
  calls.push({ kind: "rename", path: String(args[1]) });
  return originalRename.apply(this, args);
};
const { SkillAdapter } = await import(${JSON.stringify(
    pathToFileURL(path.join(REPO, SKILL_STORE_WRITER)).href,
  )});
const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f296-skill-"));
const skillsRoot = path.join(root, "skills");
fs.mkdirSync(skillsRoot, { recursive: true });
const proposalsDir = path.join(root, "proposals");
fs.mkdirSync(proposalsDir, { recursive: true });
const adapter = new SkillAdapter(root, {
  skillsRoot,
  proposalStorageDir: proposalsDir,
});
let outcome = null;
try {
  const result = await adapter.querySkillStore(
    {
      action: "propose",
      namespace: "office",
      capability: "durability-probe",
      version: "1.0.0",
      content: "# durability probe\\n\\nbody\\n",
      reason: "F-296 durability probe",
    },
    { requestingAgent: "sql" },
  );
  outcome = result?.governed_status ?? null;
} finally {
  const renameIndex = calls.findIndex((call) => call.kind === "rename");
  const fsyncIndex = calls.findIndex(
    (call, index) => index > renameIndex && call.kind === "fsync",
  );
  const fsync = fsyncIndex === -1 ? null : calls[fsyncIndex];
  // The handle must be paired with the open that PRODUCED it: file descriptor
  // numbers are reused, so the pairing is positional, not by number.
  const opened = fsync
    ? calls
        .slice(0, fsyncIndex)
        .reverse()
        .find((call) => call.kind === "open" && call.fd === fsync.fd)
    : null;
  process.stdout.write(
    JSON.stringify({
      outcome,
      renameIndex,
      hasFsyncAfterRename: Boolean(fsync),
      fsyncedPath: opened ? opened.path : null,
      fsyncedPathIsDirectory: opened ? isDirectory(opened.path) : false,
      proposalFiles: fs.readdirSync(proposalsDir),
    }),
  );
  fs.rmSync(root, { recursive: true, force: true });
}
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: child,
    encoding: "utf8",
  });
  assert.equal(
    run.status,
    0,
    `the observing child process must succeed: ${run.stderr}`,
  );
  const observed = JSON.parse(run.stdout);
  assert.equal(
    observed.outcome,
    "SUCCESS",
    "the proposal publication must actually have run",
  );
  assert.ok(
    observed.renameIndex >= 0,
    "the proposal must be published by renaming a temporary file into place",
  );
  assert.ok(
    observed.hasFsyncAfterRename,
    "a rename must be followed by an fsync, or the publication is not durable",
  );
  assert.equal(
    observed.fsyncedPathIsDirectory,
    true,
    `the fsync after the rename must be applied to the PARENT DIRECTORY handle (${observed.fsyncedPath}), not to the file handle`,
  );
});
