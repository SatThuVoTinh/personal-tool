// F-261 (R7-D12B-01) - a stale git worktree inside scratch/ carries its own
// AGENTS.md and PLAN.md that assert owner-level authority, and every gate
// excludes it.
//
// The acceptance criterion offers two branches: no registered worktree under
// the repo root other than the primary, OR a gate asserting that
// `git worktree list` has exactly one entry. The gate is the durable half,
// because a worktree can be registered again at any time and no review would
// notice: the second copy is gitignored, so it is outside the tracked file
// set, outside every gate, and still readable by a cold resume that globs
// for PLAN.md or AGENTS.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  checkWorktreeRegistry,
  evaluateWorktreeRegistry,
} from "../scripts/repository-policy.mjs";

const root = process.cwd();

function porcelain(...entries) {
  return entries
    .map((entry) => `${entry}\nHEAD 0123456789abcdef\nbranch refs/heads/main\n`)
    .join("\n");
}

test("F-261: the gate refuses a second registered worktree", () => {
  const failures = evaluateWorktreeRegistry(
    porcelain(
      "worktree C:/repo",
      "worktree C:/repo/scratch/wt-discord-idle-reset",
    ),
    "C:/repo",
  );
  assert.ok(failures.length > 0, "a second worktree must fail the gate");
  assert.ok(
    failures.some((failure) => failure.includes("wt-discord-idle-reset")),
    `the failure must name the offending worktree: ${failures.join(" | ")}`,
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("only the primary working tree may be registered"),
    ),
    `the gate must report the count rule, not only the path of one entry: ${failures.join(" | ")}`,
  );
});

test("F-261: one registered worktree that is the primary is accepted", () => {
  const failures = evaluateWorktreeRegistry(
    porcelain("worktree C:/repo"),
    "C:/repo",
  );
  assert.deepEqual(failures, []);
});

test("F-261: a registered worktree that is not the primary is refused", () => {
  const failures = evaluateWorktreeRegistry(
    porcelain("worktree C:/somewhere/else"),
    "C:/repo",
  );
  assert.ok(
    failures.some((failure) => failure.includes("not the primary")),
    `the failure must say the worktree is not the primary: ${failures.join(" | ")}`,
  );
});

test("F-261: a repository that reports no worktree at all is refused", () => {
  const failures = evaluateWorktreeRegistry("", "C:/repo");
  assert.ok(
    failures.length > 0,
    "a repository with no registered worktree cannot prove which tree is authoritative",
  );
});
test("F-261: this repository registers exactly one worktree, and it is this one", () => {
  assert.deepEqual(checkWorktreeRegistry(root), []);
});

test("F-261: the repository policy check runs the worktree gate", () => {
  const source = readFileSync(
    path.join(root, "scripts", "repository-policy.mjs"),
    "utf8",
  );
  const collector = source.slice(
    source.indexOf(
      "export function collectRepositoryFailures(repositoryRoot) {",
    ),
  );
  assert.ok(
    collector.includes("checkWorktreeRegistry(repositoryRoot)"),
    "the policy collector must run the worktree gate",
  );
});

test("F-261: the gate reads the live worktree registry, not a fixture", () => {
  const failures = checkWorktreeRegistry(root);
  assert.ok(Array.isArray(failures));
  assert.deepEqual(failures, []);
});
