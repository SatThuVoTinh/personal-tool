// M12/T9 F-034 (legacy `R5-E09-02`) — H2: the in-repo merge blocker.
//
// The owner's answer to `H2` (2026-10-21) is **(a): an in-repo merge
// blocker**. GitHub branch protection is not enableable on this plan — the
// API answers `403 "Upgrade to GitHub Pro or make this repository public to
// enable this feature."` — so the repository owns the blocker and the
// repository stays private.
//
// The register row this implements (F-034) says the defect plainly: "AGENTS.md
// §11 treats gates as blocking, but no check is required, so a red pipeline of
// any kind merges into main." The blocker has two honest halves:
//
//   1. the PRE-MERGE gate — `scripts/merge-gate.mjs` refuses to let the
//      operator merge into `main` unless the tip being merged has a
//      SUCCESSFUL `quality-gate` run at that EXACT SHA, and it FAILS CLOSED
//      when it cannot determine the state;
//   2. the POST-MERGE detector — the `merge-gate-detector` job in
//      `.github/workflows/ci.yml` fails LOUDLY when the merged commit has no
//      successful `quality-gate` run at its own SHA.
//
// This lane asserts the OWNED PROPERTIES, not a copy of the files.
//
// The pre-merge script is driven WITHOUT the network: the run state is
// injected, either inline through `MERGE_GATE_RUN_STATE` or through the file
// `MERGE_GATE_RUN_STATE_FILE` names, and `MERGE_GATE_STATE_SOURCE` selects
// the reader (`auto` by default, `file`, `gh` or `rest`). A local HTTP server
// stands in for the GitHub REST API when the `rest` reader is exercised.
//
// The workflow is read with `parseDocument` from the `yaml` package, the
// approach the repository's other lanes already use.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SCRIPT_PATH = "scripts/merge-gate.mjs";
const SCRIPT = path.join(REPO_ROOT, SCRIPT_PATH);
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const RUN_URL =
  "https://github.com/SatThuVoTinh/personal-tool/actions/runs/4242";
const GATE_JOB = "quality-gate";
const DETECTOR_JOB = "merge-gate-detector";

/**
 * The run state the injected readers consume, and the shape both live
 * readers normalise to: the runs at a SHA, each with the jobs it carried.
 */
function runState({
  headSha = SHA,
  jobStatus = "completed",
  jobConclusion = "success",
  runUrl = RUN_URL,
  withGateJob = true,
} = {}) {
  return {
    sha: SHA,
    runs: [
      {
        id: 4242,
        workflow: "CI",
        headSha,
        status: "completed",
        conclusion: jobConclusion,
        url: runUrl,
        jobs: withGateJob
          ? [
              {
                name: GATE_JOB,
                status: jobStatus,
                conclusion: jobStatus === "completed" ? jobConclusion : null,
              },
            ]
          : [],
      },
    ],
  };
}

/**
 * Drive the pre-merge script. The ambient run-state sources and tokens are
 * removed first, so the script's own resolution is the one under test and the
 * lane never depends on what the host machine happens to have authenticated.
 */
function gateEnvironment(env) {
  const childEnv = { ...process.env };
  for (const name of [
    "MERGE_GATE_STATE_SOURCE",
    "MERGE_GATE_RUN_STATE",
    "MERGE_GATE_RUN_STATE_FILE",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_REPOSITORY",
    "GITHUB_API_URL",
  ]) {
    delete childEnv[name];
  }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[name];
    } else {
      childEnv[name] = value;
    }
  }
  return childEnv;
}

function runGate(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: gateEnvironment(env),
  });
}

/**
 * The same drive, asynchronously. The lane that stands a fake GitHub API in
 * for the gate needs this one: the fake server can only answer while this
 * process is free to run its event loop.
 */
function runGateAsync(args, env = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      env: gateEnvironment(env),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the pre-merge gate did not finish in time"));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/** Write the injected run state to a file and return its path. */
function withStateFile(state, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "f034-merge-gate-"));
  try {
    const filePath = path.join(directory, "run-state.json");
    writeFileSync(filePath, JSON.stringify(state), "utf8");
    return callback(filePath);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function readWorkflow() {
  const document = parseDocument(readFileSync(WORKFLOW_PATH, "utf8"), {
    uniqueKeys: true,
  });
  assert.deepEqual(document.errors, [], "the CI workflow must be valid YAML");
  return document.toJS();
}

// ---------------------------------------------------------------------------
// The pre-merge gate: it refuses unless the tip has a successful
// `quality-gate` run at that EXACT SHA, and it fails closed.
// ---------------------------------------------------------------------------
test("F-034: the pre-merge gate exists and runs through node", () => {
  assert.ok(
    existsSync(SCRIPT),
    `the pre-merge gate must exist: ${SCRIPT_PATH}`,
  );
  const help = runGate(["--help"]);
  assert.equal(
    help.status,
    0,
    `the pre-merge gate must be runnable through node: ${help.stderr}`,
  );
  assert.match(
    `${help.stdout}${help.stderr}`,
    /--sha/u,
    "the gate must say how it is driven",
  );
});

test("F-034: the pre-merge gate refuses a commit with no run at all", () => {
  withStateFile({ sha: SHA, runs: [] }, (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
    });
    assert.notEqual(
      result.status,
      0,
      "a commit with no successful quality-gate run must not be allowed to merge",
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      /REFUSED/u,
      "the refusal must say that the merge is refused",
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      new RegExp(SHA, "u"),
      "the refusal must name the commit that was checked",
    );
  });
});

