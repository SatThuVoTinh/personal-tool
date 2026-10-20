import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
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
  checkDocumentedScriptsAreCovered,
  checkFindingsRegister,
  checkFormatGlobQuoting,
  checkGateRegistry,
  checkGitWhitespace,
  checkNestedGeneratedTreesIgnored,
  checkNoEmptyScriptCategory,
  checkRegisterCitations,
  checkRequiredFiles,
  checkSecretScanAllowlist,
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
      - run: python -c "import sys; assert sys.version_info[:2] == (3, 13), sys.version"
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: "24.15.0"
          package-manager-cache: false
      - working-directory: \${{ runner.temp }}
        run: npm install --global npm@12.0.2
      - run: |
          test "$(node --version)" = "v24.15.0"
          test "$(npm --version)" = "12.0.2"
      - name: Fetch pinned tokenizer
        run: |
          mkdir -p "\${{ runner.temp }}/knowledge-artifacts"
          curl --fail --location --silent --show-error \
            --output "\${{ runner.temp }}/knowledge-artifacts/tokenizer.json" \
            "https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/tokenizer.json"
          echo "69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15  \${{ runner.temp }}/knowledge-artifacts/tokenizer.json" | sha256sum --check --strict
      - working-directory: apps/knowledge
        run: uv sync --locked
      - env:
          KNOWLEDGE_TOKENIZER_PATH: \${{ runner.temp }}/knowledge-artifacts/tokenizer.json
        run: npm run test:knowledge
`;

const VALID_SECURITY_WORKFLOW = `name: Security

on:
  pull_request:
    branches: [main]
  push:
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
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "true"
`;

function writeValidWorkflows(repositoryRoot) {
  writeWorkflow(repositoryRoot, "ci.yml", VALID_CI_WORKFLOW);
  writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
}

// The two Knowledgebase steps the golden fixture carries, named so the
// mutation cases below cannot drift away from the fixture they mutate.
const KNOWLEDGE_SUITE_STEP =
  "      - env:\n" +
  "          KNOWLEDGE_TOKENIZER_PATH: ${{ runner.temp }}/knowledge-artifacts/tokenizer.json\n" +
  "        run: npm run test:knowledge\n";
const UV_SYNC_STEP =
  "      - working-directory: apps/knowledge\n        run: uv sync --locked\n";

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

const gateRegistryTable = (names) =>
  [
    "| Script | What it checks | Where it runs | NOT RUN condition |",
    "| --- | --- | --- | --- |",
    ...names.map((name) => `| \`${name}\` | d | w | n |`),
  ].join("\n");

test("the gate registry and the npm scripts must be the same set", () => {
  const scripts = { format: "prettier --write x", test: "node --test" };
  const packageJson = { scripts };

  assert.deepEqual(
    checkGateRegistry(packageJson, gateRegistryTable(["format", "test"])),
    [],
  );

  const missingRow = checkGateRegistry(
    packageJson,
    gateRegistryTable(["test"]),
  );
  assert.equal(missingRow.length, 1);
  assert.match(missingRow[0], /format/);

  const inventedRow = checkGateRegistry(
    packageJson,
    gateRegistryTable(["format", "test", "release"]),
  );
  assert.equal(inventedRow.length, 1);
  assert.match(inventedRow[0], /release/);
});

