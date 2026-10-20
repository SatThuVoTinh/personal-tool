// F-366 (R7-IG-06) - backups/ holds the audit record's snapshots and
// database dumps with no tracked owner, retention rule, or ignore coverage
// for nested paths.
//
// The ignore half is already committed: every generated tree named backups,
// logs or temp is ignored wherever it sits, and the repository policy check
// fails when one is not. This suite covers the remaining half - one tracked
// document that names the owner, the purpose and the retention of the
// directory, and says that a snapshot is never the canonical record.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { checkNestedGeneratedTreesIgnored } from "../scripts/repository-policy.mjs";

const root = process.cwd();

const RUNBOOK_PATH = path.join(
  "docs",
  "runbooks",
  "backups-and-recovery-archives.md",
);

function runbook() {
  return readFileSync(path.join(root, RUNBOOK_PATH), "utf8");
}

test("F-366: one tracked document names the owner, the purpose and the retention of backups/", () => {
  const text = runbook();
  assert.match(text, /^## Owner$/mu, "the document must name an owner");
  assert.match(text, /^## Purpose$/mu, "the document must name the purpose");
  assert.match(
    text,
    /^## Retention$/mu,
    "the document must state the retention",
  );
  assert.match(
    text,
    /^## The canonical copy$/mu,
    "the document must name the canonical copy",
  );
});

test("F-366: the document says a snapshot is never the canonical record", () => {
  const text = runbook();
  assert.match(text, /never the canonical record/iu);
  assert.match(text, /docs\/execution\/findings\.md/);
});

test("F-366: the document is a repository file git will track, and is not ignored", () => {
  const relative = RUNBOOK_PATH.replaceAll("\\", "/");
  const listed = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${root}`,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      relative,
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(
    listed,
    [relative],
    "the document must be a repository file",
  );

  const ignored = spawnSync(
    "git",
    ["-c", `safe.directory=${root}`, "check-ignore", "-q", "--", relative],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(
    ignored.status,
    0,
    "the document must not be git-ignored, or it owns nothing",
  );
});

test("F-366: a nested backups/ directory is covered by the ignore rules", () => {
  const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(
    gitignore,
    /^\*\*\/backups\/\*$/mu,
    "the ignore rule must not be root-anchored only",
  );
  assert.deepEqual(checkNestedGeneratedTreesIgnored(root), []);
});