test("F-034: the pre-merge gate refuses a run that carries no quality-gate job", () => {
  withStateFile(runState({ withGateJob: false }), (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
    });
    assert.notEqual(
      result.status,
      0,
      "a run that never ran the gate does not gate the commit",
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      /quality-gate/u,
      "the refusal must name the gate that did not run",
    );
  });
});

test("F-034: the pre-merge gate refuses a commit whose quality-gate run failed", () => {
  withStateFile(runState({ jobConclusion: "failure" }), (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /failure/u,
      "the refusal must name the conclusion of the gate run",
    );
  });
});

test("F-034: the pre-merge gate refuses a commit whose quality-gate run is still running", () => {
  withStateFile(
    runState({ jobStatus: "in_progress", jobConclusion: null }),
    (filePath) => {
      const result = runGate(["--sha", SHA], {
        MERGE_GATE_RUN_STATE_FILE: filePath,
      });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}${result.stderr}`,
        /still in_progress/u,
        "a run that has not concluded is not a successful gate run",
      );
    },
  );
});

test("F-034: the pre-merge gate refuses a run that belongs to another commit", () => {
  withStateFile(runState({ headSha: OTHER_SHA }), (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
    });
    assert.notEqual(
      result.status,
      0,
      "a successful run at another commit does not gate this one",
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      new RegExp(SHA, "u"),
      "the refusal must name the commit that was checked",
    );
  });
});

test("F-034: the pre-merge gate fails closed when it cannot determine the state", () => {
  const result = runGate(["--sha", SHA]);
  assert.notEqual(
    result.status,
    0,
    "an undeterminable state must not read as a pass",
  );
  assert.match(
    `${result.stdout}${result.stderr}`,
    /could not be determined/u,
    "the refusal must say the state could not be determined",
  );
  assert.match(
    `${result.stdout}${result.stderr}`,
    /token/u,
    "the refusal must name what is missing: a token to read the run state",
  );
});

test("F-034: the pre-merge gate fails closed when the injected run state is unreadable", () => {
  const missing = path.join(tmpdir(), "f034-no-such-run-state.json");
  const result = runGate(["--sha", SHA], {
    MERGE_GATE_RUN_STATE_FILE: missing,
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /could not be determined/u,
    "an unreadable state source is an undeterminable state, not a pass",
  );
});

test("F-034: the pre-merge gate accepts a commit with a successful quality-gate run and prints the run URL", () => {
  withStateFile(runState(), (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
    });
    assert.equal(
      result.status,
      0,
      `a successful quality-gate run at the tip must allow the merge: ${result.stderr}`,
    );
    assert.match(
      result.stdout,
      new RegExp(RUN_URL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      "the gate must print the run URL, so the operator can look at the evidence",
    );
  });
});

test("F-034: the pre-merge gate never prints the token it was given", () => {
  const token = "ghp_this-is-a-fake-token-value";
  withStateFile(runState(), (filePath) => {
    const result = runGate(["--sha", SHA], {
      MERGE_GATE_RUN_STATE_FILE: filePath,
      GH_TOKEN: token,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(token),
      "the gate must never print a token",
    );
  });
});

test("F-034: the pre-merge gate is a gate, not an action", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const forbidden = [
    /\bgit\s+push\b/u,
    /\bgit\s+commit\b/u,
    /\bgit\s+merge\b/u,
    /\bgit\s+(checkout|switch|reset|restore|clean|stash|rebase|cherry-pick|revert|apply|tag|branch|fetch|pull)\b/u,
    /\bgh\s+(pr\s+(merge|comment|review|edit|close|create)|issue\s+(create|comment|close|edit)|release\s+create|repo\s+edit|workflow\s+run)\b/u,
    /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu,
    /["']-X["']\s*,\s*["'](?:POST|PUT|PATCH|DELETE)["']/iu,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(source),
      `the pre-merge gate must not be able to change anything (matched ${pattern.source})`,
    );
  }
});

test("F-034: the pre-merge gate reads the REST API with the token in the header, and never prints it", async () => {
  const token = "ghp_another-fake-token-value";
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url.startsWith("/repos/owner/repo/actions/workflows/")) {
      response.end(
        JSON.stringify({
          workflow_runs: [
            {
              id: 4242,
              name: "CI",
              head_sha: SHA,
              status: "completed",
              conclusion: "success",
              html_url: RUN_URL,
            },
          ],
        }),
      );
      return;
    }
    if (request.url.startsWith("/repos/owner/repo/actions/runs/4242/jobs")) {
      response.end(
        JSON.stringify({
          jobs: [
            {
              name: GATE_JOB,
              status: "completed",
              conclusion: "success",
              html_url: `${RUN_URL}/job/1`,
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await runGateAsync(["--sha", SHA], {
      MERGE_GATE_STATE_SOURCE: "rest",
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_TOKEN: token,
    });
    assert.equal(
      result.status,
      0,
      `the REST reader must accept the successful gate run: ${result.stderr}`,
    );
    assert.ok(
      seen.length >= 2,
      "the REST reader must ask for the runs and for their jobs",
    );
    assert.ok(
      seen.every((request) => request.authorization === `Bearer ${token}`),
      "every request must carry the token in the Authorization header",
    );
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(token),
      "the gate must never print a token",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// The post-merge detector: a job on `main` that fails loudly when the merged
// commit has no successful `quality-gate` run at its own SHA.
// ---------------------------------------------------------------------------
test("F-034: the CI workflow carries the post-merge detector job", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  assert.ok(
    job !== null && typeof job === "object" && !Array.isArray(job),
    `the CI workflow must carry the \`${DETECTOR_JOB}\` job`,
  );
  assert.notEqual(
    job["continue-on-error"],
    true,
    "the detector must fail loudly, not advisory",
  );
  assert.ok(
    Array.isArray(job.steps) && job.steps.length > 0,
    "the detector job must have steps",
  );
  for (const [index, step] of job.steps.entries()) {
    assert.notEqual(
      step?.["continue-on-error"],
      true,
      `detector step ${index} (${step?.name}) must not continue on error: the detector has to fail loudly`,
    );
  }
});