test("the shipped gate registry enumerates every shipped npm script", () => {
  const registry = readFileSync(
    path.join(REPO_ROOT, "docs", "development", "conventions.md"),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  assert.deepEqual(checkGateRegistry(packageJson, registry), []);
});

test("test:m8 and rehearse:r16 are required scripts, not undocumented ones", () => {
  const failures = checkCommandDefinitions(
    {
      scripts: {
        format: "prettier --write README.md",
        "format:check": "prettier --check README.md",
        lint: "eslint . && markdownlint-cli2",
        test: "node --test tests/a.test.mjs",
        "test:knowledge": "uv run pytest",
        "repo:check": "node scripts/repository-check.mjs",
        verify: "npm run format:check && npm run lint && npm test",
      },
    },
    "install:\n\tnpm ci\n",
  );
  assert.ok(
    failures.some((failure) => failure.includes("test:m8")),
    `expected a required-script failure for test:m8, got: ${failures.join(" | ")}`,
  );
  assert.ok(
    failures.some((failure) => failure.includes("rehearse:r16")),
    `expected a required-script failure for rehearse:r16, got: ${failures.join(" | ")}`,
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
        KNOWLEDGE_SUITE_STEP,
        KNOWLEDGE_SUITE_STEP.replace(
          "        run: npm run test:knowledge\n",
          "        run: npm run test:knowledge\n        continue-on-error: true\n",
        ),
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
      VALID_CI_WORKFLOW.replace(KNOWLEDGE_SUITE_STEP, ""),
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
        UV_SYNC_STEP,
        KNOWLEDGE_SUITE_STEP + UV_SYNC_STEP,
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
        "        run: uv sync --locked",
        "        run: uv sync --locked --directory pdf-runtime",
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
  const misplaced = VALID_CI_WORKFLOW.replace(KNOWLEDGE_SUITE_STEP, "").replace(
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

// ---------------------------------------------------------------------------
// The secret scan: every branch, and a retained report
// ---------------------------------------------------------------------------

test("the secret scan must run on a push to any branch and publish its report", () => {
  withTemporaryDirectory((repositoryRoot) => {
    // A push trigger narrowed to a branch list leaves every task branch
    // unscanned, so a credential committed to a branch reaches main through a
    // merge without any lane ever having looked at the branch.
    writeWorkflow(repositoryRoot, "ci.yml", VALID_CI_WORKFLOW);
    writeWorkflow(
      repositoryRoot,
      "security.yml",
      VALID_SECURITY_WORKFLOW.replace(
        "  push:\n",
        "  push:\n    branches: [main]\n",
      ),
    );
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) =>
        failure.includes("must run on a push to any branch"),
      ),
      `expected the narrowed push trigger to fail; got: ${failures.join(" | ")}`,
    );
  });

  withTemporaryDirectory((repositoryRoot) => {
    // Without the report artifact a "zero leaks" claim is a sentence in a
    // plan file, not something anybody can look at.
    writeWorkflow(repositoryRoot, "ci.yml", VALID_CI_WORKFLOW);
    writeWorkflow(
      repositoryRoot,
      "security.yml",
      VALID_SECURITY_WORKFLOW.replace(
        '          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "true"',
        '          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"',
      ),
    );
    const failures = checkWorkflowDefinitions(repositoryRoot);
    assert.ok(
      failures.some((failure) =>
        failure.includes("GITLEAKS_ENABLE_UPLOAD_ARTIFACT"),
      ),
      `expected the missing report artifact to fail; got: ${failures.join(" | ")}`,
    );
  });
});

test("the shipped security workflow scans every branch push and retains its report", () => {
  const shipped = readFileSync(
    path.join(REPO_ROOT, ".github", "workflows", "security.yml"),
    "utf8",
  );
  assert.match(
    shipped,
    /^ {2}push:\n(?! {4}branches:)/mu,
    "the secret scan must trigger on a push to any branch",
  );
  assert.match(
    shipped,
    /GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "true"/u,
    "the secret scan must publish a retained report artifact",
  );
});

// ---------------------------------------------------------------------------
// The Knowledgebase Python job: the toolchain and the pinned tokenizer
// ---------------------------------------------------------------------------

test("the python-quality job must keep the toolchain and the pinned tokenizer", () => {
  const pythonQualityBlock = VALID_CI_WORKFLOW.slice(
    VALID_CI_WORKFLOW.indexOf("  python-quality:"),
  );
  const mutations = [
    [
      '      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38\n        with:\n          node-version: "24.15.0"\n          package-manager-cache: false\n',
      "",
      "actions/setup-node",
    ],
    [
      "      - working-directory: ${{ runner.temp }}\n        run: npm install --global npm@12.0.2\n",
      "",
      "npm@12.0.2 bootstrap",
    ],
    [
      '      - run: |\n          test "$(node --version)" = "v24.15.0"\n          test "$(npm --version)" = "12.0.2"\n',
      "",
      "Node and npm versions",
    ],
    [
      '          echo "69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15  ${{ runner.temp }}/knowledge-artifacts/tokenizer.json" | sha256sum --check --strict\n',
      "",
      "pinned tokenizer",
    ],
    [
      "      - working-directory: apps/knowledge\n        run: uv sync --locked\n",
      "      - run: uv sync --locked\n",
      "working-directory apps/knowledge",
    ],
    [
      "          KNOWLEDGE_TOKENIZER_PATH: ${{ runner.temp }}/knowledge-artifacts/tokenizer.json\n",
      "",
      "KNOWLEDGE_TOKENIZER_PATH",
    ],
  ];

  for (const [from, to, expected] of mutations) {
    assert.ok(
      pythonQualityBlock.includes(from),
      `the golden fixture must carry: ${expected}`,
    );
    const mutatedBlock = pythonQualityBlock.replace(from, to);
    assert.notEqual(mutatedBlock, pythonQualityBlock, expected);
    const mutated = VALID_CI_WORKFLOW.replace(pythonQualityBlock, mutatedBlock);
    withTemporaryDirectory((repositoryRoot) => {
      writeWorkflow(repositoryRoot, "ci.yml", mutated);
      writeWorkflow(repositoryRoot, "security.yml", VALID_SECURITY_WORKFLOW);
      const failures = checkWorkflowDefinitions(repositoryRoot);
      assert.ok(
        failures.some((failure) => failure.includes(expected)),
        `dropping ${expected} must fail the policy check; got: ${failures.join(" | ")}`,
      );
    });
  }
});

test("the shipped CI workflow keeps the python-quality toolchain and tokenizer", () => {
  const shipped = readFileSync(
    path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  assert.match(shipped, /actions\/setup-node@249/u);
  assert.match(shipped, /npm install --global npm@12\.0\.2/u);
  assert.match(shipped, /sha256sum --check --strict/u);
  assert.match(shipped, /KNOWLEDGE_TOKENIZER_PATH/u);
  assert.match(shipped, /working-directory: apps\/knowledge/u);
});

// ---------------------------------------------------------------------------
// The findings register: tracked, well-shaped, and never cited by a dead path
// ---------------------------------------------------------------------------

const REGISTER_ROW = [
  "### F-001 — a row",
  "",
  "- Category: F1 — Logic & Functional Bugs",
  "- Legacy register id: `R1-A01-01`",
  "- Affected modules: something",
  "- Severity: Medium",
  "- Status: OPEN",
  "- Root cause: because.",
  "- Evidence: where.",
  "- Reproduction: how.",
  "- Acceptance criteria: what.",
  "- Related findings: none.",
  "",
].join("\n");

test("the findings register must carry the ten fields and a known status", () => {
  assert.deepEqual(checkFindingsRegister(REGISTER_ROW), []);

  const missingField = REGISTER_ROW.replace("- Root cause: because.\n", "");
  assert.ok(
    checkFindingsRegister(missingField).some((failure) =>
      failure.includes('"Root cause:"'),
    ),
  );

  const emptyField = REGISTER_ROW.replace("- Evidence: where.", "- Evidence:");
  assert.ok(
    checkFindingsRegister(emptyField).some((failure) =>
      failure.includes('empty "Evidence:"'),
    ),
  );

  const unknownStatus = REGISTER_ROW.replace(
    "- Status: OPEN",
    "- Status: DONE",
  );
  assert.ok(
    checkFindingsRegister(unknownStatus).some((failure) =>
      failure.includes("outside the register vocabulary"),
    ),
  );

  const eleventhField = REGISTER_ROW.replace(
    "- Related findings: none.",
    "- Related findings: none.\n- Writer: somebody",
  );
  assert.ok(
    checkFindingsRegister(eleventhField).some((failure) =>
      failure.includes("a field the register does not define"),
    ),
    "an eleventh field is a row that drifted from the register shape",
  );
});

test("the shipped findings register is well-shaped", () => {
  const register = readFileSync(
    path.join(REPO_ROOT, "docs", "execution", "findings.md"),
    "utf8",
  );
  assert.deepEqual(
    checkFindingsRegister(register),
    [],
    "every register row must carry the ten fields and a status from the register vocabulary",
  );
});

test("the findings register is tracked, so every row edit carries a commit", () => {
  assert.ok(
    listTrackedFiles(REPO_ROOT).includes("docs/execution/findings.md"),
    "an untracked register gives every row edit no commit, no author and no diff",
  );
});

test("a tracked document must not point at the retired register path alone", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "docs/plan.md",
      "The queue lives in .agents/states/findings.md.\n",
    );
    const failures = checkRegisterCitations(repositoryRoot, ["docs/plan.md"]);
    assert.equal(failures.length, 1, failures.join(" | "));
    assert.match(failures[0], /docs\/plan\.md/u);
  });

  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "docs/plan.md",
      "The queue moved: .agents/states/findings.md is now docs/execution/findings.md.\n",
    );
    assert.deepEqual(
      checkRegisterCitations(repositoryRoot, ["docs/plan.md"]),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// The secret-scan allowlist scope, and the generated trees under a module
// ---------------------------------------------------------------------------

test("the secret-scan allowlist may only suppress the recorded scopes", () => {
  const failures = checkSecretScanAllowlist(
    REPO_ROOT,
    listTrackedFiles(REPO_ROOT),
  );
  assert.deepEqual(failures, [], failures.join(" | "));
});

test("a tracked path outside every recorded scope must fail the policy check", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      ".gitleaks.toml",
      "[extend]\nuseDefault = true\n\n[allowlist]\npaths = [ '''secretive/.*''' ]\n",
    );
    writeTrackedFile(repositoryRoot, "secretive/token.txt", "value\n");
    const failures = checkSecretScanAllowlist(repositoryRoot, [
      "secretive/token.txt",
    ]);
    assert.equal(failures.length, 1, failures.join(" | "));
    assert.match(failures[0], /outside every recorded scope/u);
  });
});

