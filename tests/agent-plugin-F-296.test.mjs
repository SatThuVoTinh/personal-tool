// M12/T9 F-296 (plugin half) - a publication that renames a file is not
// crash-durable until the PARENT DIRECTORY's entry for the new name is
// flushed. The file's own fsync makes the CONTENT durable; it does not make
// the directory entry durable.
//
// MEASURED AT HEAD: `writeJsonAtomicSync` opened the temporary file, wrote it,
// fsynced it, closed it and renamed it - and stopped there. No directory was
// ever fsynced, so a crash between the rename and the directory flush could
// leave a durable file that no directory points at.
//
// The proof is behavioural, not a text search: the plugin's `node:fs` bindings
// are captured at import time, so the test patches the CommonJS `node:fs`
// exports BEFORE the plugin module is instantiated and then records every
// open/fsync/rename the plugin performs.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const load = async (rel) =>
  import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

// The recorder must be installed BEFORE the plugin is imported: the plugin's
// `import { openSync } from "node:fs"` captures the value at instantiation.
const require = createRequire(import.meta.url);
const cjsFs = require("node:fs");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = cjsFs;
const calls = [];
const fdPath = new Map();
const origOpen = cjsFs.openSync;
const origFsync = cjsFs.fsyncSync;
const origRename = cjsFs.renameSync;
const origClose = cjsFs.closeSync;
cjsFs.openSync = (file, ...rest) => {
  const fd = origOpen(file, ...rest);
  calls.push({ op: "open", path: String(file) });
  fdPath.set(fd, String(file));
  return fd;
};
cjsFs.fsyncSync = (fd, ...rest) => {
  calls.push({ op: "fsync", path: fdPath.get(fd) ?? null });
  return origFsync(fd, ...rest);
};
cjsFs.renameSync = (from, to, ...rest) => {
  calls.push({ op: "rename", path: String(to) });
  return origRename(from, to, ...rest);
};
cjsFs.closeSync = (fd, ...rest) => {
  calls.push({ op: "close", path: fdPath.get(fd) ?? null });
  fdPath.delete(fd);
  return origClose(fd, ...rest);
};

const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);

const PROPOSAL_ID = "a".repeat(32);

function seedProposal(storeDir) {
  mkdirSync(storeDir, { recursive: true });
  const record = {
    proposal_id: PROPOSAL_ID,
    status: "CANDIDATE",
    namespace: ["default"],
    capability: "demo",
    version: "1.0.0",
    content: "# demo\n",
    content_sha256: "b".repeat(64),
    requesting_agent: "excel",
  };
  writeFileSync(
    path.join(storeDir, `${PROPOSAL_ID}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}

test("F-296: the plugin's publication rename is followed by a directory fsync", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f296-"));
  const storeDir = path.join(root, "skill-proposals");
  const skillsRoot = path.join(root, "skills");
  mkdirSync(skillsRoot, { recursive: true });
  seedProposal(storeDir);

  calls.length = 0;
  const outcome = await plugin.handleOwnerSkillRejection({
    ownerDiscordId: "123456789012345678",
    expectedOwnerId: "123456789012345678",
    proposalId: PROPOSAL_ID,
    skillsRoot,
    proposalStorageDir: storeDir,
  });
  assert.equal(outcome.approval_status, "REJECTED");

  const proposalPath = path.join(storeDir, `${PROPOSAL_ID}.json`);
  const renameIndex = calls.findIndex(
    (call) => call.op === "rename" && call.path === proposalPath,
  );
  assert.ok(renameIndex >= 0, "the proposal must be published by a rename");

  // The directory fsync must come AFTER the rename: flushing the directory
  // before the rename would flush the OLD entry, and the new name would still
  // be unsynced.
  const dirFsyncIndex = calls.findIndex(
    (call, index) =>
      index > renameIndex &&
      call.op === "fsync" &&
      typeof call.path === "string" &&
      call.path === storeDir,
  );
  assert.ok(
    dirFsyncIndex > renameIndex,
    "the parent directory must be fsynced AFTER the rename",
  );

  // The record really is on disk under its final name.
  const stored = JSON.parse(readFileSync(proposalPath, "utf8"));
  assert.equal(stored.status, "REJECTED");
});

test("F-296: the directory fsync is not the file's own fsync", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f296b-"));
  const storeDir = path.join(root, "skill-proposals");
  const skillsRoot = path.join(root, "skills");
  mkdirSync(skillsRoot, { recursive: true });
  seedProposal(storeDir);

  calls.length = 0;
  await plugin.handleOwnerSkillRejection({
    ownerDiscordId: "123456789012345678",
    expectedOwnerId: "123456789012345678",
    proposalId: PROPOSAL_ID,
    skillsRoot,
    proposalStorageDir: storeDir,
  });

  const proposalPath = path.join(storeDir, `${PROPOSAL_ID}.json`);
  const renameIndex = calls.findIndex(
    (call) => call.op === "rename" && call.path === proposalPath,
  );
  const after = calls.slice(renameIndex + 1);
  const fsyncedPaths = after
    .filter((call) => call.op === "fsync")
    .map((call) => call.path);
  assert.ok(
    fsyncedPaths.includes(storeDir),
    "the directory itself must be the fsynced handle",
  );
  assert.ok(
    !fsyncedPaths.includes(proposalPath),
    "the file handle was already durable; only the directory entry was not",
  );
});
