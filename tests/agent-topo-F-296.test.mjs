// F-296 (R7-C5-04) -- every publication rename is proven to be followed by a
// DIRECTORY fsync, per site.
//
// The old durability gate read each writer's source, sliced it from the LAST
// occurrence of the rename call and asserted that the remaining text mentioned
// an fsync. It never named a directory handle and never bound an fsync to a
// specific rename, so the check was satisfied by any mention of `fsyncSync`
// after the file's single rename: retargeting the directory fsync onto the
// already-durable file handle stayed green while the rename stopped being
// crash-durable.
//
// This lane is per SITE and binds the fsync to a handle:
//
//   - statically: after each `renameSync`, a handle opened with the read flag
//     must be fsynced, and it must not be the handle the file itself was
//     fsynced through before the rename; and
//   - at runtime: the topology ledger writer is driven for real in a child
//     process whose `node:fs` calls are observed, so the fsync that follows
//     the rename is proved to be applied to a DIRECTORY handle.
//
// A mutation that re-targets or removes any one of the directory fsyncs
// reddens this lane.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The writers this lane proves. Every one of them publishes a file with an
// atomic rename, so every one of them owes the parent directory an fsync.
const PROVEN_WRITERS = [
  "integrations/openclaw/topology/lib/ledger.mjs",
  "integrations/openclaw/lib/queue-manager.mjs",
  "integrations/openclaw/lib/decision-ledger.mjs",
  "integrations/openclaw/lib/artifact-validator.mjs",
  "integrations/openclaw/topology/lib/native-patch.mjs",
  "integrations/openclaw/topology/lib/runtime-backup.mjs",
  "integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs",
  // F-296: the Zink Tools agent made the Skill Store proposal writer durable
  // (the rename is now followed by a directory fsync), so it is proved here
  // instead of being carried as an unproven writer.
  "zink-tools/adapters/skill-store/skill-adapter.mjs",
];

// Writers this lane does NOT prove yet, because their file is owned by another
// agent. The classification is asserted below, so a NEW tracked writer cannot
// join the tree without a decision.
const KNOWN_UNPROVEN_WRITERS = [
  {
    file: "integrations/openclaw/plugins/zink-governance/index.mjs",
    owner: "fix-openclaw-governance-plugin",
  },
];