test("a generated tree under a module path must not be stageable", () => {
  assert.deepEqual(
    checkNestedGeneratedTreesIgnored(REPO_ROOT),
    [],
    "a nested capture is a live-state snapshot that can carry credential-derived material",
  );
});

test("the trailing-whitespace gate defers to the editor-facing .editorconfig", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      ".editorconfig",
      "root = true\n\n[*.md]\ntrim_trailing_whitespace = false\n",
    );
    writeTrackedFile(repositoryRoot, "note.md", "a hard break  \n");
    assert.deepEqual(
      checkWorkingTreeTextPolicy(repositoryRoot, ["note.md"]),
      [],
      "Markdown hard breaks are legal per .editorconfig, and the gate must defer to it",
    );

    writeTrackedFile(repositoryRoot, "code.mjs", "const x = 1;   \n");
    assert.ok(
      checkWorkingTreeTextPolicy(repositoryRoot, ["code.mjs"]).some((failure) =>
        failure.includes("trailing whitespace"),
      ),
      "a file class the editorconfig does not exempt is still checked",
    );
  });
});

// =========================================================================
// M12/T9 F-223 — the operator scripts the runbook tells the owner to run
// lived outside every verify stage, and the repository advertised four script
// categories it does not ship.
//
// The coverage rule is that a script a doc or a runbook cites is READ by at
// least one file the `npm test` gate runs, and that the cited path exists.
// The second rule is that a `scripts/` category directory carries tracked
// content, so an empty advertised category cannot survive.
// =========================================================================
test("F-223: every script a document tells the operator to run is covered", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const failures = checkDocumentedScriptsAreCovered(
    REPO_ROOT,
    packageJson,
    listTrackedFiles(REPO_ROOT),
  );
  assert.deepEqual(failures, [], failures.join(" | "));
});

