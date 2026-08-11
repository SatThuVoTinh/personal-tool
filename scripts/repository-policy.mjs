import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

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
  "repo:check",
  "verify",
];

const MAKE_TARGETS = {
  install: "npm ci",
  format: "npm run format",
  "format-check": "npm run format:check",
  lint: "npm run lint",
  test: "npm test",
  "repo-check": "npm run repo:check",
  verify: "npm run verify",
};

const WORKFLOW_PATHS = {
  ci: ".github/workflows/ci.yml",
  security: ".github/workflows/security.yml",
};

const ACTIONS = {
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
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
  const hasMainPush =
    Array.isArray(pushBranches) && pushBranches.includes("main");

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
  for (const name of [
    "GITLEAKS_ENABLE_COMMENTS",
    "GITLEAKS_ENABLE_UPLOAD_ARTIFACT",
  ]) {
    if (environment?.[name] !== "false") {
      failures.push(
        formatWorkflowFailure(
          workflowPath,
          `job secret-scan Gitleaks must set ${name} to the string false.`,
        ),
      );
    }
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

export function checkWorkingTreeTextPolicy(repositoryRoot, trackedFiles) {
  const failures = [];

  for (const repositoryPath of trackedFiles) {
    const filePath = resolveTrackedPath(repositoryRoot, repositoryPath);
    if (!existsSync(filePath)) {
      failures.push(
        `Tracked file is missing from working tree: ${repositoryPath}`,
      );
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

    const lines = contents.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (/[ \t]+\r?$/.test(lines[index])) {
        failures.push(
          `Working-tree file has trailing whitespace: ${repositoryPath}:${index + 1}`,
        );
      }
    }
  }

  return failures;
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

  if (
    scripts.verify !==
    "npm run format:check && npm run lint && npm test && npm run repo:check"
  ) {
    failures.push(
      "npm script verify must run the documented fail-fast quality gate.",
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

export function collectRepositoryFailures(repositoryRoot) {
  const failures = checkRequiredFiles(repositoryRoot);
  failures.push(...checkWorkflowDefinitions(repositoryRoot));
  const trackedFiles = listTrackedFiles(repositoryRoot);

  failures.push(...checkTrackedFilePolicies(trackedFiles));
  failures.push(...checkWorkingTreeTextPolicy(repositoryRoot, trackedFiles));
  failures.push(...checkGitWhitespace(repositoryRoot));

  const packagePath = path.join(repositoryRoot, "package.json");
  const makefilePath = path.join(repositoryRoot, "Makefile");
  if (existsSync(packagePath) && existsSync(makefilePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const makefile = readFileSync(makefilePath, "utf8");
    failures.push(...checkCommandDefinitions(packageJson, makefile));
  }

  return failures;
}
