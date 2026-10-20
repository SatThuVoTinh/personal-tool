import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

import { AUDIT_BASELINE_PATH, readAuditBaseline } from "./audit-baseline.mjs";

const REQUIRED_FILES = [
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "README.md",
  "PLAN.md",
  "CHANGELOG.md",
  "package.json",
  "Makefile",
];

const REQUIRED_SCRIPTS = [
  "format",
  "format:check",
  "lint",
  "test",
  "test:knowledge",
  "test:m8",
  "rehearse:r16",
  "repo:check",
  "verify",
];

// `npm run verify` is the fail-fast Node-tier quality gate: static checks first, then
// the JavaScript suite, then repository policy validation. The stage order is part of
// the contract and a missing stage must fail the policy check rather than silently
// shrink the gate, which is why this is a fixed sequence instead of a loose membership
// test.
//
// The Knowledgebase Python suite is deliberately NOT a `verify` stage. It is a separate
// blocking gate with exactly one executor per environment: `CI / python-quality` in CI
// (enforced below, by checkCiWorkflow), and `npm run test:knowledge` / `make
// test-knowledge` on a host. Folding it into `verify` would make one command depend on
// the Python toolchain in every job that runs `verify`, including the ones that
// provision only Node.
const REQUIRED_VERIFY_STAGES = [
  "npm run format:check",
  "npm run lint",
  "npm test",
  "npm run repo:check",
];

const MAKE_TARGETS = {
  install: "npm ci",
  format: "npm run format",
  "format-check": "npm run format:check",
  lint: "npm run lint",
  test: "npm test",
  "test-knowledge": "npm run test:knowledge",
  "repo-check": "npm run repo:check",
  verify: "npm run verify",
};

// The findings register is the one queue every remediation band reads. It is
// tracked, so every row edit carries a commit, an author and a diff.
const FINDINGS_REGISTER_PATH = "docs/execution/findings.md";
// The register moved out of the Git-ignored states tree on 2026-10-17. A
// tracked file that still cites the retired path without naming the current
// one sends a reader to a file that does not exist.
const RETIRED_REGISTER_PATH = ".agents/states/findings.md";
const CURRENT_REGISTER_PATH = "docs/execution/findings.md";
// The ten fields every register row carries (findings.md 0.1) and the status
// vocabulary of 0.3.
const FINDINGS_REGISTER_FIELDS = [
  "Category",
  "Legacy register id",
  "Affected modules",
  "Severity",
  "Status",
  "Root cause",
  "Evidence",
  "Reproduction",
  "Acceptance criteria",
  "Related findings",
];
const FINDINGS_STATUS_VOCABULARY = new Set([
  "OPEN",
  "LATENT",
  "HYPOTHESIS",
  "PARTIAL",
  "BLOCKED",
  "EXCLUDED",
  "REFUTED",
]);
// The secret-scan allowlist suppresses whole directories. These are the
// recorded scopes: a tracked path outside them that the allowlist regexes
// suppress is a scope that grew without a record, and the total is capped.
const SECRET_SCAN_ALLOWED_SCOPES = [
  "tests/",
  "apps/knowledge/tests/",
  "apps/knowledge/pdf-runtime/tests/",
  // The one file the allowlist names by path rather than by scope.
  "integrations/openclaw/orchestration/README.md",
];
const SECRET_SCAN_SUPPRESSED_CEILING = 200;

// The workflow step that compares the live audit with the recorded baseline.
const AUDIT_BASELINE_SCRIPT = "scripts/audit-baseline.mjs";

const WORKFLOW_PATHS = {
  ci: ".github/workflows/ci.yml",
  security: ".github/workflows/security.yml",
};

const ACTIONS = {
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  setupPython: "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
  gitleaks: "gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
};

const FULL_ACTION_SHA = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatWorkflowFailure(workflowPath, message) {
  return `Workflow contract failed (${workflowPath}): ${message}`;
}

function workflowSteps(workflowPath, workflow, jobName, failures) {
  const job = workflow.jobs?.[jobName];
  if (!isObject(job)) {
    failures.push(
      formatWorkflowFailure(workflowPath, `missing job ${jobName}.`),
    );
    return [];
  }
  if (!Array.isArray(job.steps)) {
    failures.push(
      formatWorkflowFailure(workflowPath, `job ${jobName} must define steps.`),
    );
    return [];
  }
  return job.steps;
}

function runStepIndex(steps, command) {
  return steps.findIndex(
    (step) =>
      isObject(step) &&
      typeof step.run === "string" &&
      step.run.trim() === command,
  );
}

function toolchainAssertionIndex(steps) {
  return steps.findIndex(
    (step) =>
      isObject(step) &&
      typeof step.run === "string" &&
      step.run.includes('test "$(node --version)" = "v24.15.0"') &&
      step.run.includes('test "$(npm --version)" = "12.0.2"'),
  );
}

function actionStepIndex(steps, action) {
  return steps.findIndex((step) => isObject(step) && step.uses === action);
}

function checkOrderedStepIndexes(workflowPath, jobName, indexes, failures) {
  const entries = Object.entries(indexes);
  for (const [name, index] of entries) {
    if (index < 0) {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          `job ${jobName} must contain executable ${name}.`,
        ),
      );
    }
  }

  const presentIndexes = entries.map(([, index]) => index);
  if (presentIndexes.every((index) => index >= 0)) {
    for (let index = 1; index < presentIndexes.length; index += 1) {
      if (presentIndexes[index - 1] >= presentIndexes[index]) {
        failures.push(
          formatWorkflowFailure(
            workflowPath,
            `job ${jobName} commands must appear in the required order.`,
          ),
        );
        return;
      }
    }
  }
}

function checkSetupNodeStep(workflowPath, jobName, steps, failures) {
  const index = actionStepIndex(steps, ACTIONS.setupNode);
  if (index < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} must use pinned actions/setup-node.`,
      ),
    );
    return index;
  }

  const setupStep = steps[index];
  if (setupStep.with?.["node-version"] !== "24.15.0") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} setup-node must set node-version to 24.15.0.`,
      ),
    );
  }
  if (setupStep.with?.["package-manager-cache"] !== false) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} setup-node must set package-manager-cache to false.`,
      ),
    );
  }
  return index;
}

function checkCheckoutStep(
  workflowPath,
  jobName,
  steps,
  failures,
  options = {},
) {
  const index = actionStepIndex(steps, ACTIONS.checkout);
  if (index < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} must use pinned actions/checkout.`,
      ),
    );
    return index;
  }

  const checkoutStep = steps[index];
  if (checkoutStep.with?.["persist-credentials"] !== false) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} checkout must set persist-credentials to false.`,
      ),
    );
  }
  if (options.fullHistory && checkoutStep.with?.["fetch-depth"] !== 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} checkout must set fetch-depth to 0.`,
      ),
    );
  }
  return index;
}