test("F-223: a cited script that no verify stage reads must fail the check", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "infrastructure/docker/scripts/backup.ps1",
      "Write-Output 'backup'\n",
    );
    writeTrackedFile(
      repositoryRoot,
      "docs/runbooks/knowledge-platform.md",
      "Run `infrastructure/docker/scripts/backup.ps1` first.\n",
    );
    const failures = checkDocumentedScriptsAreCovered(
      repositoryRoot,
      { scripts: { test: "node --test tests/a.test.mjs" } },
      [
        "infrastructure/docker/scripts/backup.ps1",
        "docs/runbooks/knowledge-platform.md",
      ],
    );
    assert.equal(failures.length, 1, failures.join(" | "));
    assert.match(failures[0], /no verify stage reads/u);
  });
});

test("F-223: a cited script that is not tracked must fail the check", () => {
  withTemporaryRepository((repositoryRoot) => {
    writeTrackedFile(
      repositoryRoot,
      "docs/runbooks/knowledge-platform.md",
      "Run `infrastructure/docker/scripts/phantom.ps1` first.\n",
    );
    const failures = checkDocumentedScriptsAreCovered(
      repositoryRoot,
      { scripts: { test: "node --test tests/a.test.mjs" } },
      ["docs/runbooks/knowledge-platform.md"],
    );
    assert.equal(failures.length, 1, failures.join(" | "));
    assert.match(failures[0], /not tracked/u);
  });
});

