// F-296 (R7-C5-04) — the per-site directory-fsync predicate.
//
// The weak predicate this replaces read each writer's source, sliced it from the
// LAST occurrence of the rename call and asserted that the remaining text
// mentioned an fsync. It never named a directory handle and never bound an
// fsync to a specific rename, so the check was satisfied by ANY mention of
// `fsyncSync` after the file's single rename: retargeting the directory fsync
// onto the already-durable file handle stayed green while the rename stopped
// being crash-durable.
//
// The predicate below is per SITE and binds the fsync to the rename:
//
//   - a handle opened with the READ flag — the only way a directory is opened
//     for an fsync on every platform this repository supports — is fsynced
//     AFTER that rename, in the SAME block (a handle opened inside a function
//     DEFINED after the rename belongs to that function, not to the rename);
//   - the fsync is bound to that handle, and NOT to the handle the temporary
//     file itself was fsynced through (that handle's bytes were already
//     flushed; the directory entry is what is still missing);
//   - the handle is NAMED as the directory handle it is;
//   - a rename whose directory fsync is delegated to a local helper is accepted
//     when that helper's own body binds an fsync to a read-flag handle.
//
// The predicate was introduced by the Zink Tools half of the row
// (`tests/agent-tools-F-296.test.mjs`). It lives here so the lanes that prove
// the property share ONE implementation instead of two that can drift.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root. The helper lives in `tests/helpers/`, so the root is
 * two levels up; the marker directory is still checked so the helper fails
 * loudly rather than proving a path that does not exist.
 */
function resolveRepositoryRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...Array.from({ length: 6 }, (_value, index) =>
      path.resolve(here, ...Array.from({ length: index + 1 }, () => "..")),
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
    "the repository root could not be resolved: run this helper from tests/helpers/ or set ZINK_REPO",
  );
}

const REPO = resolveRepositoryRoot();

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

/**
 * A handle opened with the READ flag. On every platform this repository
 * supports, that is how a directory is opened for an fsync: a directory cannot
 * be opened for writing.
 */
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
 *
 * `target` is a repository-relative path (or an absolute path). Every failure
 * message names the site as `file:line` and the handle it is about, because a
 * message that cannot name the site cannot be acted on.
 */
export function proveEveryRenameIsFollowedByADirectoryFsync(target) {
  const relative = path.isAbsolute(target)
    ? path.relative(REPO, target).split(path.sep).join("/")
    : target;
  const source = readFileSync(path.join(REPO, relative), "utf8");
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

export { REPO };