const RENAME = /\brenameSync\s*\(/gu;
// A handle opened with the READ flag. On every platform this repository
// supports, that is how a directory is opened for an fsync. The `fs.` prefix
// is accepted because the Skill Store writer calls `fs.openSync` directly.
const OPEN_READ_HANDLE =
  /([A-Za-z_$][\w$]*)\s*=\s*(?:fs\.)?openSync\(\s*([^,]+?)\s*,\s*["']r["']\s*\)/gu;
const FSYNC = /\bfsyncSync\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/gu;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sourceOf(relative) {
  return fs.readFileSync(path.join(REPO, relative), "utf8");
}

function renameSites(source) {
  const sites = [];
  RENAME.lastIndex = 0;
  let match;
  while ((match = RENAME.exec(source)) !== null) {
    sites.push({
      index: match.index,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return sites;
}

function lastFsyncHandle(source, before) {
  let handle = null;
  FSYNC.lastIndex = 0;
  let match;
  while ((match = FSYNC.exec(source)) !== null) {
    if (match.index >= before) break;
    handle = match[1];
  }
  return handle;
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

// A handle opened with the read flag and then fsynced. On every platform this
// repository supports, that is how a directory is fsynced.
function directoryFsyncHandle(body) {
  OPEN_READ_HANDLE.lastIndex = 0;
  let match;
  while ((match = OPEN_READ_HANDLE.exec(body)) !== null) {
    const handle = match[1];
    const after = body.slice(match.index + match[0].length);
    if (
      new RegExp(`\\bfsyncSync\\(\\s*${escapeRegExp(handle)}\\s*\\)`, "u").test(
        after,
      )
    )
      return handle;
  }
  return null;
}

// The local helpers whose own body performs a directory fsync.
function directorySyncHelpers(source) {
  const helpers = new Set();
  const signatures = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/gu,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gu,
  ];
  for (const signature of signatures) {
    signature.lastIndex = 0;
    let match;
    while ((match = signature.exec(source)) !== null) {
      const name = match[1];
      const body = functionBody(source, match.index);
      if (body !== null && directoryFsyncHandle(body) !== null)
        helpers.add(name);
    }
  }
  return helpers;
}

test("F-296: every tracked rename writer is classified by this lane", () => {
  for (const relative of PROVEN_WRITERS) {
    assert.ok(
      sourceOf(relative).includes("renameSync"),
      `${relative} is listed as a proven writer but no longer renames`,
    );
  }
  for (const entry of KNOWN_UNPROVEN_WRITERS) {
    assert.ok(
      sourceOf(entry.file).includes("renameSync"),
      `${entry.file} is listed as an unproven writer but no longer renames`,
    );
  }
  assert.equal(
    PROVEN_WRITERS.length + KNOWN_UNPROVEN_WRITERS.length,
    9,
    "the tracked rename-writer set must not shrink or grow without a decision",
  );
});

test("F-296: each rename site is followed by a bound directory fsync", () => {
  // The per-site predicate: after EVERY rename, a handle opened with the READ
  // flag is fsynced, the fsync is bound to that handle (and not to the
  // already-durable file handle the temporary file was fsynced through), and a
  // rename whose directory fsync is delegated to a local helper is accepted
  // when that helper's own body binds the fsync. A mutation that re-targets
  // or removes any one of these directory fsyncs reddens this lane.
  for (const relative of PROVEN_WRITERS) {
    const source = sourceOf(relative);
    const helpers = directorySyncHelpers(source);
    const sites = renameSites(source);
    assert.ok(sites.length > 0, `${relative} must publish with a rename`);
    for (const site of sites) {
      const next = sites.find((candidate) => candidate.index > site.index);
      const window = source.slice(
        site.index,
        next ? next.index : source.length,
      );
      const fileHandle = lastFsyncHandle(source, site.index);
      const inlineHandle = directoryFsyncHandle(window);
      if (inlineHandle !== null) {
        assert.notEqual(
          inlineHandle,
          fileHandle,
          `${relative}:${site.line} fsyncs the already-durable file handle instead of the parent directory`,
        );
        continue;
      }
      const helper = [...helpers].find((name) =>
        new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "u").test(window),
      );
      assert.ok(
        helper,
        `${relative}:${site.line} renames a file into place, so it must be followed by a directory fsync bound to a handle opened on the parent directory`,
      );
      const body = functionBody(source, source.indexOf(helper));
      const boundHandle = body === null ? null : directoryFsyncHandle(body);
      assert.ok(
        boundHandle,
        `${relative}:${site.line} delegates the directory fsync to ${helper}(), which no longer binds an fsync to a directory handle`,
      );
    }
  }
});

test("F-296: the topology ledger writer fsyncs the DIRECTORY after the rename", () => {
  const child = `
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(import.meta.url)});
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const calls = [];
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
const ledger = await import(${JSON.stringify(
    pathToFileURL(
      path.join(REPO, "integrations/openclaw/topology/lib/ledger.mjs"),
    ),
  )});
const { deriveTaskId } = await import(${JSON.stringify(
    pathToFileURL(
      path.join(REPO, "integrations/openclaw/topology/lib/canonical.mjs"),
    ),
  )});
const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f296-"));
try {
  const paths = ledger.ledgerPaths(root);
  ledger.ensureLedger(paths);
  calls.length = 0;
  const payload = {
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "12345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-f296",
    root_run_id: "run-f296",
  };
  ledger.recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: deriveTaskId(payload),
  });
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
      renameIndex,
      hasFsyncAfterRename: Boolean(fsync),
      fsyncedPath: opened ? opened.path : null,
      fsyncedPathIsDirectory: opened
        ? fs.statSync(opened.path).isDirectory()
        : false,
    }),
  );
} finally {
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
  assert.ok(
    observed.renameIndex >= 0,
    "the snapshot publication must rename the temporary file into place",
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