function checkToolchainWorkflowJob(
  workflowPath,
  jobName,
  steps,
  finalCommand,
  failures,
) {
  const checkoutIndex = checkCheckoutStep(
    workflowPath,
    jobName,
    steps,
    failures,
  );
  const setupNodeIndex = checkSetupNodeStep(
    workflowPath,
    jobName,
    steps,
    failures,
  );
  const bootstrapIndex = runStepIndex(steps, "npm install --global npm@12.0.2");
  const assertionIndex = toolchainAssertionIndex(steps);
  const finalCommandIndex = runStepIndex(steps, finalCommand);

  if (
    bootstrapIndex >= 0 &&
    steps[bootstrapIndex]["working-directory"] !== "${{ runner.temp }}"
  ) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${jobName} npm bootstrap must run from \${{ runner.temp }}.`,
      ),
    );
  }

  checkOrderedStepIndexes(
    workflowPath,
    jobName,
    {
      "checkout action": checkoutIndex,
      "setup-node action": setupNodeIndex,
      "npm bootstrap": bootstrapIndex,
      "Node/npm version assertions": assertionIndex,
      [`command \`${finalCommand}\``]: finalCommandIndex,
    },
    failures,
  );
}

function checkWorkflowTriggers(
  workflowPath,
  workflow,
  securityWorkflow,
  failures,
) {
  const pullRequest = workflow.on?.pull_request;
  const push = workflow.on?.push;
  const pullRequestBranches = pullRequest?.branches;
  const pushBranches = push?.branches;
  const hasMainPullRequest =
    Array.isArray(pullRequestBranches) && pullRequestBranches.includes("main");
  // An unfiltered push trigger covers every branch, main included, so it
  // satisfies the "push for main" requirement without naming main.
  const hasMainPush =
    push !== undefined &&
    (pushBranches === undefined ||
      (Array.isArray(pushBranches) && pushBranches.includes("main")));

  if (
    !hasMainPullRequest ||
    !hasMainPush ||
    !("workflow_dispatch" in (workflow.on ?? {}))
  ) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "must trigger pull_request and push for main plus workflow_dispatch.",
      ),
    );
  }

  // The secret scan is the only lane that can see a credential committed to a
  // task branch. Scoping its push trigger to `main` left every branch push
  // unscanned, so a credential could reach main through a merge without any
  // lane ever having looked at the branch. The scan must therefore run for a
  // push to ANY branch, not only to the default one.
  if (securityWorkflow && push && Array.isArray(pushBranches)) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "the secret scan must run on a push to any branch, so the push trigger must not be narrowed to a branch list.",
      ),
    );
  }

  if (
    securityWorkflow &&
    !workflow.on?.schedule?.some((entry) => entry?.cron === "0 2 * * 1")
  ) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        'must include the schedule cron "0 2 * * 1".',
      ),
    );
  }
}

function checkActionPins(workflowPath, workflow, failures) {
  if (!isObject(workflow.jobs)) {
    return;
  }
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!Array.isArray(job?.steps)) {
      continue;
    }
    for (const step of job.steps) {
      if (
        isObject(step) &&
        typeof step.uses === "string" &&
        !step.uses.startsWith("./") &&
        !FULL_ACTION_SHA.test(step.uses)
      ) {
        failures.push(
          formatWorkflowFailure(
            workflowPath,
            `job ${jobName} external action must be pinned with a full 40-character SHA: ${step.uses}.`,
          ),
        );
      }
    }
  }
}

function checkWorkflowRoot(workflowPath, workflow, securityWorkflow, failures) {
  if (workflow.permissions?.contents !== "read") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "root permissions.contents must be read.",
      ),
    );
  }
  if (securityWorkflow && workflow.permissions?.["pull-requests"] !== "read") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "root permissions.pull-requests must be read for Gitleaks PR scans.",
      ),
    );
  }
  checkWorkflowTriggers(workflowPath, workflow, securityWorkflow, failures);
  checkActionPins(workflowPath, workflow, failures);
}

function checkCiWorkflow(workflowPath, workflow, failures) {
  checkWorkflowRoot(workflowPath, workflow, false, failures);
  const steps = workflowSteps(workflowPath, workflow, "quality-gate", failures);
  checkToolchainWorkflowJob(
    workflowPath,
    "quality-gate",
    steps,
    "npm ci",
    failures,
  );

  const npmCiIndex = runStepIndex(steps, "npm ci");
  const verifyIndex = runStepIndex(steps, "npm run verify");
  checkOrderedStepIndexes(
    workflowPath,
    "quality-gate",
    {
      "command `npm ci`": npmCiIndex,
      "command `npm run verify`": verifyIndex,
    },
    failures,
  );

  checkPythonQualityJob(workflowPath, workflow, failures);
  checkKnowledgebaseSuiteSingleOwner(workflowPath, workflow, failures);
}

// The Knowledgebase Python suite is a blocking gate with exactly one CI executor. It
// used to also be a `verify` stage, which made every job that runs `verify` depend on
// the Python toolchain — `CI / quality-gate` proved that unrunnable (it provisions
// Node only, so the stage died at `uv: not found`). Requiring one named executor keeps
// the suite from silently disappearing while the aggregate stays Node-only, and
// rejects both a duplicated suite and a workflow that dropped it entirely.
function checkKnowledgebaseSuiteSingleOwner(workflowPath, workflow, failures) {
  const jobs = isObject(workflow.jobs) ? workflow.jobs : {};
  const executors = [];
  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = isObject(job) && Array.isArray(job.steps) ? job.steps : [];
    if (runStepIndex(steps, "npm run test:knowledge") >= 0) {
      executors.push(jobName);
    }
  }
  if (executors.length !== 1 || executors[0] !== PYTHON_QUALITY_JOB) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `command \`npm run test:knowledge\` must be executed exactly once, by job ${PYTHON_QUALITY_JOB}.`,
      ),
    );
  }
}

const PYTHON_QUALITY_JOB = "python-quality";

