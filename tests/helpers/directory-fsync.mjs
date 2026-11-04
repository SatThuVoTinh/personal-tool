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
//   - every scan runs on the CODE of the file, so a `renameSync`/`fsyncSync`
//     that only appears inside a comment or a string is not evidence
//     (F-487 / R9-L11b-1);
//   - a handle opened with the READ flag — the only way a directory is opened
//     for an fsync on every platform this repository supports — is fsynced
//     AFTER that rename, in the SAME block (a handle opened inside a function
//     DEFINED after the rename belongs to that function, not to the rename);
//   - the fsync is bound to that handle, and NOT to the handle the temporary
//     file itself was fsynced through (that handle's bytes were already
//     flushed; the directory entry is what is still missing);
//   - the handle is NAMED as the directory handle it is;
//   - the captured open expression DENOTES the rename destination's parent
//     directory: `path.dirname(<destination>)`, a handle opened through an
//     expression the file itself derives from it, or a helper CALLED with that
//     expression. A handle that merely carries a directory-ish name and is
//     opened on some other directory is refused (F-487);
//   - a rename whose directory fsync is delegated to a local helper is accepted
//     when that helper's own body binds an fsync to a read-flag handle, and the
//     argument the helper is CALLED with denotes the destination's parent.
//
// The predicate was introduced by the Zink Tools half of the row
// (`tests/agent-tools-F-296.test.mjs`). It lives here so the lanes that prove
// the property share ONE implementation instead of two that can drift
// (F-491 / R9-T11-1).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

/**
 * The governance writers the durability rows name. This is the ONE register:
 * every lane that proves the per-site property consumes it instead of typing
 * its own copy, because two hand-typed copies is how the predicate forked in
 * the first place (F-491 / R9-T11-1).
 */