test("F-223: an empty scripts category directory must fail the check", () => {
  withTemporaryRepository((repositoryRoot) => {
    mkdirSync(path.join(repositoryRoot, "scripts", "verification"), {
      recursive: true,
    });
    const failures = checkNoEmptyScriptCategory(repositoryRoot, [
      "scripts/repository-check.mjs",
    ]);
    assert.equal(failures.length, 1, failures.join(" | "));
    assert.match(failures[0], /carries no tracked file/u);
  });
});

test("F-223: the shipped scripts tree carries no empty category", () => {
  assert.deepEqual(
    checkNoEmptyScriptCategory(REPO_ROOT, listTrackedFiles(REPO_ROOT)),
    [],
    "every advertised scripts/ category must carry tracked content",
  );
});

// =========================================================================
// M12/T9 F-138 — the Zink Tools provider adapters exceeded the declared
// tool-ownership set, and nothing compared the two.
//
// The canonical boundary document lists the adapters the package exports; this
// gate makes that list load-bearing, so an adapter that ships without being
// declared is caught here instead of in a review.
// =========================================================================
test("F-138: every shipped Zink Tools adapter is declared in the boundary document", () => {
  const boundaryPath = path.join(
    REPO_ROOT,
    "docs",
    "architecture",
    "zink-tools-boundaries.md",
  );
  const boundary = readFileSync(boundaryPath, "utf8").toLowerCase();
  const adaptersDir = path.join(REPO_ROOT, "zink-tools", "adapters");
  const declared = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith("-adapter.mjs")) {
        declared.push(entry.name.replace(/-adapter\.mjs$/u, ""));
      }
    }
  };
  walk(adaptersDir);
  assert.ok(declared.length > 0, "the package must export adapters");
  for (const name of declared) {
    assert.ok(
      boundary.includes(name.toLowerCase()),
      `the adapter "${name}" must be declared in docs/architecture/zink-tools-boundaries.md`,
    );
  }
});

// =========================================================================
// M12/T9 — the governance layer and the working tree.
//
// The cases below are controls the findings asked for and that no lane
// enforced yet. They read tracked files and the working tree, they never
// write, and a case that flags a file reports the PATH and never the bytes
// it found there.
// =========================================================================