// The Knowledgebase Python suite is a blocking gate, so the policy refuses to
// accept a CI workflow where that job is absent, non-blocking, or no longer
// runs the suite. Without this, deleting the job would silently return the
// Python tier to unverified.
function checkPythonQualityJob(workflowPath, workflow, failures) {
  const steps = workflowSteps(
    workflowPath,
    workflow,
    PYTHON_QUALITY_JOB,
    failures,
  );

  if (!steps.length) {
    return;
  }

  const job = workflow.jobs?.[PYTHON_QUALITY_JOB];
  if (job?.["continue-on-error"] === true) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must block on failure.`,
      ),
    );
  }

  if (actionStepIndex(steps, ACTIONS.setupPython) < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must use pinned actions/setup-python.`,
      ),
    );
  }

  // The suite is invoked through `npm run test:knowledge`, and package.json
  // pins devEngines.runtime to node >=24.15.0 <25 with onFail=error, so a job
  // that loses the Node toolchain makes npm abort before pytest collects
  // anything — the gate would report a pass it never earned. The pinned
  // tokenizer fetch and its checksum are the same kind of dependency: seven
  // Knowledgebase modules skip at import when KNOWLEDGE_TOKENIZER_PATH is
  // unset, so losing the fetch turns the attribution gates into skips.
  if (actionStepIndex(steps, ACTIONS.setupNode) < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must use pinned actions/setup-node, because the suite is invoked through npm and package.json pins the Node runtime.`,
      ),
    );
  }
  if (runStepIndex(steps, "npm install --global npm@12.0.2") < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must install the pinned npm@12.0.2 bootstrap.`,
      ),
    );
  }
  if (toolchainAssertionIndex(steps) < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must assert the Node and npm versions.`,
      ),
    );
  }
  const tokenizerIndex = steps.findIndex(
    (step) =>
      isObject(step) &&
      typeof step.run === "string" &&
      /sha256sum --check --strict/u.test(step.run),
  );
  if (tokenizerIndex < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must fetch the pinned tokenizer and verify it with sha256sum --check --strict.`,
      ),
    );
  }
  const suiteStep = steps.find(
    (step) => runStepIndex([step], "npm run test:knowledge") >= 0,
  );
  if (!suiteStep || suiteStep.env?.KNOWLEDGE_TOKENIZER_PATH === undefined) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must set KNOWLEDGE_TOKENIZER_PATH on the suite step, or the Knowledgebase attribution gates skip at import.`,
      ),
    );
  }
  const syncStep = steps.find(
    (step) => runStepIndex([step], "uv sync --locked") >= 0,
  );
  if (!syncStep || syncStep["working-directory"] !== "apps/knowledge") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job ${PYTHON_QUALITY_JOB} must run uv sync --locked in working-directory apps/knowledge.`,
      ),
    );
  }

  const syncIndex = runStepIndex(steps, "uv sync --locked");
  const suiteIndex = runStepIndex(steps, "npm run test:knowledge");
  checkOrderedStepIndexes(
    workflowPath,
    PYTHON_QUALITY_JOB,
    {
      "command `uv sync --locked`": syncIndex,
      "command `npm run test:knowledge`": suiteIndex,
    },
    failures,
  );

  // pdf-runtime is Linux/x86_64-only and pulls the torch/docling stack. It must
  // stay an explicit NOT RUN in CI rather than being installed here or implied.
  for (const step of steps) {
    if (!isObject(step)) {
      continue;
    }
    if (typeof step.run === "string") {
      if (
        step.run.includes("pdf-runtime") ||
        step.run.includes("zink_pdf_runtime")
      ) {
        failures.push(
          formatWorkflowFailure(
            workflowPath,
            `job ${PYTHON_QUALITY_JOB} must not install the pdf-runtime closure.`,
          ),
        );
      }
      // A step-level override would silently downgrade the gate to advisory
      // even though the job itself still fails on a red suite.
      if (
        step.run.trim() === "npm run test:knowledge" &&
        step["continue-on-error"] === true
      ) {
        failures.push(
          formatWorkflowFailure(
            workflowPath,
            `job ${PYTHON_QUALITY_JOB} must block on failure.`,
          ),
        );
      }
    }
    if (
      step.uses === ACTIONS.setupPython &&
      step["continue-on-error"] === true
    ) {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          `job ${PYTHON_QUALITY_JOB} must block on failure.`,
        ),
      );
    }
  }
}

function checkSecurityWorkflow(workflowPath, workflow, failures) {
  checkWorkflowRoot(workflowPath, workflow, true, failures);
  const auditSteps = workflowSteps(
    workflowPath,
    workflow,
    "dependency-audit",
    failures,
  );
  checkToolchainWorkflowJob(
    workflowPath,
    "dependency-audit",
    auditSteps,
    "npm audit --audit-level=high",
    failures,
  );

  const secretScanSteps = workflowSteps(
    workflowPath,
    workflow,
    "secret-scan",
    failures,
  );
  const checkoutIndex = checkCheckoutStep(
    workflowPath,
    "secret-scan",
    secretScanSteps,
    failures,
    { fullHistory: true },
  );
  const gitleaksIndex = actionStepIndex(secretScanSteps, ACTIONS.gitleaks);
  if (gitleaksIndex < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan must use pinned gitleaks/gitleaks-action.",
      ),
    );
    return;
  }

  if (checkoutIndex >= gitleaksIndex) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan checkout must run before Gitleaks.",
      ),
    );
  }

  const gitleaksStep = secretScanSteps[gitleaksIndex];
  const environment = gitleaksStep.env;
  if (environment?.GITHUB_TOKEN !== "${{ github.token }}") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan Gitleaks must pass GITHUB_TOKEN from github.token.",
      ),
    );
  }
  if (environment?.GITLEAKS_ENABLE_COMMENTS !== "false") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan Gitleaks must set GITLEAKS_ENABLE_COMMENTS to the string false.",
      ),
    );
  }
  // The report artifact is what makes a "zero leaks" claim re-inspectable
  // instead of a sentence in a plan file: without it, nobody can look at what
  // the scan actually found.
  if (environment?.GITLEAKS_ENABLE_UPLOAD_ARTIFACT !== "true") {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan Gitleaks must set GITLEAKS_ENABLE_UPLOAD_ARTIFACT to the string true so the scan report is a retained artifact.",
      ),
    );
  }
  if (Object.hasOwn(environment ?? {}, "GITLEAKS_LICENSE")) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job secret-scan must not declare GITLEAKS_LICENSE.",
      ),
    );
  }
}

export function checkWorkflowDefinitions(repositoryRoot) {
  const failures = [];
  for (const [name, workflowPath] of Object.entries(WORKFLOW_PATHS)) {
    const filePath = path.join(repositoryRoot, workflowPath);
    if (!existsSync(filePath)) {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          "required workflow file is missing.",
        ),
      );
      continue;
    }

    const document = parseDocument(readFileSync(filePath, "utf8"), {
      uniqueKeys: true,
      version: "1.2",
    });
    if (document.errors.length > 0) {
      for (const error of document.errors) {
        failures.push(
          formatWorkflowFailure(
            workflowPath,
            `YAML is invalid: ${error.message}`,
          ),
        );
      }
      continue;
    }

    const workflow = document.toJS();
    if (!isObject(workflow)) {
      failures.push(
        formatWorkflowFailure(workflowPath, "root must be a mapping."),
      );
      continue;
    }
    if (name === "ci") {
      checkCiWorkflow(workflowPath, workflow, failures);
    } else {
      checkSecurityWorkflow(workflowPath, workflow, failures);
    }
  }
  return failures;
}

function normalizedPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function isAllowedSensitiveFixture(filePath) {
  return normalizedPath(filePath).startsWith(
    "tests/fixtures/repository-policy/allowed/",
  );
}

function isAllowedSensitiveTemplate(filePath) {
  const name = path.posix.basename(normalizedPath(filePath)).toLowerCase();
  return (
    name === ".env.example" ||
    name === ".env.template" ||
    name.includes(".example.") ||
    name.includes(".template.")
  );
}

function isSensitivePath(filePath) {
  const name = path.posix.basename(normalizedPath(filePath)).toLowerCase();
  return (
    name === ".env" ||
    /^credentials[^/]*\.json$/.test(name) ||
    /\.license$/.test(name) ||
    /\.(key|pem|p12|pfx)$/.test(name)
  );
}

export function checkTrackedFilePolicies(trackedFiles) {
  return trackedFiles
    .filter(isSensitivePath)
    .filter(
      (filePath) =>
        !isAllowedSensitiveFixture(filePath) &&
        !isAllowedSensitiveTemplate(filePath),
    )
    .map(
      (filePath) => `Tracked sensitive file is not allowlisted: ${filePath}`,
    );
}

function resolveTrackedPath(repositoryRoot, repositoryPath) {
  const root = path.resolve(repositoryRoot);
  const filePath = path.resolve(root, repositoryPath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Tracked path escapes repository root: ${repositoryPath}`);
  }
  return filePath;
}

export function checkWorkingTreeTextPolicy(
  repositoryRoot,
  trackedFiles,
  editorConfig = readEditorConfig(repositoryRoot),
) {
  const failures = [];

  for (const repositoryPath of trackedFiles) {
    const filePath = resolveTrackedPath(repositoryRoot, repositoryPath);
    if (!existsSync(filePath)) {
      // Git owns deletion state. This check validates bytes that still exist in
      // the working tree and must not prevent an intentional tracked deletion.
      continue;
    }

    const contents = readFileSync(filePath);
    if (contents.includes(0)) {
      continue;
    }

    if (contents.includes(13)) {
      failures.push(
        `Working-tree file uses CR line endings: ${repositoryPath}`,
      );
    }

    // The editor-facing `.editorconfig` owns the trailing-whitespace rule
    // for each file class and this gate defers to it. The two used to state
    // opposite requirements for Markdown — `.editorconfig` declares a hard
    // break legal, this gate rejected the same bytes — so which rule won
    // depended on which surface the operator touched last.
    if (editorConfig.trimsTrailingWhitespace(repositoryPath)) {
      const lines = contents.toString("utf8").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (/[ \t]+\r?$/.test(lines[index])) {
          failures.push(
            `Working-tree file has trailing whitespace: ${repositoryPath}:${index + 1}`,
          );
        }
      }
    }
  }

  return failures;
}

/**
 * The findings register is a machine-checked queue, not prose: every row
 * carries the ten fields findings.md 0.1 defines and a status from the 0.3
 * vocabulary. A row that drifts from that shape is a row no agent can read
 * the same way, and the register had no executable reader at all.
 */
export function checkFindingsRegister(markdown) {
  const failures = [];
  const blocks = String(markdown ?? "")
    .split(/^### /mu)
    .slice(1);
  if (!blocks.length) {
    return ["The findings register carries no `### F-xxx` row block."];
  }

  for (const block of blocks) {
    const header = block.split("\n", 1)[0].trim();
    const id = /^F-\d+/u.exec(header)?.[0] ?? header;
    for (const field of FINDINGS_REGISTER_FIELDS) {
      const match = new RegExp(`^- ${field}:[ ]*(.*)$`, "mu").exec(block);
      if (!match) {
        failures.push(`Register row ${id} is missing the "${field}:" field.`);
        continue;
      }
      if (field !== "Status" && match[1].trim().length === 0) {
        failures.push(`Register row ${id} has an empty "${field}:" field.`);
      }
    }
    // A row that carries a field the register does not define has drifted from
    // the ten-field shape, and a reader cannot tell which field is the
    // authoritative one. An eleventh field is a failure, not a new fact.
    for (const match of block.matchAll(/^- ([A-Za-z][A-Za-z ]*):/gmu)) {
      if (!FINDINGS_REGISTER_FIELDS.includes(match[1].trim())) {
        failures.push(
          `Register row ${id} carries a field the register does not define: "${match[1].trim()}".`,
        );
      }
    }
    const status = /^- Status:[ ]*([A-Z]+)/mu.exec(block)?.[1];
    if (!status) {
      failures.push(`Register row ${id} carries no Status: value.`);
    } else if (!FINDINGS_STATUS_VOCABULARY.has(status)) {
      failures.push(
        `Register row ${id} uses a Status outside the register vocabulary: ${status}.`,
      );
    }
  }

  return failures;
}

/**
 * A tracked document that still points at the retired register path must also
 * name the current one, or the reader resolves to a file that does not exist.
 *
 * The frozen contracts under `docs/contracts/` are exempt: they are the
 * immutable record of what a past band was told, and rewriting a citation
 * inside them would falsify that record.
 */
export function checkRegisterCitations(repositoryRoot, trackedFiles) {
  const failures = [];
  for (const repositoryPath of trackedFiles) {
    if (!repositoryPath.endsWith(".md")) continue;
    if (repositoryPath.startsWith("docs/contracts/")) continue;
    const filePath = resolveTrackedPath(repositoryRoot, repositoryPath);
    if (!existsSync(filePath)) continue;
    const contents = readFileSync(filePath, "utf8");
    if (!contents.includes(RETIRED_REGISTER_PATH)) continue;
    if (!contents.includes(CURRENT_REGISTER_PATH)) {
      failures.push(
        `Tracked document cites the retired register path without naming the current one: ${repositoryPath}`,
      );
    }
  }
  return failures;
}

/**
 * The secret-scan allowlist suppresses whole directories, and nothing read it:
 * the suppressed set could grow without any lane noticing. The scopes below
 * are the recorded ones, and the total is capped, so a new suppressed
 * directory or an unbounded growth fails the policy check.
 */
