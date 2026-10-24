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

import { proveDurableWriterSource } from "./helpers/directory-fsync.mjs";

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

// The writers the register names, plus the Zink Tools writer this lane owns.
// Every one of them publishes a file with an atomic rename, so every one of
// them owes the parent directory an fsync.
const REGISTER_WRITERS = [
  "integrations/openclaw/topology/lib/ledger.mjs",
  "integrations/openclaw/lib/queue-manager.mjs",
  "integrations/openclaw/lib/decision-ledger.mjs",
  "integrations/openclaw/lib/artifact-validator.mjs",
];
const SKILL_STORE_WRITER = "zink-tools/adapters/skill-store/skill-adapter.mjs";

function sourceOf(relative) {
  return readFileSync(path.join(REPO, relative), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The source with every string literal and comment blanked out, at the same
 * length, so a structural scan never reads a word that only appears inside a
 * comment or a quoted string.
 */
function codeOnly(source) {
  let out = source;
  const blank = (match) => " ".repeat(match.length);
  out = out.replace(/\/\*[\s\S]*?\*\//gu, blank);
  out = out.replace(/\/\/[^\n]*/gu, blank);
  out = out.replace(/"(?:[^"\\]|\\.)*"/gu, blank);
  out = out.replace(/'(?:[^'\\]|\\.)*'/gu, blank);
  out = out.replace(/`(?:[^`\\]|\\.)*`/gu, blank);
  return out;
}

function renameSites(source) {
  const sites = [];
  const pattern = /\brenameSync\s*\(/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    sites.push({
      index: match.index,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return sites;
}

function fsyncCalls(source) {
  const calls = [];
  const pattern = /\bfsyncSync\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    calls.push({ index: match.index, handle: match[1] });
  }
  return calls;
}

// A handle opened with the READ flag. On every platform this repository
// supports, that is how a directory is opened for an fsync: a directory cannot
// be opened for writing.
function readHandleOpens(source) {
  const opens = [];
  const pattern =
    /([A-Za-z_$][\w$]*)\s*=\s*(?:fs\.)?openSync\s*\(([^,;]+?)\s*,\s*["']r["']\s*\)/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    opens.push({
      index: match.index,
      handle: match[1],
      expression: match[2].trim(),
    });
  }
  return opens;
}

function functionBody(source, from) {
  const start = source.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

/**
 * A handle that is opened with the read flag and then fsynced, bound to the
 * handle variable that the open produced.
 */
function boundDirectoryFsync(body) {
  if (body === null) return null;
  const opens = readHandleOpens(body);
  const fsyncs = fsyncCalls(body);
  for (const open of opens) {
    const bound = fsyncs.find(
      (call) => call.index > open.index && call.handle === open.handle,
    );
    if (bound) return { handle: open.handle, expression: open.expression };
  }
  return null;
}

/**
 * The local helpers whose own body performs a bound directory fsync.
 */
function directorySyncHelpers(source) {
  const helpers = [];
  const code = codeOnly(source);
  const signatures = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/gu,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gu,
  ];
  for (const signature of signatures) {
    signature.lastIndex = 0;
    let match;
    while ((match = signature.exec(code)) !== null) {
      const name = match[1];
      if (helpers.some((helper) => helper.name === name)) continue;
      const body = functionBody(source, match.index);
      const bound = boundDirectoryFsync(body);
      if (bound !== null) {
        helpers.push({
          name,
          nameIndex: match.index + match[0].indexOf(name),
          bound,
        });
      }
    }
  }
  return helpers;
}

/**
 * Proves, for EVERY rename site in one file, that the rename is followed by a
 * directory fsync bound to a handle of its own.
 */
function proveEveryRenameIsFollowedByADirectoryFsync(relative) {
  const source = sourceOf(relative);
  const code = codeOnly(source);
  const sites = renameSites(source);
  assert.ok(sites.length > 0, `${relative} must publish with a rename`);
  const fsyncs = fsyncCalls(source);
  const opens = readHandleOpens(source);
  const helpers = directorySyncHelpers(source);
  for (const site of sites) {
    const next = sites.find((candidate) => candidate.index > site.index);
    const windowEnd = next ? next.index : source.length;
    const window = source.slice(site.index, windowEnd);
    // The handle the temporary file itself was fsynced through. A rename that
    // is followed by an fsync of THAT handle is not durable: the file's bytes
    // were already flushed, and the directory entry is what is still missing.
    const fileHandle =
      fsyncs.filter((call) => call.index < site.index).at(-1)?.handle ?? null;

    // Form A: the directory fsync is written out inline, right after the
    // rename, in the SAME block.
    let inline = null;
    for (const open of opens) {
      if (open.index <= site.index || open.index >= windowEnd) continue;
      const bound = fsyncs.find(
        (call) =>
          call.index > open.index &&
          call.index < windowEnd &&
          call.handle === open.handle,
      );
      if (!bound) continue;
      // A handle opened inside a function DEFINED after the rename belongs to
      // that function, not to the rename's block: the rename is not followed
      // by that fsync, the helper's body is.
      const between = code.slice(site.index, open.index);
      if (/\bfunction\b/u.test(between) || /=>/u.test(between)) continue;
      inline = { open, bound };
      break;
    }
    if (inline !== null) {
      assert.notEqual(
        inline.bound.handle,
        fileHandle,
        `${relative}:${site.line} fsyncs the already-durable file handle '${fileHandle}' instead of the parent-directory handle '${inline.open.handle}', so a crash can still lose the rename`,
      );
      assert.match(
        inline.open.handle,
        /dir/iu,
        `${relative}:${site.line} the handle that carries the directory fsync must be NAMED as the directory handle it is (found '${inline.open.handle}')`,
      );
      continue;
    }

    // Form B: the directory fsync is delegated to a local helper whose own
    // body binds an fsync to a handle opened with the read flag.
    const helper = helpers.find((candidate) => {
      const call = new RegExp(
        `\\b${escapeRegExp(candidate.name)}\\s*\\(`,
        "gu",
      );
      let match;
      while ((match = call.exec(window)) !== null) {
        // The definition itself is not a call.
        if (match.index + site.index === candidate.nameIndex) continue;
        return true;
      }
      return false;
    });
    assert.ok(
      helper,
      `${relative}:${site.line} renames a file into place, so it must be followed by a directory fsync bound to a handle opened on the parent directory (no such fsync follows this rename)`,
    );
    assert.notEqual(
      helper.bound.handle,
      fileHandle,
      `${relative}:${site.line} the directory fsync is delegated to ${helper.name}(), but it fsyncs the already-durable file handle '${fileHandle}' instead of a parent-directory handle`,
    );
    assert.match(
      helper.bound.handle,
      /dir/iu,
      `${relative}:${site.line} the handle that carries the directory fsync must be NAMED as the directory handle it is (found '${helper.bound.handle}')`,
    );
  }
}

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
  for (const relative of REGISTER_WRITERS) {
    proveEveryRenameIsFollowedByADirectoryFsync(relative);
  }
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