// ---------------------------------------------------------------------------
// F-038 — a credential literal in a repository-adjacent file
//
// A credential pasted into a script is a credential in source position: it
// reaches every reader of the file, every `git add -A` of a directory that
// happens to be ignored today, and every clone of a tree the script was
// copied into. The shapes below are the Discord token and webhook forms.
// ---------------------------------------------------------------------------
const CREDENTIAL_LITERAL_SHAPES = [
  {
    name: "discord bot token",
    pattern: /[0-9]{17,20}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{25,}/u,
  },
  {
    name: "discord webhook url",
    pattern: /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]{25,}/u,
  },
];

// Directories that carry no authored source: a credential literal cannot live
// in a compiled artefact, and walking a virtualenv on every gate run costs
// minutes for nothing.
const CREDENTIAL_SCAN_SKIP_DIRECTORIES = new Set([
  ".git",
  ".venv",
  "__pycache__",
  "node_modules",
]);

const CREDENTIAL_SCAN_MAX_BYTES = 2 * 1024 * 1024;

function collectCredentialLiteralFiles(files) {
  const hits = [];
  for (const filePath of files) {
    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > CREDENTIAL_SCAN_MAX_BYTES) continue;
    let contents;
    try {
      contents = readFileSync(filePath);
    } catch {
      continue;
    }
    // A NUL byte means the file is not text; the shapes cannot appear in it.
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const shape of CREDENTIAL_LITERAL_SHAPES) {
      if (shape.pattern.test(text)) {
        hits.push(`${path.relative(REPO_ROOT, filePath)} (${shape.name})`);
        break;
      }
    }
  }
  return hits;
}

