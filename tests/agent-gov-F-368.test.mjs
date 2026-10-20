// F-368 (R7-IG-08) — four of six state files carry none of the six required
// freshness keys, so the documented resume check cannot run and closeout never
// deleted them.
//
// Every non-empty state file carries the six-field freshness header, the
// protocol says who keeps the two mutable state files, and no state file records
// verdicts on register ids that the register does not contain.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const STATES_DIRECTORY = path.join(REPO_ROOT, ".agents", "states");
const STATES_PROTOCOL = read(".agents", "states", "README.md");
const PLAN = read("PLAN.md");
const REGISTER = read("docs", "execution", "findings.md");

const REQUIRED_KEYS = [
  "Task:",
  "Plan revision/state:",
  "Repository HEAD:",
  "Working tree:",
  "Last refreshed:",
  "Writer:",
];

const LEGACY_ID = /\bR\d+-[A-Z0-9]+(?:-\d+)?\b/gu;

function stateFiles() {
  if (!existsSync(STATES_DIRECTORY)) return [];
  return readdirSync(STATES_DIRECTORY)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `.agents/states/${name}`);
}

function registerIds() {
  const ids = new Set();
  for (const match of REGISTER.matchAll(
    /^- Legacy register id:[ ]*`?([^`\n]+)`?/gmu,
  )) {
    for (const id of match[1].match(LEGACY_ID) ?? []) ids.add(id);
  }
  const closure = REGISTER.split(/^## 2\./mu)[1] ?? "";
  for (const match of closure.matchAll(/^\|\s*`([^`]+)`/gmu)) {
    for (const id of match[1].match(LEGACY_ID) ?? []) ids.add(id);
  }
  return ids;
}

test("F-368: every state file carries the six-field freshness header", () => {
  const offenders = [];
  for (const relative of stateFiles()) {
    const contents = read(...relative.split("/"));
    if (!contents.trim()) continue;
    const header = contents.split("\n").slice(0, 14).join("\n");
    const missing = REQUIRED_KEYS.filter((key) => !header.includes(key));
    if (missing.length > 0) {
      offenders.push(`${relative} — missing ${missing.join(", ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the resume check compares HEAD with the state freshness header; a file without the six keys cannot be compared: ${offenders.join(" | ")}`,
  );
});

test("F-368: no state file records a verdict on a register id the register does not contain", () => {
  const known = registerIds();
  const offenders = [];
  for (const relative of stateFiles()) {
    const contents = read(...relative.split("/"));
    const ids = new Set(contents.match(LEGACY_ID) ?? []);
    for (const id of ids) {
      if (known.has(id)) continue;
      if (PLAN.includes(id)) continue;
      offenders.push(`${relative} — ${id}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a state file records a verdict on an id no register row carries: ${offenders.join(" | ")}`,
  );
});

test("F-368: the protocol says who keeps the two mutable state files", () => {
  assert.match(
    STATES_PROTOCOL,
    /delete or clear the two mutable local state files/u,
    "the protocol must say that closeout deletes the two mutable state files",
  );
  assert.match(
    STATES_PROTOCOL,
    /nobody keeps them|delete/iu,
    "the protocol must name the deletion as the closeout rule",
  );
});
