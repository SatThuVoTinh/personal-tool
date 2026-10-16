import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkCommandDefinitions,
  checkFormatGlobQuoting,
  checkGitWhitespace,
  checkRequiredFiles,
  checkTestListReconciliation,
  checkTrackedFilePolicies,
  checkWorkflowDefinitions,
  checkWorkingTreeTextPolicy,
  collectRepositoryFailures,
  listTrackedFiles,
} from "../scripts/repository-policy.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  python-quality:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97
        with:
          python-version: "3.13"
      - run: pip install --disable-pip-version-check "uv==0.12.5"
      - run: uv sync --locked
      - run: npm run test:knowledge
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

test("rejects a tracked runtime license artifact", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "runtime/minio.license",
      "not-a-license\n",
    );
    const failures = checkTrackedFilePolicies(listTrackedFiles(repositoryRoot));
    assert.deepEqual(failures, [
      "Tracked sensitive file is not allowlisted: runtime/minio.license",
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

test("allows Git to represent an intentional tracked file deletion", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(repositoryRoot, "obsolete.txt", "obsolete\n");
    rmSync(path.join(repositoryRoot, "obsolete.txt"));
    assert.deepEqual(
      checkWorkingTreeTextPolicy(
        repositoryRoot,
        listTrackedFiles(repositoryRoot),
      ),
      [],
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
        "test:knowledge":
          "uv run --directory apps/knowledge --locked python -m pytest tests -q",
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

test("requires a blocking Knowledgebase Python job in CI", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(/^ {2}python-quality:[\s\S]*$/mu, ""),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) =>
        failure.includes("missing job python-quality"),
      ),
    );
  });

  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "  python-quality:\n",
        "  python-quality:\n    continue-on-error: true\n",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes("must block on failure"),
      ),
    );
  });

  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "      - run: npm run test:knowledge",
        "      - run: npm run test:knowledge\n        continue-on-error: true",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) => failure.includes("must block on failure")),
    );
  });
});

test("rejects a CI job that drops or reorders the Knowledgebase suite", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace("      - run: npm run test:knowledge\n", ""),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes(
          "must contain executable command `npm run test:knowledge`",
        ),
      ),
    );
  });

  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "      - run: uv sync --locked\n      - run: npm run test:knowledge",
        "      - run: npm run test:knowledge\n      - run: uv sync --locked",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes("must appear in the required order"),
      ),
    );
  });
});

test("rejects pulling the pdf-runtime closure into the Python CI job", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeWorkflow(
      repositoryRoot,
      "ci.yml",
      VALID_CI_WORKFLOW.replace(
        "      - run: uv sync --locked",
        "      - run: uv sync --locked --directory pdf-runtime",
      ),
    );
    writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes("must not install the pdf-runtime closure"),
      ),
    );
  });
});

test("rejects a verify gate that deviates from the documented Node stage order", () => {
  const validScripts = {
    format: "prettier --write README.md",
    "format:check": "prettier --check README.md",
    lint: "eslint scripts",
    test: "node --test tests",
    "test:knowledge":
      "uv run --directory apps/knowledge --locked python -m pytest tests -q",
    "repo:check": "node scripts/repository-check.mjs",
  };
  const verifyFailures = (verify) =>
    checkCommandDefinitions(
      { scripts: { ...validScripts, verify } },
      "install:\n\tnpm ci\n",
    ).filter((failure) => failure.includes("verify must run the documented"));

  assert.deepEqual(
    verifyFailures(
      "npm run format:check && npm run lint && npm test && npm run repo:check",
    ),
    [],
  );

  for (const verify of [
    // A missing stage silently shrinks the gate.
    "npm run format:check && npm run lint && npm test",
    "npm run lint && npm test && npm run repo:check",
    // Reordering defeats the fail-fast ordering.
    "npm run format:check && npm run repo:check && npm run lint && npm test",
    // The Python tier has one named executor per environment; folding it back in
    // would make every `verify` job depend on the Python toolchain.
    "npm run format:check && npm run lint && npm test && npm run test:knowledge && npm run repo:check",
  ]) {
    assert.equal(verifyFailures(verify).length, 1, verify);
  }
});

test("requires exactly one CI executor for the Knowledgebase Python suite", () => {
  withTemporaryDirectory((repositoryRoot) => {
    writeValidWorkflows(repositoryRoot);
    assert.deepEqual(checkWorkflowDefinitions(repositoryRoot), []);
  });

  // Duplicating the suite (the shape that made `CI / quality-gate` unrunnable:
  // `verify` reached `uv run` in a job that provisions only Node).
  const duplicated = VALID_CI_WORKFLOW.replace(
    "      - run: npm ci\n      - run: npm run verify",
    "      - run: npm ci\n      - run: npm run test:knowledge\n      - run: npm run verify",
  );
  assert.notEqual(duplicated, VALID_CI_WORKFLOW);
  withTemporaryDirectory((repositoryRoot) => {
    writeValidWorkflows(repositoryRoot);
    writeWorkflow(repositoryRoot, "ci.yml", duplicated);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes(
          "must be executed exactly once, by job python-quality",
        ),
      ),
    );
  });

  // Moving the suite to a job that is not the designated owner.
  const misplaced = VALID_CI_WORKFLOW.replace(
    "      - run: npm run test:knowledge\n",
    "",
  ).replace(
    "      - run: npm run verify",
    "      - run: npm run test:knowledge\n      - run: npm run verify",
  );
  withTemporaryDirectory((repositoryRoot) => {
    writeValidWorkflows(repositoryRoot);
    writeWorkflow(repositoryRoot, "ci.yml", misplaced);
    assert.ok(
      checkWorkflowDefinitions(repositoryRoot).some((failure) =>
        failure.includes(
          "must be executed exactly once, by job python-quality",
        ),
      ),
    );
  });
});

