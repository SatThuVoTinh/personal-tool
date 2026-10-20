// F-178 (R5-E12-07) — the "no extra state files" rule and the retired
// `.agents/states/active-task.md` artifact.
//
// The rule must state a count that matches the file set the protocol defines,
// and no live skill or doc may name the retired file as a live or prohibited
// artifact.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const STATES_PROTOCOL = read(".agents", "states", "README.md");

function collectAgentFiles(directory) {
  const found = [];
  for (const entry of readdirSync(path.join(REPO_ROOT, directory), {
    withFileTypes: true,
  })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...collectAgentFiles(relative));
    else found.push(relative);
  }
  return found;
}

test("F-178: the state protocol defines exactly two state files and says so", () => {
  const table = /^\| `?(context\.md|handoff\.md)`? \|/gmu;
  const defined = [...STATES_PROTOCOL.matchAll(table)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(defined)].sort(),
    ["context.md", "handoff.md"],
    "the protocol's file table must define exactly the two mutable state files",
  );
  assert.match(
    STATES_PROTOCOL,
    /cannot fit these two\b/u,
    "the 'no extra state files' rule must state the count that matches the file set",
  );
});

test("F-178: no live agent document names the retired active-task.md artifact", () => {
  const offenders = [];
  for (const relative of collectAgentFiles(".agents")) {
    if (relative.endsWith("README.md") && relative.includes("states")) {
      // the protocol itself may explain the retirement, but must not prohibit a
      // file it does not define
    }
    const contents = read(...relative.split("/"));
    if (!contents.includes("active-task.md")) continue;
    offenders.push(relative);
  }
  assert.deepEqual(
    offenders,
    [],
    `a document names the retired .agents/states/active-task.md as if it were live or prohibited: ${offenders.join(", ")}`,
  );
});