export const REGISTERED_DURABILITY_WRITERS = Object.freeze([
  "integrations/openclaw/topology/lib/ledger.mjs",
  "integrations/openclaw/lib/queue-manager.mjs",
  "integrations/openclaw/lib/decision-ledger.mjs",
  "integrations/openclaw/lib/artifact-validator.mjs",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The source with every string literal and comment blanked out, at the same
 * length, so a structural scan never reads a word that only appears inside a
 * comment or a quoted string. A single- or double-quoted literal is matched
 * only within its own line: a quote that appears inside a regular expression
 * (`/['"]/`) must not open a literal that swallows the rest of the file.
 */
function codeOnly(source) {
  let out = source;
  const blank = (match) => " ".repeat(match.length);
  out = out.replace(/\/\*[\s\S]*?\*\//gu, blank);
  out = out.replace(/\/\/[^\n]*/gu, blank);
  out = out.replace(/"(?:[^"\\\n]|\\.)*"/gu, blank);
  out = out.replace(/'(?:[^'\\\n]|\\.)*'/gu, blank);
  out = out.replace(/`(?:[^`\\]|\\.)*`/gu, blank);
  return out;
}

/**
 * True when `index` is a position the comment/literal mask left as code. The
 * mask keeps the source length, so one index addresses both texts.
 */
function isCode(code, source, index) {
  return code[index] === source[index];
}

function normalizeExpression(expression) {
  return expression
    .replace(/\s+/gu, " ")
    .replace(/\bthis\./gu, "")
    .trim();
}

/** The `base` of `path.join(base, …)`, `path.resolve(base, …)`. */
function joinBase(expression) {
  const call = expression.match(
    /^(?:path\.)?(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$.]*)\s*,/u,
  );
  return call ? normalizeExpression(call[1]) : null;
}

/** The arguments of the call whose `(` is at `openIndex`, split at top level. */
function callArguments(code, openIndex) {
  const arguments_ = [];
  let depth = 0;
  let start = openIndex + 1;
  for (let index = openIndex; index < code.length; index += 1) {
    const character = code[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        arguments_.push(code.slice(start, index));
        return arguments_.map((entry) => entry.trim()).filter(Boolean);
      }
    } else if (character === "," && depth === 1) {
      arguments_.push(code.slice(start, index));
      start = index + 1;
    }
  }
  return arguments_.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Every rename that publishes a temporary file into place, with the
 * expression of its DESTINATION (the second argument). Both the callback form
 * (`renameSync`) and the promise form (`await rename`) count: a gate that only
 * recognises the sync API cannot see the async Skill Store writer at all
 * (F-415 / R9-T03-2). A `function rename(...)` declaration is not a call.
 */
function renameSites(source, code) {
  const sites = [];
  const pattern = /\brename(?:Sync)?\s*\(/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!isCode(code, source, match.index)) continue;
    const before = source.slice(Math.max(0, match.index - 16), match.index);
    if (/\bfunction\s+$/u.test(before)) continue;
    const openIndex = source.indexOf("(", match.index);
    const arguments_ = callArguments(code, openIndex);
    sites.push({
      index: match.index,
      line: source.slice(0, match.index).split("\n").length,
      destination: arguments_[1] ? normalizeExpression(arguments_[1]) : null,
    });
  }
  return sites;
}

/**
 * Every fsync call, in both forms the repository uses: `fsyncSync(handle)` and
 * `await handle.sync()`. The second form is how a `FileHandle` is flushed, and
 * a predicate that ignores it treats an async writer as having no fsync at all.
 */
function fsyncCalls(source, code) {
  const calls = [];
  const patterns = [
    {
      pattern: /\bfsyncSync\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/gu,
      handle: (match) => match[1],
    },
    {
      pattern: /\b([A-Za-z_$][\w$]*)\s*\.\s*sync\s*\(\s*\)/gu,
      handle: (match) => match[1],
    },
  ];
  for (const entry of patterns) {
    let match;
    while ((match = entry.pattern.exec(source)) !== null) {
      if (!isCode(code, source, match.index)) continue;
      calls.push({ index: match.index, handle: entry.handle(match) });
    }
  }
  return calls.sort((left, right) => left.index - right.index);
}

/**
 * A handle opened with the READ flag, in either the sync (`openSync`) or the
 * promise (`await open`) form. On every platform this repository supports, a
 * read-flag open is how a directory is opened for an fsync: a directory cannot
 * be opened for writing. The captured `expression` is the first argument, and
 * it is what the parent-directory rule compares.
 */
function readHandleOpens(source, code) {
  const opens = [];
  const pattern =
    /([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:fs\.)?open(?:Sync)?\s*\(([^,;]+?)\s*,\s*["']r["']\s*\)/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!isCode(code, source, match.index)) continue;
    opens.push({
      index: match.index,
      handle: match[1],
      expression: normalizeExpression(match[2]),
    });
  }
  return opens;
}

/**
 * The innermost function body that contains `index`: the range whose
 * temporary-file handle a rename-site fsync may belong to. Two functions in
 * the same file routinely name their handles `fd`/`handle`, so a file-scoped
 * handle lookup compares two different bindings and reports a false positive.
 */
function matchingBrace(code, open) {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return code.length - 1;
}

function enclosingFunctionRange(code, index) {
  const stack = [];
  for (let cursor = 0; cursor < code.length && cursor < index; cursor += 1) {
    if (code[cursor] === "{") stack.push(cursor);
    else if (code[cursor] === "}") {
      if (stack.length > 0 && stack[stack.length - 1] < index) stack.pop();
    }
  }
  for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
    const start = stack[depth];
    const before = code.slice(Math.max(0, start - 160), start);
    if (/(?:\)|\b=>)\s*$/u.test(before)) {
      return { start, end: matchingBrace(code, start) };
    }
  }
  return { start: 0, end: code.length };
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
 * What the file itself says about the expressions it passes around: local
 * definitions, object-literal `property: path.join(base, …)` entries, and the
 * join bases each local function builds its output from. This is what lets the
 * predicate compare a captured open expression with the rename destination's
 * parent instead of trusting the handle's name.
 */
function expressionFacts(source, code) {
  const definitions = new Map();
  const propertyValues = new Map();
  const functions = new Map();
  let match;
  const definition =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/gu;
  while ((match = definition.exec(code)) !== null) {
    if (!definitions.has(match[1])) {
      definitions.set(match[1], normalizeExpression(match[2]));
    }
  }
  // `snapshot: path.join(root, "snapshot.json")` — the expression a property is
  // BUILT FROM is the directory a fsync of that property must name.
  const joinedProperty =
    /\b([A-Za-z_$][\w$]*)\s*:\s*((?:path\.)?(?:join|resolve)\s*\(\s*[A-Za-z_$][\w$.[\]]*\s*,)/gu;
  while ((match = joinedProperty.exec(code)) !== null) {
    const base = joinBase(normalizeExpression(match[2]));
    if (base !== null && !propertyValues.has(match[1])) {
      propertyValues.set(match[1], base);
    }
  }
  const plainProperty =
    /\b([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$.]*)\s*(?=[,;\n}])/gu;
  while ((match = plainProperty.exec(code)) !== null) {
    if (!propertyValues.has(match[1])) {
      propertyValues.set(match[1], normalizeExpression(match[2]));
    }
  }
  // An object-literal shorthand (`{ root, … }`) defines the property as the
  // local of the same name.
  const shorthand = /[{(,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/gu;
  while ((match = shorthand.exec(code)) !== null) {
    if (!propertyValues.has(match[1])) {
      propertyValues.set(match[1], match[1]);
    }
  }
  const signature = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu;
  while ((match = signature.exec(code)) !== null) {
    const body = functionBody(source, match.index);
    if (body === null) continue;
    const bodyCode = codeOnly(body);
    const bases = new Set();
    const join = /(?:path\.)?(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$.]*)\s*,/gu;
    let inner;
    while ((inner = join.exec(bodyCode)) !== null) {
      bases.add(normalizeExpression(inner[1]));
    }
    if (!functions.has(match[1])) functions.set(match[1], bases);
  }
  return { definitions, propertyValues, functions };
}

/**
 * The expressions the file itself derives from `expression`: its definition,
 * the base of a join it builds, and — for a member expression — the property's
 * own value and the bare local of the same name.
 */
function derivedExpressions(expression, facts) {
  const derived = new Set();
  const pending = [normalizeExpression(expression)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.length === 0 || derived.has(current)) continue;
    derived.add(current);
    if (facts.definitions.has(current)) {
      pending.push(facts.definitions.get(current));
    }
    const base = joinBase(current);
    if (base !== null) pending.push(base);
    const member = current.match(/^[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)$/u);
    if (member !== null) {
      if (facts.propertyValues.has(member[1])) {
        pending.push(facts.propertyValues.get(member[1]));
      }
      pending.push(member[1]);
    }
    const call = current.match(/^([A-Za-z_$][\w$]*)\s*\(/u);
    if (call !== null && facts.functions.has(call[1])) {
      for (const candidate of facts.functions.get(call[1]))
        pending.push(candidate);
    }
  }
  return derived;
}

/**
 * The expressions that denote the parent directory of the rename destination.
 * The destination is a FILE path, so the parent is either `path.dirname(<the
 * destination>)` or the directory the destination is built from:
 * `path.join(<parent>, "name")`, a property of the same paths object built from
 * it, or the body of the local function that builds it.
 */
function parentExpressions(destination, facts) {
  const target = normalizeExpression(destination);
  const parents = new Set([`path.dirname(${target})`, `dirname(${target})`]);
  const seen = new Set();
  const pending = [target];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.length === 0 || seen.has(current)) continue;
    seen.add(current);
    const base = joinBase(current);
    if (base !== null) {
      parents.add(base);
      pending.push(base);
      continue;
    }
    if (facts.definitions.has(current)) {
      pending.push(facts.definitions.get(current));
      continue;
    }
    const member = current.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/u);
    if (member !== null && facts.propertyValues.has(member[2])) {
      const value = facts.propertyValues.get(member[2]);
      parents.add(value);
      parents.add(`${member[1]}.${member[2]}`);
      pending.push(value);
      // Every other property of the same object that holds that same value is
      // the same directory (`{ root, snapshot: path.join(root, …) }`).
      for (const [name, candidate] of facts.propertyValues) {
        if (candidate === value) {
          parents.add(`${member[1]}.${name}`);
          parents.add(name);
        }
      }
      continue;
    }
    const call = current.match(/^([A-Za-z_$][\w$]*)\s*\(/u);
    if (call !== null && facts.functions.has(call[1])) {
      for (const candidate of facts.functions.get(call[1])) {
        parents.add(candidate);
        pending.push(candidate);
      }
    }
  }
  return parents;
}

/**
 * True when `expression` denotes the parent directory of `destination`, as the
 * file itself derives it — not merely a handle whose name suggests one.
 */
function denotesParentDirectory(expression, destination, facts) {
  const parents = parentExpressions(destination, facts);
  const derived = derivedExpressions(expression, facts);
  for (const candidate of derived) {
    if (parents.has(candidate)) return true;
  }
  return false;
}

/**
 * A handle that is opened with the read flag and then fsynced, bound to the
 * handle variable that the open produced.
 */
function boundDirectoryFsync(body) {
  if (body === null) return null;
  const bodyCode = codeOnly(body);
  const opens = readHandleOpens(body, bodyCode);
  const fsyncs = fsyncCalls(body, bodyCode);
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
function directorySyncHelpers(source, code) {
  const helpers = [];
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
      // The body is sliced from the RAW source so the read flag survives, and
      // masked again inside `boundDirectoryFsync` so a comment is not evidence.
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

/** The first argument the window passes to `name(`, or null. */
function callArgumentInWindow(window, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "gu");
  let match;
  while ((match = pattern.exec(window)) !== null) {
    const arguments_ = callArguments(window, match.index + match[0].length - 1);
    return arguments_.length > 0 ? normalizeExpression(arguments_[0]) : "";
  }
  return null;
}

/**
 * Proves, for EVERY rename site in one source text, that the rename is followed
 * by a directory fsync bound to a handle of its own, opened on the rename
 * destination's PARENT directory.
 *
 * `label` names the file in every failure message, because a message that
 * cannot name the site cannot be acted on. The entry point takes the source
 * text so a lane can prove the predicate itself against a known-bad fixture —
 * a predicate that can only be applied to real files cannot be shown to fail.
 */
export function proveDurableWriterSource({ source, label }) {
  const code = codeOnly(source);
  const facts = expressionFacts(source, code);
  const sites = renameSites(source, code);
  assert.ok(sites.length > 0, `${label} must publish with a rename`);
  const fsyncs = fsyncCalls(source, code);
  const opens = readHandleOpens(source, code);
  const helpers = directorySyncHelpers(source, code);
  for (const site of sites) {
    // The handle the temporary file itself was fsynced through. It is looked up
    // in the SAME function as the rename, because two functions in one file
    // routinely use the same handle name for different bindings.
    const range = enclosingFunctionRange(code, site.index);
    const next = sites.find((candidate) => candidate.index > site.index);
    // The window closes at the end of the function, not at the next rename:
    // a helper call in a LATER function is not a fsync that follows THIS rename.
    const windowEnd = Math.min(next ? next.index : source.length, range.end);
    const window = code.slice(site.index, windowEnd);
    const ownFsyncs = fsyncs.filter(
      (call) => call.index >= range.start && call.index <= range.end,
    );
    const fileHandle =
      ownFsyncs.filter((call) => call.index < site.index).at(-1)?.handle ??
      null;
    assert.ok(
      site.destination !== null,
      `${label}:${site.line} the rename call must name its destination`,
    );
    // Re-fsyncing the temporary file's own handle AFTER the rename flushes
    // bytes that were already durable: the directory entry is what is missing.
    // (A separate function's handle of the same name is a different binding,
    // so the lookup above is scoped to this function.)
    assert.equal(
      fileHandle === null ||
        !ownFsyncs.some(
          (call) => call.index > site.index && call.handle === fileHandle,
        ),
      true,
      `${label}:${site.line} fsyncs the already-durable file handle '${fileHandle}' after the rename instead of a parent-directory handle, so a crash can still lose the rename`,
    );

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
      assert.ok(
        denotesParentDirectory(inline.open.expression, site.destination, facts),
        `${label}:${site.line} fsyncs a directory handle opened on '${inline.open.expression}', which is not the parent of the rename destination '${site.destination}' — the rename into '${site.destination}' stays undurable`,
      );
      continue;
    }

    // Form B: the directory fsync is delegated to a local helper whose own
    // body binds an fsync to a handle opened with the read flag, and which is
    // CALLED with the destination's parent directory.
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
      `${label}:${site.line} renames a file into place, so it must be followed by a directory fsync bound to a handle opened on the parent directory (no such fsync follows this rename)`,
    );
    const argument = callArgumentInWindow(window, helper.name);
    assert.ok(
      argument !== null &&
        denotesParentDirectory(argument, site.destination, facts),
      `${label}:${site.line} delegates the directory fsync to ${helper.name}() with '${argument ?? "(no argument)"}', which is not the parent of the rename destination '${site.destination}' — the rename into '${site.destination}' stays undurable`,
    );
  }
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
  proveDurableWriterSource({ source, label: relative });
}

/**
 * The writers whose defect is already filed against a PRODUCTION row and is
 * therefore out of scope for this test-only lane. The lane proves this list is
 * EXACTLY the set of derived writers that fail, so it reddens in both
 * directions: a new undurable writer that is not listed here fails the lane,
 * and a listed writer that has been fixed fails it until the entry is deleted.
 * A hand-typed skip list without that two-way proof would be the same oracle
 * defect the row is about.
 */
export const REPORTED_UNDURABLE_WRITERS = Object.freeze([
  Object.freeze({
    writer: "zink-skill-store/src/catalog.mjs",
    row: "F-410/F-411",
    site: "writeFileAtomic()",
    reason:
      "await rename(tmp, filePath) without any following directory fsync; fixing it changes zink-skill-store production code",
  }),
]);

/**
 * The directories whose writers the durability rows own. The population is
 * derived by scanning these trees, not typed: a new atomic writer in any of
 * them joins the gate without an edit here.
 */
const WRITER_ROOTS = Object.freeze([
  "integrations",
  "zink-skill-store",
  "zink-tools",
]);

/**
 * True when the source publishes a temporary file with a rename. The rename
 * keyword is read from the CODE (so a comment cannot enroll a file), while the
 * temporary-name marker is read from the raw source because it lives inside a
 * template literal.
 */
export function isAtomicWriterSource(source) {
  const code = codeOnly(source);
  return (
    /\brename(?:Sync)?\s*\(/u.test(code) &&
    /\.tmp-|\.tmp`|\.pending-|\.staging|stagingName\s*\(/u.test(source)
  );
}

function gitListWriterCandidates() {
  const output = execFileSync(
    "git",
    ["-c", `safe.directory=${REPO}`, "ls-files", "-z", ...WRITER_ROOTS],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .filter((relative) => relative.endsWith(".mjs"))
    .filter(
      (relative) =>
        !relative.includes("/fixtures/") &&
        !relative.includes("/__fixtures__/"),
    );
}

/**
 * Derives the atomic-writer population from the repository: every tracked
 * `.mjs` under the writer roots that renames a temporary path. The result
 * carries the number of files actually READ, because the row's failure mode is
 * a scan that enumerates zero writers and then "passes": `scanned` must equal
 * the number of candidates, and both counts must be non-zero.
 *
 * `listFiles` and `readSource` are injectable so a lane can prove the counters
 * fail on a truncated enumeration and on an unread file.
 */
export function discoverAtomicWriters({
  listFiles = gitListWriterCandidates,
  readSource = (relative) => readFileSync(path.join(REPO, relative), "utf8"),
} = {}) {
  const files = listFiles();
  assert.ok(
    files.length > 0,
    "the atomic-writer derivation enumerated zero candidate files: an empty scan must fail loudly instead of proving an empty population",
  );
  const writers = [];
  let scanned = 0;
  for (const relative of files) {
    const source = readSource(relative);
    if (typeof source !== "string") continue;
    scanned += 1;
    if (isAtomicWriterSource(source)) writers.push(relative);
  }
  assert.equal(
    scanned,
    files.length,
    `the atomic-writer derivation read ${scanned} of ${files.length} candidate files: a file that is silently skipped hides its writer from the gate`,
  );
  assert.ok(
    writers.length > 0,
    `the atomic-writer derivation scanned ${scanned} files and matched zero writers: the scan itself is broken`,
  );
  return { files: files.length, scanned, writers: writers.sort() };
}

export { REPO };