export function checkSecretScanAllowlist(repositoryRoot, trackedFiles) {
  const failures = [];
  const configPath = path.join(repositoryRoot, ".gitleaks.toml");
  if (!existsSync(configPath)) {
    return ["The secret-scan allowlist file .gitleaks.toml is missing."];
  }
  const config = readFileSync(configPath, "utf8");
  const allowlistBlock = /\[allowlist\]([\s\S]*?)(?=\n\[|$)/u.exec(config);
  if (!allowlistBlock) {
    return [
      "The secret-scan allowlist file .gitleaks.toml has no [allowlist] block.",
    ];
  }
  const patterns = [...allowlistBlock[1].matchAll(/'''([^']*)'''/gu)].map(
    (match) => match[1],
  );
  if (!patterns.length) {
    return ["The secret-scan allowlist declares no path pattern."];
  }

  const suppressed = [];
  for (const repositoryPath of trackedFiles) {
    for (const pattern of patterns) {
      let expression;
      try {
        expression = new RegExp(pattern, "u");
      } catch {
        failures.push(
          `The secret-scan allowlist pattern is not a valid regular expression: ${pattern}`,
        );
        expression = null;
      }
      if (!expression) break;
      if (expression.test(repositoryPath)) {
        suppressed.push(repositoryPath);
        break;
      }
    }
  }

  const outsideScope = suppressed.filter(
    (repositoryPath) =>
      !SECRET_SCAN_ALLOWED_SCOPES.some((scope) =>
        repositoryPath.startsWith(scope),
      ) && !SECRET_SCAN_ALLOWED_SCOPES.includes(repositoryPath),
  );
  for (const repositoryPath of outsideScope) {
    failures.push(
      `A tracked path is suppressed by the secret-scan allowlist outside every recorded scope: ${repositoryPath}`,
    );
  }
  if (suppressed.length > SECRET_SCAN_SUPPRESSED_CEILING) {
    failures.push(
      `The secret-scan allowlist suppresses ${suppressed.length} tracked paths, above the recorded ceiling of ${SECRET_SCAN_SUPPRESSED_CEILING}.`,
    );
  }

  return failures;
}

/**
 * A generated tree under a module path must not be stageable. The ignore
 * rules for `backups/`, `logs/` and `temp/` were root-anchored, so a nested
 * capture — a live-state snapshot that may carry credential-derived material
 * — was invisible to `git status` and one `git add -A` away from history.
 */
export function checkNestedGeneratedTreesIgnored(repositoryRoot) {
  const failures = [];
  for (const nested of [
    "apps/knowledge/backups/capture.json",
    "integrations/openclaw/backups/capture.json",
    "integrations/openclaw/logs/run.log",
    "zink-tools/backups/capture.json",
  ]) {
    const result = runGit(repositoryRoot, ["check-ignore", "-q", "--", nested]);
    if (result.status !== 0) {
      failures.push(
        `A generated tree under a module path is not ignored and can be staged: ${nested}`,
      );
    }
  }
  return failures;
}

/**
 * Read the trailing-whitespace policy `.editorconfig` declares per file
 * class. `trim_trailing_whitespace = false` marks a class whose trailing
 * spaces are meaningful (Markdown hard breaks).
 */
function readEditorConfig(repositoryRoot) {
  const configPath = path.join(repositoryRoot, ".editorconfig");
  const rules = [];
  if (existsSync(configPath)) {
    let section = null;
    for (const line of readFileSync(configPath, "utf8").split(/\r?\n/u)) {
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1].trim();
        continue;
      }
      const propertyMatch =
        /^\s*trim_trailing_whitespace\s*=\s*(\S+)\s*$/u.exec(line);
      if (propertyMatch && section) {
        rules.push({ pattern: section, trims: propertyMatch[1] === "true" });
      }
    }
  }

  const matches = (repositoryPath, pattern) => {
    const source = pattern
      .split("/")
      .map((part) =>
        part === "**"
          ? ".*"
          : part.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*"),
      )
      .join("/");
    return new RegExp(`^${source}($|/.*)$`, "u").test(repositoryPath);
  };

  return {
    trimsTrailingWhitespace: (repositoryPath) => {
      for (const rule of rules) {
        if (matches(repositoryPath, rule.pattern)) {
          return rule.trims;
        }
      }
      return true;
    },
  };
}

export function checkRequiredFiles(repositoryRoot) {
  return REQUIRED_FILES.filter(
    (filePath) => !existsSync(path.join(repositoryRoot, filePath)),
  ).map((filePath) => `Required repository file is missing: ${filePath}`);
}

function commandLooksLikePlaceholder(command) {
  return (
    !command ||
    /^\s*echo\b/.test(command) ||
    /\b(?:TODO|placeholder)\b/i.test(command) ||
    /(?:^|&&)\s*(?:true|:|exit\s+0)\s*(?:&&|$)/.test(command)
  );
}

export function checkCommandDefinitions(packageJson, makefile) {
  const failures = [];
  const scripts = packageJson.scripts ?? {};

  for (const scriptName of REQUIRED_SCRIPTS) {
    const command = scripts[scriptName];
    if (commandLooksLikePlaceholder(command)) {
      failures.push(`npm script is missing or placeholder-like: ${scriptName}`);
    }
  }

  const verify = scripts.verify;
  if (
    typeof verify !== "string" ||
    verify !== REQUIRED_VERIFY_STAGES.join(" && ")
  ) {
    failures.push(
      `npm script verify must run the documented fail-fast quality gate in order: ${REQUIRED_VERIFY_STAGES.join(
        " && ",
      )}.`,
    );
  }

  const lines = makefile.split(/\r?\n/);
  for (const [target, expectedCommand] of Object.entries(MAKE_TARGETS)) {
    const targetIndex = lines.findIndex((line) => line === `${target}:`);
    const recipe = targetIndex >= 0 ? lines[targetIndex + 1] : undefined;
    if (!recipe?.startsWith("\t") || recipe.trim() !== expectedCommand) {
      failures.push(`Make target ${target} must run ${expectedCommand}.`);
    }
  }

  return failures;
}

const TEST_FILE_ARGUMENT = /^tests\/[\w.+-]+\.test\.mjs$/u;

// `format`/`format:check` hand prettier a list of glob patterns. Unquoted, the
// *shell* expands them first — and `/bin/sh` has no `globstar`, so a `tests` +
// double-star pattern degrades to one directory level and matches only helpers
// and fixtures. CI runs that shell, which is how 110 test files ended up outside
// their own format gate while four helper files stayed inside it. Quoting hands
// the pattern to prettier, whose own matcher does understand the double star.
//
// Double quotes specifically: `cmd.exe` does not treat a single quote as a quote,
// so a single-quoted pattern would reach prettier with the apostrophes intact and
// match nothing. A single-quoted argument is therefore a failure here, not a
// style choice.
export function checkFormatGlobQuoting(packageJson) {
  const failures = [];
  for (const scriptName of ["format", "format:check"]) {
    const command = packageJson?.scripts?.[scriptName];
    if (typeof command !== "string") {
      continue;
    }
    for (const token of command.split(/\s+/u)) {
      if (!token.includes("*") && !token.includes("{")) {
        continue;
      }
      if (token.startsWith('"') && token.endsWith('"')) {
        continue;
      }
      failures.push(
        `npm script ${scriptName} passes the glob ${token} unquoted or single-quoted, so the shell expands it before prettier sees it. Wrap it in double quotes.`,
      );
    }
  }
  return failures;
}

