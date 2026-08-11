import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkCommandDefinitions,
  checkGitWhitespace,
  checkRequiredFiles,
  checkTrackedFilePolicies,
  checkWorkflowDefinitions,
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
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  execFileSync("git", ["add", "--", relativePath], { cwd: repositoryRoot });
}

function withTemporaryDirectory(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "personal-tool-workflow-"));
  try {
    callback(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function writeWorkflow(repositoryRoot, name, contents) {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  mkdirSync(workflowDirectory, { recursive: true });
  writeFileSync(path.join(workflowDirectory, name), contents);
}

const VALID_CI_WORKFLOW = `name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  quality-gate:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: "24.15.0"
          package-manager-cache: false
      - working-directory: \${{ runner.temp }}
        run: npm install --global npm@12.0.2
      - run: |
          test "$(node --version)" = "v24.15.0"
          test "$(npm --version)" = "12.0.2"
      - run: npm ci
      - run: npm run verify
`;

const VALID_SECURITY_WORKFLOW = `name: Security

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: "0 2 * * 1"
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read

jobs:
  dependency-audit:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: "24.15.0"
          package-manager-cache: false
      - working-directory: \${{ runner.temp }}
        run: npm install --global npm@12.0.2
      - run: |
          test "$(node --version)" = "v24.15.0"
          test "$(npm --version)" = "12.0.2"
      - run: npm audit --audit-level=high
  secret-scan:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
        env:
          GITHUB_TOKEN: \${{ github.token }}
          GITLEAKS_ENABLE_COMMENTS: "false"
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
`;

function writeValidWorkflows(repositoryRoot) {
  writeWorkflow(repositoryRoot, "ci.yml", VALID_CI_WORKFLOW);
  writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
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

test("accepts valid executable CI and Security workflow contracts", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeValidWorkflows(repositoryRoot);
    assert.deepEqual(checkWorkflowDefinitions(repositoryRoot), []);
  });
});

test("rejects invalid workflow YAML and a missing required job", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(repositoryRoot, "ci.yml", "on: [\n");
    writeWorkflow(
      repositoryRoot,
      "security.yml",
      VALID_SECURITY_WORKFLOW.replace("dependency-audit:", "audit:"),
    );
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("YAML is invalid")));
    assert.ok(
      failures.some((failure) =>
        failure.includes("missing job dependency-audit"),
      ),
    );
  });
});

test("rejects a missing required executable workflow step", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "        run: npm install --global npm@12.0.2",
        "        run: echo bootstrap-is-missing",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("npm bootstrap")));
  });
});

test("does not treat comments or metadata as an executable CI command", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "      - run: npm ci",
        "      - name: npm ci\n        run: '# npm ci'",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("command `npm ci`")));
  });
});

test("rejects CI commands in the wrong order", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "      - run: npm ci\n      - run: npm run verify",
        "      - run: npm run verify\n      - run: npm ci",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("required order")));
  });
});

test("rejects mutable and abbreviated external Action references", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/checkout@v7",
      ),
    );
    writeWorkflow(
      repositoryRoot,
      "security.yml",
      VALID_SECURITY_WORKFLOW.replace(
        "gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
        "gitleaks/gitleaks-action@e0c47f4f",
      ),
    );
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) => failure.includes("full 40-character SHA")),
    );
  });
});

test("rejects setup-node caching and missing npm version assertions", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "          package-manager-cache: false\n",
        "",
      ).replace(
        / {6}- run: \|\n {10}test "\$\(node --version\)" = "v24\.15\.0"\n {10}test "\$\(npm --version\)" = "12\.0\.2"\n/,
        "      - run: echo toolchain\n",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) => failure.includes("package-manager-cache")),
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes("Node/npm version assertions"),
      ),
    );
  });
});

test("rejects Gitleaks without full-history checkout or required flags", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(repositoryRoot, "ci.yml", VALID_CI_WORKFLOW);
    writeWorkflow(
      repositoryRoot,
      "security.yml",
      VALID_SECURITY_WORKFLOW.replace("  pull-requests: read\n", "")
        .replace("fetch-depth: 0", "fetch-depth: 1")
        .replace('          GITLEAKS_ENABLE_COMMENTS: "false"\n', ""),
    );
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(failures.some((failure) => failure.includes("fetch-depth to 0")));
    assert.ok(
      failures.some((failure) => failure.includes("GITLEAKS_ENABLE_COMMENTS")),
    );
    assert.ok(
      failures.some((failure) => failure.includes("permissions.pull-requests")),
    );
  });
});