test("F-034: the detector job checks the merged commit's own SHA", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const environment = steps.flatMap((step) =>
    step?.env && typeof step.env === "object" ? Object.values(step.env) : [],
  );
  assert.ok(
    environment.includes("${{ github.sha }}"),
    "the detector must read the merged commit's own SHA from `github.sha`",
  );
  const commands = steps
    .map((step) => (typeof step?.run === "string" ? step.run : ""))
    .join("\n");
  assert.match(
    commands,
    /scripts\/merge-gate\.mjs/u,
    "the detector must read the run state with the same gate the operator runs",
  );
  assert.match(
    commands,
    /--sha/u,
    "the detector must ask the gate about the merged commit's SHA",
  );
});

test("F-034: the detector job runs for a push to main and nowhere else", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  const condition = String(job?.if ?? "");
  assert.match(
    condition,
    /push/u,
    "the detector is a POST-merge check: it must run for the push that landed the merge",
  );
  assert.match(
    condition,
    /refs\/heads\/main/u,
    "the detector must run on `main`, where the merge landed",
  );
});

test("F-034: the detector runs even when the quality gate failed", () => {
  // The detector exists for the merge that landed WITHOUT a successful gate.
  // A job that waits on the gate is SKIPPED when the gate fails, so without
  // `always()` the one case the detector exists for would stay silent.
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  const condition = String(job?.if ?? "");
  assert.match(
    condition,
    /always\(\)/u,
    "the detector must run even when the quality-gate job it needs failed",
  );
  assert.match(
    String(job?.needs ?? ""),
    /quality-gate/u,
    "the detector still waits for the gate's verdict, so it is about a concluded run",
  );
});

test("F-034: the detector job cannot write to the repository", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  const permissions = job?.permissions;
  assert.ok(
    permissions !== null && typeof permissions === "object",
    "the detector job must declare its own permissions",
  );
  for (const [scope, value] of Object.entries(permissions)) {
    assert.equal(
      value,
      "read",
      `the detector job must hold only read permissions, but ${scope} is ${value}`,
    );
  }
  assert.equal(
    workflow.permissions?.contents,
    "read",
    "the workflow's own root permissions must stay read-only",
  );
});

test("F-034: the detector job needs no secret the workflow did not already have", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.[DETECTOR_JOB];
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const serialized = JSON.stringify(steps);
  const secrets = serialized.match(/secrets\.[A-Za-z_][A-Za-z0-9_]*/gu) ?? [];
  assert.deepEqual(
    secrets,
    [],
    `the detector must not read a repository secret, but it reads ${secrets.join(", ")}`,
  );
  assert.match(
    serialized,
    /github\.token/u,
    "the detector must use the workflow's own built-in token",
  );
});

test("F-034: the quality-gate job is untouched", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.["quality-gate"];
  assert.ok(
    job !== null && typeof job === "object" && !Array.isArray(job),
    "the workflow must keep the `quality-gate` job",
  );
  assert.equal(
    job["runs-on"],
    "ubuntu-24.04",
    "the quality gate must stay runnable on ubuntu-24.04",
  );
  assert.notEqual(
    job["continue-on-error"],
    true,
    "the quality-gate job must block the workflow",
  );
  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert.ok(
    steps.some((step) => step?.run?.trim() === "npm run verify"),
    "the quality-gate job must still run the repository's own verify gate",
  );
  for (const [index, step] of steps.entries()) {
    assert.notEqual(
      step?.["continue-on-error"],
      true,
      `quality-gate step ${index} (${step?.name}) must not continue on error: the gate has to block`,
    );
  }
});