test("requires a Knowledgebase Python test script and Make target", () => {
  const failures = checkCommandDefinitions(
    {
      scripts: {
        format: "prettier --write README.md",
        "format:check": "prettier --check README.md",
        lint: "eslint scripts",
        test: "node --test tests",
        "repo:check": "node scripts/repository-check.mjs",
        verify:
          "npm run format:check && npm run lint && npm test && npm run repo:check",
      },
    },
    "install:\n\tnpm ci\n",
  );

  assert.ok(
    failures.includes(
      "npm script is missing or placeholder-like: test:knowledge",
    ),
  );
  assert.ok(
    failures.includes(
      "Make target test-knowledge must run npm run test:knowledge.",
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

test("accepts an npm test list that matches the test files on disk", () => {
  assert.deepEqual(
    checkTestListReconciliation(
      { scripts: { test: "node --test tests/a.test.mjs tests/b.test.mjs" } },
      ["tests/a.test.mjs", "tests/b.test.mjs"],
    ),
    [],
  );
});

test("parses only test-file arguments out of the npm test command", () => {
  assert.deepEqual(
    checkTestListReconciliation(
      {
        scripts: {
          test: "node --test --test-concurrency=1 tests/a.test.mjs",
        },
      },
      ["tests/a.test.mjs"],
    ),
    [],
  );
});

test("reports a test file that exists on disk but is not enumerated in npm test", () => {
  const failures = checkTestListReconciliation(
    { scripts: { test: "node --test tests/a.test.mjs" } },
    ["tests/a.test.mjs", "tests/orphan.test.mjs"],
  );
  assert.equal(failures.length, 1, failures.join("; "));
  assert.match(failures[0], /tests\/orphan\.test\.mjs/u);
  assert.ok(!failures[0].includes("tests/a.test.mjs"));
});

test("reports an npm test entry that has no matching file on disk", () => {
  const failures = checkTestListReconciliation(
    { scripts: { test: "node --test tests/a.test.mjs tests/gone.test.mjs" } },
    ["tests/a.test.mjs"],
  );
  assert.equal(failures.length, 1, failures.join("; "));
  assert.match(failures[0], /tests\/gone\.test\.mjs/u);
});

test("the real npm test list matches the real tests directory", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const testFiles = readdirSync(path.join(REPO_ROOT, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `tests/${name}`);
  assert.deepEqual(
    checkTestListReconciliation(packageJson, testFiles),
    [],
    "every test file on disk must be enumerated in the npm test script, and every " +
      "enumerated entry must exist on disk",
  );
});

test("repo:check itself refuses a test file the npm test script never names", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "package.json",
      JSON.stringify({
        scripts: { test: "node --test tests/listed.test.mjs" },
      }),
    );
    writeTrackedFile(repositoryRoot, "Makefile", "# no targets under test\n");
    writeTrackedFile(
      repositoryRoot,
      "tests/listed.test.mjs",
      'import test from "node:test";\ntest("listed", () => {});\n',
    );
    writeTrackedFile(
      repositoryRoot,
      "tests/orphan.test.mjs",
      'import test from "node:test";\ntest("orphan", () => {});\n',
    );
    const failures = collectRepositoryFailures(repositoryRoot);
    assert.ok(
      failures.some((failure) => failure.includes("tests/orphan.test.mjs")),
      `repo:check must report the unlisted file; got: ${failures.join(" | ")}`,
    );
  });
});

test("reports a prettier glob the shell would expand before prettier sees it", () => {
  const failures = checkFormatGlobQuoting({
    scripts: { "format:check": "prettier --check tests/**/*.mjs docs/*.md" },
  });
  assert.equal(failures.length, 2, failures.join(" | "));
  assert.match(failures[0], /tests\/\*\*\/\*\.mjs/u);
  assert.match(failures[1], /docs\/\*\.md/u);
});

test("reports a single-quoted glob, because cmd.exe does not honour single quotes", () => {
  const failures = checkFormatGlobQuoting({
    scripts: { format: "prettier --write 'tests/**/*.mjs'" },
  });
  assert.equal(failures.length, 1, failures.join(" | "));
  assert.match(failures[0], /double quotes/u);
});

test("accepts double-quoted globs and brace expansions", () => {
  assert.deepEqual(
    checkFormatGlobQuoting({
      scripts: {
        "format:check":
          'prettier --check README.md "docs/**/*.md" ".github/workflows/*.{yml,yaml}"',
        format: 'prettier --write "tests/**/*.mjs"',
      },
    }),
    [],
  );
});

test("the real format scripts quote every glob so CI expands them the same way Windows does", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  assert.deepEqual(
    checkFormatGlobQuoting(packageJson),
    [],
    "an unquoted glob makes /bin/sh expand tests/**/*.mjs as tests/*/*.mjs, so the " +
      "CI format gate checks one directory level and never sees the test files",
  );
});