/**
 * `npm test` names its files instead of globbing them, which is what lets a
 * missing file fail loudly rather than silently shortening the run. The other
 * direction has no such backstop: a test file added to disk but never listed is
 * collected by no host and no CI run, so the suite looks greener the more tests
 * it stops running. Reconciling the two sets is the only thing that closes that.
 */
export function checkTestListReconciliation(packageJson, testFiles) {
  const command = packageJson?.scripts?.test;
  if (typeof command !== "string") {
    return [
      "npm script test must be a string so it can be reconciled with tests/.",
    ];
  }

  const listed = new Set(
    command.split(/\s+/u).filter((token) => TEST_FILE_ARGUMENT.test(token)),
  );
  const onDisk = new Set(testFiles);
  const failures = [];

  for (const file of [...onDisk].sort()) {
    if (!listed.has(file)) {
      failures.push(
        `Test file exists on disk but is not enumerated in the npm test script: ${file}. Add it, or this gate never runs it.`,
      );
    }
  }
  for (const entry of [...listed].sort()) {
    if (!onDisk.has(entry)) {
      failures.push(
        `The npm test script enumerates a test file that does not exist: ${entry}.`,
      );
    }
  }

  return failures;
}

const GATE_REGISTRY_HEADER =
  /^\|\s*Script\s*\|\s*What it checks\s*\|\s*Where it runs\s*\|\s*NOT RUN condition\s*\|/u;

/**
 * `docs/development/conventions.md` holds the one durable enumeration of the npm
 * gates, which is what gives a `NOT RUN` claim a denominator. A registry that can
 * drift from `package.json.scripts` is worse than none — it reads like an answer
 * while the scripts quietly change — so both directions fail, and a missing table
 * fails too rather than passing vacuously. This compares membership only: it never
 * adds a script to `verify`'s run order or to any CI job.
 */
