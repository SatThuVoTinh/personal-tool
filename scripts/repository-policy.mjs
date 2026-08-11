import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
