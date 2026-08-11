import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkCommandDefinitions,
  checkGitWhitespace,
  checkRequiredFiles,
  checkTrackedFilePolicies,
  checkWorkingTreeTextPolicy,
  listTrackedFiles,
} from "../scripts/repository-policy.mjs";

function withTemporaryRepository(callback) {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "personal-tool-policy-"),
  );
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "core.autocrlf", "false"], {
      cwd: repositoryRoot,
    });
    callback(repositoryRoot);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
}

function writeTrackedFile(repositoryRoot, relativePath, contents) {
  const filePath = path.join(repositoryRoot, relativePath);
  writeFileSync(filePath, contents);
  execFileSync("git", ["add", "--", relativePath], { cwd: repositoryRoot });
}

test("rejects a tracked .env file", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(repositoryRoot, ".env", "TOKEN=not-a-real-secret\n");
    const failures = checkTrackedFilePolicies(listTrackedFiles(repositoryRoot));
    assert.deepEqual(failures, [
      "Tracked sensitive file is not allowlisted: .env",
    ]);
  });
});

test("accepts allowlisted example and test fixture paths", () => {
  const failures = checkTrackedFilePolicies([
    ".env.example",
    "credentials.template.json",
    "tests/fixtures/repository-policy/allowed/test-private.key",
  ]);
  assert.deepEqual(failures, []);
});

test("detects CR line endings and trailing whitespace in working-tree bytes", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "note.md",
      Buffer.from("line with space \r\n", "utf8"),
    );
    const failures = checkWorkingTreeTextPolicy(
      repositoryRoot,
      listTrackedFiles(repositoryRoot),
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes("uses CR line endings: note.md"),
      ),
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes("trailing whitespace: note.md:1"),
      ),
    );
  });
});

test("detects Git whitespace violations independently from tracked index state", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(repositoryRoot, "note.md", "clean line\n");
    writeFileSync(path.join(repositoryRoot, "note.md"), "line with space \n");
    const failures = checkGitWhitespace(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("git diff --check")));
  });
});

test("reports missing required repository files", () => {
  withTemporaryRepository((repositoryRoot) => {
    const failures = checkRequiredFiles(repositoryRoot);
    assert.ok(
      failures.includes("Required repository file is missing: package.json"),
    );
  });
});

test("rejects placeholder-like npm scripts and Make targets", () => {
  const failures = checkCommandDefinitions(
    {
      scripts: {
        format: "echo formatted",
        "format:check": "true",
        lint: "TODO",
        test: "node --test",
        "repo:check": "node scripts/repository-check.mjs",
        verify: "npm run verify",
      },
    },
    "install:\n\techo install\n",
  );

  assert.ok(
    failures.some((failure) =>
      failure.includes("npm script is missing or placeholder-like: format"),
    ),
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("Make target install must run npm ci."),
    ),
  );
});