export function checkGateRegistry(packageJson, registryMarkdown) {
  const scripts = Object.keys(packageJson?.scripts ?? {});
  const lines = String(registryMarkdown ?? "").split(/\r?\n/u);
  const header = lines.findIndex((line) => GATE_REGISTRY_HEADER.test(line));
  if (header < 0) {
    return [
      "Gate registry table is missing from docs/development/conventions.md, so the npm gates are enumerated nowhere.",
    ];
  }

  const listed = new Set();
  for (let index = header + 2; index < lines.length; index += 1) {
    const match = /^\|\s*`([^`]+)`\s*\|/u.exec(lines[index]);
    if (!match) break;
    listed.add(match[1]);
  }

  const failures = [];
  for (const scriptName of [...scripts].sort()) {
    if (!listed.has(scriptName)) {
      failures.push(
        `The gate registry does not enumerate the npm script: ${scriptName}.`,
      );
    }
  }
  for (const entry of [...listed].sort()) {
    if (!scripts.includes(entry)) {
      failures.push(
        `The gate registry enumerates an npm script that does not exist: ${entry}.`,
      );
    }
  }
  return failures;
}

function runGit(repositoryRoot, args) {
  const result = spawnSync(
    "git",
    ["-c", `safe.directory=${repositoryRoot}`, ...args],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  return result;
}

export function listTrackedFiles(repositoryRoot) {
  const output = execFileSync(
    "git",
    ["-c", `safe.directory=${repositoryRoot}`, "ls-files", "-z"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return output.split("\0").filter(Boolean);
}

export function checkGitWhitespace(repositoryRoot) {
  const failures = [];
  for (const args of [
    ["diff", "--check"],
    ["diff", "--cached", "--check"],
  ]) {
    const result = runGit(repositoryRoot, args);
    if (result.status !== 0) {
      const details = `${result.stdout}${result.stderr}`.trim();
      failures.push(
        `Git whitespace check failed (git ${args.join(" ")}): ${details}`,
      );
    }
  }
  return failures;
}

/**
 * F-241 (R7-D7-01): the shared network declaration must declare a network the
 * compose files consume.
 *
 * The file used to be a placeholder whose own premise was already false: it
 * said the shared definitions "will be added with the Compose implementation"
 * while the Compose implementation existed and nothing read the file. The
 * declaration is now real, and the compose files consume it by the shared
 * name, so the two must not drift apart. A declared network that no compose
 * file consumes is the same placeholder wearing a different name.
 */
export function compareSharedNetworks(sharedNetworks, composeNetworks) {
  const failures = [];
  const shared = sharedNetworks ?? {};
  const compose = composeNetworks ?? {};
  const consumed = new Set();

  for (const [file, declared] of Object.entries(compose)) {
    for (const [name, definition] of Object.entries(declared ?? {})) {
      if (!Object.hasOwn(shared, name)) continue;
      consumed.add(name);
      const sharedDriver = shared[name]?.driver;
      const declaredDriver = definition?.driver;
      if (sharedDriver && declaredDriver && sharedDriver !== declaredDriver) {
        failures.push(
          `The compose file ${file} declares the shared network ${name} with driver ${declaredDriver}, while the shared declaration says ${sharedDriver}.`,
        );
      }
    }
  }

  for (const name of Object.keys(shared)) {
    if (!consumed.has(name)) {
      failures.push(
        `The shared network declaration defines ${name}, which no compose file consumes.`,
      );
    }
  }
  return failures;
}

/**
 * The shared network declaration, the compose files that consume it and the
 * documented creation step, checked together.
 */
export function checkSharedNetworkDeclaration(repositoryRoot) {
  const failures = [];
  const declarationPath = path.join(
    repositoryRoot,
    "infrastructure",
    "networking",
    "networks.yml",
  );
  if (!existsSync(declarationPath)) {
    failures.push(
      "The shared network declaration is missing: infrastructure/networking/networks.yml",
    );
    return failures;
  }

  let shared;
  try {
    const document = parseDocument(readFileSync(declarationPath, "utf8"), {
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      failures.push(
        `The shared network declaration is not valid YAML: ${document.errors[0].message}`,
      );
      return failures;
    }
    shared = document.toJS()?.networks;
  } catch (error) {
    failures.push(
      `The shared network declaration is unreadable: ${error.message}`,
    );
    return failures;
  }
  if (!shared || typeof shared !== "object" || !Object.keys(shared).length) {
    failures.push(
      "The shared network declaration carries no network, so it declares nothing.",
    );
    return failures;
  }

  const composeDirectory = path.join(
    repositoryRoot,
    "infrastructure",
    "docker",
    "compose",
  );
  const composeNetworks = {};
  for (const name of existsSync(composeDirectory)
    ? readdirSync(composeDirectory).sort()
    : []) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const filePath = path.join(composeDirectory, name);
    try {
      const document = parseDocument(readFileSync(filePath, "utf8"), {
        uniqueKeys: true,
      });
      if (document.errors.length > 0) continue;
      composeNetworks[name] = document.toJS()?.networks ?? {};
    } catch {
      composeNetworks[name] = {};
    }
  }
  failures.push(...compareSharedNetworks(shared, composeNetworks));

  const runbookDirectory = path.join(repositoryRoot, "docs", "runbooks");
  const documented = existsSync(runbookDirectory)
    ? readdirSync(runbookDirectory).some((name) => {
        if (!name.endsWith(".md")) return false;
        const text = readFileSync(path.join(runbookDirectory, name), "utf8");
        return (
          text.includes("infrastructure/networking/networks.yml") &&
          text.includes("docker network create")
        );
      })
    : false;
  if (!documented) {
    failures.push(
      "No tracked runbook documents the shared network declaration and the step that creates it.",
    );
  }

  return failures;
}

/**
 * F-261 (R7-D12B-01): the working tree is the only authority, so exactly one
 * worktree may be registered.
 *
 * A stale registered worktree inside the repository carries its own PLAN.md
 * and AGENTS.md, and those documents declare themselves the durable source of
 * truth. Every gate skips that tree - it is gitignored, so it is outside the
 * tracked file set - while a cold resume that globs for those names reads a
 * second, contradictory authority. The charter's "working tree is
 * authoritative" rule is therefore enforced mechanically here: one registered
 * worktree, and it is this one.
 */
export function evaluateWorktreeRegistry(porcelainOutput, repositoryRoot) {
  const failures = [];
  const entries = String(porcelainOutput ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);

  if (entries.length === 0) {
    failures.push(
      "Git reports no registered worktree, so the authoritative working tree cannot be established.",
    );
    return failures;
  }
  if (entries.length > 1) {
    failures.push(
      `Git reports ${entries.length} registered worktrees; only the primary working tree may be registered: ${entries.join(", ")}.`,
    );
  }

  const primary = path.resolve(repositoryRoot);
  for (const entry of entries) {
    const resolved = path.resolve(entry);
    const same =
      process.platform === "win32"
        ? resolved.toLowerCase() === primary.toLowerCase()
        : resolved === primary;
    if (!same) {
      failures.push(
        `A registered worktree is not the primary working tree: ${entry} (expected ${primary}).`,
      );
    }
  }
  return failures;
}

export function checkWorktreeRegistry(repositoryRoot) {
  const result = runGit(repositoryRoot, ["worktree", "list", "--porcelain"]);
  if (result.status !== 0) {
    const details = `${result.stdout}${result.stderr}`.trim();
    return [`Git worktree list failed: ${details}`];
  }
  return evaluateWorktreeRegistry(result.stdout, repositoryRoot);
}

/**
 * Every script a doc or a runbook tells a human to run must be covered by a
 * verify stage.
 *
 * The operator entry points live where the Docker work put them
 * (`infrastructure/docker/scripts/`), not under `scripts/`, so no prettier
 * glob and no eslint target ever saw them: the runbook told the owner to run
 * `backup.ps1` and no lane in this repository could execute, lint or even
 * read it. The rule here is that a cited script is READ by at least one file
 * the `npm test` gate runs, and that the cited path exists at all - a doc that
 * points at a script nothing carries is the same defect with a shorter path.
 */
const OPERATOR_SCRIPT_CITATION =
  /(?:infrastructure\/docker\/scripts\/[\w.-]+\.(?:ps1|sh)|scripts\/[\w./-]+\.(?:mjs|sh|bash))/gu;

export function checkDocumentedScriptsAreCovered(
  repositoryRoot,
  packageJson,
  trackedFiles,
) {
  const failures = [];
  const command = packageJson?.scripts?.test;
  if (typeof command !== "string") {
    return [
      "npm script test must be a string so the covered scripts can be reconciled.",
    ];
  }
  const gateFiles = [
    ...new Set(
      command.split(/\s+/u).filter((token) => TEST_FILE_ARGUMENT.test(token)),
    ),
  ];
  const gateSources = new Map();
  for (const gateFile of gateFiles) {
    // The checker must not cover itself: this suite names script paths as
    // synthetic fixtures, and a fixture is not coverage.
    if (gateFile === "tests/repository-policy.test.mjs") continue;
    const gatePath = resolveTrackedPath(repositoryRoot, gateFile);
    if (!existsSync(gatePath)) continue;
    gateSources.set(gateFile, readFileSync(gatePath, "utf8"));
  }

  const docFiles = trackedFiles.filter(
    (repositoryPath) =>
      repositoryPath === "README.md" ||
      (repositoryPath.startsWith("docs/runbooks/") &&
        repositoryPath.endsWith(".md")),
  );
  const cited = new Map();
  for (const docFile of docFiles) {
    const docPath = resolveTrackedPath(repositoryRoot, docFile);
    if (!existsSync(docPath)) continue;
    const contents = readFileSync(docPath, "utf8");
    for (const match of contents.matchAll(OPERATOR_SCRIPT_CITATION)) {
      const scriptPath = match[0];
      if (!cited.has(scriptPath)) cited.set(scriptPath, new Set());
      cited.get(scriptPath).add(docFile);
    }
  }

  for (const [scriptPath, docFiles_] of [...cited].sort()) {
    if (!trackedFiles.includes(scriptPath)) {
      failures.push(
        `A tracked document tells the operator to run a script that is not tracked: ${scriptPath} (cited by ${[...docFiles_].sort().join(", ")}).`,
      );
      continue;
    }
    // A gate file names the script by its file name (the tests assemble the
    // path from parts), so the file name is the coverage token.
    const scriptName = path.posix.basename(scriptPath);
    const covered = [...gateSources.entries()].filter(([, source]) =>
      source.includes(scriptName),
    );
    if (!covered.length) {
      failures.push(
        `A tracked document tells the operator to run a script that no verify stage reads: ${scriptPath} (cited by ${[...docFiles_].sort().join(", ")}).`,
      );
    }
  }

  return failures;
}

/**
 * An advertised `scripts/` category directory must carry tracked content.
 *
 * The four category directories under `scripts/` were empty on disk and
 * untrackable by git, so a fresh clone had none of them and the repository
 * advertised four script families it does not ship.
 */
export function checkNoEmptyScriptCategory(repositoryRoot, trackedFiles) {
  const failures = [];
  const scriptsRoot = path.join(repositoryRoot, "scripts");
  if (!existsSync(scriptsRoot)) return failures;
  for (const name of readdirSync(scriptsRoot, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const prefix = `scripts/${name.name}/`;
    const tracked = trackedFiles.filter((repositoryPath) =>
      repositoryPath.startsWith(prefix),
    );
    if (!tracked.length) {
      failures.push(
        `The scripts category directory scripts/${name.name} carries no tracked file. Remove it, or add the scripts it advertises.`,
      );
    }
  }
  return failures;
}

/**
 * F-188 (R5-E09-06): the shipped dependency-audit job must compare the live
 * audit with the recorded baseline.
 *
 * A bare `npm audit --audit-level=high` returns the same non-zero exit for
 * the recorded 5-high baseline and for a newly added high-severity
 * dependency, so the job cannot say which one happened. The comparison step
 * is the gate: green while the baseline holds, red the moment a count grows.
 * The bare audit step therefore must not block the job before the comparison
 * has run, and the comparison itself must block.
 */
export function checkAuditBaselineWorkflow(repositoryRoot) {
  const failures = [];
  const workflowPath = WORKFLOW_PATHS.security;
  const filePath = path.join(repositoryRoot, workflowPath);
  if (!existsSync(filePath)) {
    failures.push(
      formatWorkflowFailure(workflowPath, "required workflow file is missing."),
    );
    return failures;
  }

  const document = parseDocument(readFileSync(filePath, "utf8"), {
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length > 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `YAML is invalid: ${document.errors[0].message}`,
      ),
    );
    return failures;
  }

  const steps = document.toJS()?.jobs?.["dependency-audit"]?.steps;
  if (!Array.isArray(steps)) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job dependency-audit must define steps.",
      ),
    );
    return failures;
  }

  const auditIndex = runStepIndex(steps, "npm audit --audit-level=high");
  const comparisonIndex = steps.findIndex(
    (step) =>
      isObject(step) &&
      typeof step.run === "string" &&
      step.run.includes(AUDIT_BASELINE_SCRIPT),
  );
  if (comparisonIndex < 0) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        `job dependency-audit must compare the audit against the recorded baseline by running ${AUDIT_BASELINE_SCRIPT}.`,
      ),
    );
    return failures;
  }
  if (steps[comparisonIndex]["continue-on-error"] === true) {
    failures.push(
      formatWorkflowFailure(
        workflowPath,
        "job dependency-audit must block on the baseline comparison.",
      ),
    );
  }
  if (auditIndex >= 0) {
    if (steps[auditIndex]["continue-on-error"] !== true) {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          "job dependency-audit must mark the bare audit step continue-on-error so the recorded baseline does not block the job before the comparison runs.",
        ),
      );
    }
    if (comparisonIndex <= auditIndex) {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          "job dependency-audit must run the baseline comparison after the audit it compares.",
        ),
      );
    }
  }
  return failures;
}

/**
 * The recorded audit baseline must exist, be tracked and carry the six counts
 * the comparison reads. A baseline that is not tracked is a threshold nobody
 * reviews, and a missing one turns the comparison into a gate that cannot
 * answer anything.
 */
export function checkAuditBaseline(repositoryRoot, trackedFiles) {
  const failures = [];
  const filePath = path.join(repositoryRoot, AUDIT_BASELINE_PATH);
  if (!existsSync(filePath)) {
    failures.push(
      `The npm audit baseline file is missing: ${AUDIT_BASELINE_PATH}`,
    );
    return failures;
  }
  if (!trackedFiles.includes(AUDIT_BASELINE_PATH)) {
    failures.push(
      `The npm audit baseline file is not tracked: ${AUDIT_BASELINE_PATH}`,
    );
  }
  try {
    readAuditBaseline(repositoryRoot);
  } catch (error) {
    failures.push(error.message);
  }
  return failures;
}

export function collectRepositoryFailures(repositoryRoot) {
  const failures = checkRequiredFiles(repositoryRoot);
  failures.push(...checkWorkflowDefinitions(repositoryRoot));
  const trackedFiles = listTrackedFiles(repositoryRoot);

  failures.push(...checkTrackedFilePolicies(trackedFiles));
  failures.push(...checkWorkingTreeTextPolicy(repositoryRoot, trackedFiles));
  failures.push(...checkGitWhitespace(repositoryRoot));
  failures.push(...checkWorktreeRegistry(repositoryRoot));
  failures.push(...checkSharedNetworkDeclaration(repositoryRoot));
  failures.push(...checkRecoveryArchiveProvenance(repositoryRoot));

  // The register is the queue every band reads, so it must be tracked: an
  // untracked register gives every row edit no commit, no author and no diff.
  if (!trackedFiles.includes(FINDINGS_REGISTER_PATH)) {
    failures.push(
      `The findings register is not tracked: ${FINDINGS_REGISTER_PATH}`,
    );
  }
  const registerPath = path.join(repositoryRoot, FINDINGS_REGISTER_PATH);
  if (existsSync(registerPath)) {
    failures.push(...checkFindingsRegister(readFileSync(registerPath, "utf8")));
  }
  failures.push(...checkRegisterCitations(repositoryRoot, trackedFiles));
  failures.push(...checkSecretScanAllowlist(repositoryRoot, trackedFiles));
  failures.push(...checkNestedGeneratedTreesIgnored(repositoryRoot));
  failures.push(...checkAuditBaseline(repositoryRoot, trackedFiles));
  failures.push(...checkAuditBaselineWorkflow(repositoryRoot));

  const packagePath = path.join(repositoryRoot, "package.json");
  const makefilePath = path.join(repositoryRoot, "Makefile");
  if (existsSync(packagePath) && existsSync(makefilePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const makefile = readFileSync(makefilePath, "utf8");
    failures.push(...checkCommandDefinitions(packageJson, makefile));
    failures.push(...checkFormatGlobQuoting(packageJson));

    const registryPath = path.join(
      repositoryRoot,
      "docs",
      "development",
      "conventions.md",
    );
    failures.push(
      ...checkGateRegistry(
        packageJson,
        existsSync(registryPath) ? readFileSync(registryPath, "utf8") : "",
      ),
    );

    const testsDirectory = path.join(repositoryRoot, "tests");
    if (existsSync(testsDirectory)) {
      const testFiles = readdirSync(testsDirectory)
        .filter((name) => name.endsWith(".test.mjs"))
        .map((name) => `tests/${name}`);
      failures.push(...checkTestListReconciliation(packageJson, testFiles));
    }

    failures.push(
      ...checkDocumentedScriptsAreCovered(
        repositoryRoot,
        packageJson,
        trackedFiles,
      ),
    );
  }

  failures.push(...checkNoEmptyScriptCategory(repositoryRoot, trackedFiles));

  return failures;
}