function collectScannedFiles(rootDirectory) {
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (CREDENTIAL_SCAN_SKIP_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(rootDirectory);
  return files;
}

test("F-038: no credential literal exists in any tracked file", () => {
  const tracked = listTrackedFiles(REPO_ROOT).map((relativePath) =>
    path.join(REPO_ROOT, relativePath),
  );
  const hits = collectCredentialLiteralFiles(tracked);
  assert.deepEqual(
    hits,
    [],
    `a credential literal in source position is reachable by every reader of the file; remove it and rotate the credential: ${hits.join(", ")}`,
  );
});

test("F-038: no credential literal exists in the local scratch directory", () => {
  const scratch = path.join(REPO_ROOT, "scratch");
  if (!existsSync(scratch)) {
    return;
  }
  const hits = collectCredentialLiteralFiles(collectScannedFiles(scratch));
  assert.deepEqual(
    hits,
    [],
    `the scratch directory is repository-adjacent: a credential literal there is one ` +
      `forced add away from history. Remove it and rotate the credential: ${hits.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// F-137 — an ownerless top-level tree that duplicates a Zink Tools capability
//
// `models/forecast`, `models/optimization`, ... are the Zink Tools capability
// paths under a different root. A tree an agent can write into and that no
// canonical document owns is a surface with no contract behind it.
// ---------------------------------------------------------------------------
const LOCAL_WORKING_AREAS = new Set([
  ".git",
  ".tmp",
  "node_modules",
  "scratch",
]);

test("F-137: no ownerless top-level tree duplicates a Zink Tools capability name", () => {
  const capabilityNames = new Set(
    readdirSync(path.join(REPO_ROOT, "zink-tools"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  assert.ok(
    capabilityNames.size > 0,
    "zink-tools must publish its capability paths",
  );

  const tracked = listTrackedFiles(REPO_ROOT);
  const offenders = [];
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (LOCAL_WORKING_AREAS.has(entry.name)) continue;
    const relative = `${entry.name}/`;
    const carriesTrackedContent = tracked.some((file) =>
      file.startsWith(relative),
    );
    if (carriesTrackedContent) continue;
    const children = readdirSync(path.join(REPO_ROOT, entry.name), {
      withFileTypes: true,
    })
      .filter((child) => child.isDirectory())
      .map((child) => child.name);
    const duplicates = [
      ...(capabilityNames.has(entry.name) ? [entry.name] : []),
      ...children.filter((child) => capabilityNames.has(child)),
    ];
    if (duplicates.length > 0) {
      offenders.push(
        `${entry.name}/ duplicates the Zink Tools capability path(s) ${duplicates.join(", ")} and no canonical document owns it`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `an ownerless top-level tree that duplicates a capability path is a surface with no contract behind it: ${offenders.join("; ")}`,
  );
});

// ---------------------------------------------------------------------------
// F-344 — an archive-cited legacy id that resolves to nothing
//
// The register keeps a `Legacy register id` so a row can be traced back to
// the plan and the archived contracts. The other direction — an id an
// archived contract cites, resolved against the live rows and the closure
// table — is what keeps a closed row from drifting away from the record.
// ---------------------------------------------------------------------------
const LEGACY_REGISTER_ID = /R[0-9]+-[A-Z0-9]+-[0-9]+/gu;

function registerLegacyIds(register) {
  const ids = new Set();
  for (const match of register.matchAll(
    /^- Legacy register id:[ ]*`?([^`\n]+)`?/gmu,
  )) {
    for (const id of match[1].match(LEGACY_REGISTER_ID) ?? []) ids.add(id);
  }
  return ids;
}

function registerClosureIds(register) {
  const section = register.split(/^## 2\./mu)[1] ?? "";
  const ids = new Set();
  for (const match of section.matchAll(/^\|\s*`([^`]+)`/gmu)) {
    for (const id of match[1].match(LEGACY_REGISTER_ID) ?? []) ids.add(id);
  }
  return ids;
}

test("F-344: every legacy id an archived contract cites resolves to a register row, a closure entry, or a PLAN.md anchor", () => {
  const register = readFileSync(
    path.join(REPO_ROOT, "docs", "execution", "findings.md"),
    "utf8",
  );
  const plan = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
  const live = registerLegacyIds(register);
  const closed = registerClosureIds(register);
  const archiveDirectory = path.join(
    REPO_ROOT,
    "docs",
    "contracts",
    "execution",
    "archive",
  );
  assert.ok(
    existsSync(archiveDirectory),
    "the execution-contract archive must exist",
  );

  const dangling = [];
  for (const name of readdirSync(archiveDirectory)) {
    if (!name.endsWith(".md")) continue;
    const contents = readFileSync(path.join(archiveDirectory, name), "utf8");
    for (const id of new Set(contents.match(LEGACY_REGISTER_ID) ?? [])) {
      if (live.has(id) || closed.has(id) || plan.includes(id)) continue;
      dangling.push(
        `${id} (cited by docs/contracts/execution/archive/${name})`,
      );
    }
  }
  assert.deepEqual(
    dangling,
    [],
    `an archived contract cites a legacy id that resolves to no register row, no closure entry and no PLAN.md anchor: ${dangling.join(", ")}`,
  );
});

test("F-344: the register states the direction its traceability promise actually holds", () => {
  const register = readFileSync(
    path.join(REPO_ROOT, "docs", "execution", "findings.md"),
    "utf8",
  );
  const section1 = register.split(/^## 1\./mu)[1]?.split(/^## 2\./mu)[0] ?? "";
  assert.match(
    section1,
    /Legacy register id/u,
    "section 1 must state which field carries the legacy id",
  );
  assert.match(
    section1,
    /PLAN\.md/u,
    "section 1 must name the durable records a row is traced back through",
  );
});

// ---------------------------------------------------------------------------
// F-348 — the execution contract may only be deleted after it is archived
//
// `docs/contracts/execution/README.md` requires the contract to be copied
// into `archive/` before the live file is deleted: the archived copy is the
// only durable record of what was authorized. Nothing could notice a
// delete-before-archive because the deleted file is Git-ignored.
// ---------------------------------------------------------------------------
function planRevisionOf(text) {
  return /Plan Revision:[ ]*([A-Za-z0-9./-]+)/u.exec(text)?.[1] ?? null;
}

test("F-348: a deleted execution contract must have an archived copy of its Plan Revision", () => {
  const plan = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
  const liveContract = path.join(
    REPO_ROOT,
    "docs",
    "contracts",
    "execution",
    "ACTIVE.md",
  );
  const archiveDirectory = path.join(
    REPO_ROOT,
    "docs",
    "contracts",
    "execution",
    "archive",
  );
  const archived = existsSync(archiveDirectory)
    ? readdirSync(archiveDirectory).filter((name) => name.endsWith(".md"))
    : [];

  if (existsSync(liveContract)) {
    // The contract is live; its deletion is a future event and the archive
    // rule applies to that event.
    assert.ok(
      archived.length > 0,
      "the execution-contract archive must hold the contracts already closed",
    );
    return;
  }

  const revision = planRevisionOf(plan);
  assert.ok(
    revision,
    "PLAN.md must name the Plan Revision so the archived contract can be located",
  );
  const taskId = revision.split(/-R\d+$/u)[0];
  const archivedTaskId = taskId.replaceAll("/", "-");
  assert.ok(
    archived.some((name) => name.includes(archivedTaskId)),
    `the execution contract of Plan Revision ${revision} was deleted without an archived copy under docs/contracts/execution/archive/`,
  );
});

// ---------------------------------------------------------------------------
// F-353 — the nested `AGENTS.md` layer is conditional
//
// The bootstrap order tells every agent to read the nearest applicable
// nested `AGENTS.md`. The repository has never contained one, so the step
// is only safe while it stays conditional: an unconditional instruction
// would make every cold start look for a file that cannot be found.
// ---------------------------------------------------------------------------
test("F-353: the nested AGENTS.md bootstrap step is conditional", () => {
  const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
  assert.match(
    agents,
    /nearest[^\n]*applicable[^\n]*nested[^\n]*AGENTS\.md/iu,
    "the bootstrap step must state that the nested AGENTS.md layer applies only where one exists",
  );
});

// ---------------------------------------------------------------------------
// F-089 — the authorization header an agent must resolve is near the top
//
// `PLAN.md` is read whole before any write, and it is far larger than one
// read pass. The fields an authorization check needs must therefore be
// reachable without reading the whole file: the header may not sink below
// the first read pass, or a cold start resolves it from a partial read.
// ---------------------------------------------------------------------------
test("F-089: the PLAN.md authorization header is reachable in one bounded read", () => {
  const lines = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8").split(
    "\n",
  );
  const headerFields = [
    "Milestone:",
    "Task:",
    "Plan Revision:",
    "Planning Readiness:",
    "Execution Authorization:",
    "Execution Contract:",
  ];

  // The header may live in the dedicated "## Active task" section or in the
  // front of the file; what must not happen is that the six fields are
  // spread so far apart that no single read resolves the authorization.
  const sectionStarts = lines
    .map((line, index) => (/^## Active task\b/u.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const regions = [];
  if (sectionStarts.length > 0) {
    const start = sectionStarts[sectionStarts.length - 1];
    const end = lines.findIndex(
      (line, index) => index > start && /^## /u.test(line),
    );
    regions.push({
      name: "## Active task section",
      lines: lines.slice(start, end < 0 ? undefined : end),
    });
  }
  regions.push({ name: "first read pass", lines: lines.slice(0, 2000) });

  const missing = [];
  for (const field of headerFields) {
    const found = regions.some((region) =>
      region.lines.some((line) => line.startsWith(field)),
    );
    if (!found) missing.push(field);
  }
  assert.deepEqual(
    missing,
    [],
    `the authorization header must be resolvable from one bounded read: ${missing.join(", ")}`,
  );
});
