// F-034 (legacy `R5-E09-02`) — H2: the in-repo merge blocker, pre-merge half.
//
// GitHub branch protection is NOT enableable on this plan: the API answers
// `403 "Upgrade to GitHub Pro or make this repository public to enable this
// feature."` (the register's own evidence for F-034). The owner's answer to
// `H2` (2026-10-21) is (a): an IN-REPO merge blocker, and the repository stays
// private.
//
// This file is the PRE-MERGE half. It REFUSES (a non-zero exit) unless the
// tip being merged carries a SUCCESSFUL `quality-gate` run at that EXACT SHA,
// and it FAILS CLOSED whenever it cannot determine the state: no token, no
// network, no such commit, no run, an unreadable answer. It prints the run URL
// so the operator can look at the evidence instead of taking the gate's word.
//
// It is a GATE, not an action. It never edits a branch, never pushes, never
// merges, never comments on a pull request and never opens an issue: the only
// commands it can run are read-only ones (`git rev-parse`, `git remote
// get-url`, `gh run list`, `gh run view`) plus read-only HTTP GETs.
//
// The POST-MERGE half is the `merge-gate-detector` job in
// `.github/workflows/ci.yml`. It runs THIS script against the merged commit's
// PREDECESSOR SHAs, never against the run's own SHA: the run that hosts the
// detector necessarily contains its own `quality-gate` job, so judging that
// SHA is circular (F-567, legacy `R10-T09-2`).
//
// HOW IT IS DRIVEN
//
//   node scripts/merge-gate.mjs [--sha <sha>] [--workflow <file>]
//                                [--repo <owner/name>] [--source auto|file|gh|rest]
//
// `--sha` defaults to the current HEAD commit. The run state is read from:
//
//   * the INJECTED state — `MERGE_GATE_RUN_STATE` (inline JSON) or
//     `MERGE_GATE_RUN_STATE_FILE` (a path to a JSON file). This is the seam
//     the test lane uses, so the gate can be exercised without the network;
//   * the GitHub CLI — `gh run list --commit <sha>`, then `gh run view` for
//     the jobs of each run, with the token passed through the child's
//     environment;
//   * the GitHub REST API — `GET /repos/{owner}/{repo}/actions/workflows/
//     {workflow}/runs?head_sha={sha}` and the jobs of each run.
//
// `MERGE_GATE_STATE_SOURCE` selects the reader: `auto` (the default) takes
// the injected state when there is one and the network otherwise, `file`,
// `gh` and `rest` force one reader. The token is read from the environment
// only (`GH_TOKEN` or `GITHUB_TOKEN`) and is never printed, never logged and
// never passed on a command line.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

// F-474 (legacy `R9-L10-1`): the workflow declares more than one blocking
// job. A green from `quality-gate` alone is not a green pipeline: the
// Knowledgebase Python suite is its own blocking job, so both names are the
// gate's operand and every one of them must have completed successfully at
// the SHA being judged.
export const GATE_JOB_NAMES = ["quality-gate", "python-quality"];
export const DEFAULT_WORKFLOW_FILE = "ci.yml";
export const STATE_SOURCE_VARIABLE = "MERGE_GATE_STATE_SOURCE";
export const RUN_STATE_VARIABLE = "MERGE_GATE_RUN_STATE";
export const RUN_STATE_FILE_VARIABLE = "MERGE_GATE_RUN_STATE_FILE";

const TOKEN_VARIABLES = ["GH_TOKEN", "GITHUB_TOKEN"];
const DEFAULT_API_URL = "https://api.github.com";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The token the readers may use. It is read from the environment only and
 * never leaves this process except as an HTTP header or a child's environment
 * variable: it is never printed, never logged and never put on a command line.
 */
export function readToken(env = process.env) {
  for (const name of TOKEN_VARIABLES) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length) return value;
  }
  return null;
}

/** Replace every occurrence of the token, so no message can carry it. */
function redact(text, token) {
  const value = String(text ?? "");
  if (!token) return value;
  return value.split(token).join("***");
}

/**
 * The run state, parsed and validated. The shape is the one both live readers
 * normalise to: the runs at a SHA, each with the jobs it carried.
 */
export function parseRunState(text, source) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `the run state from ${source} is not valid JSON: ${error.message}`,
      { cause: error },
    );
  }
  if (!isObject(document) || !Array.isArray(document.runs)) {
    throw new Error(`the run state from ${source} carries no runs array`);
  }
  return document;
}

/**
 * The verdict on one commit: has EVERY job the workflow declares blocking
 * completed successfully at that EXACT SHA?
 *
 * F-474 (legacy `R9-L10-1`): the pipeline is green only when every blocking
 * job is green. A successful `quality-gate` no longer outranks a failed
 * `python-quality`; a job that did not run, did not finish, or concluded
 * non-success is named in the refusal. A run counts only when it sits at that
 * SHA; a run at another SHA and a commit with no run at all are refusals.
 */
export function evaluateGateState(document, sha) {
  const runs = (Array.isArray(document?.runs) ? document.runs : []).filter(
    (run) => isObject(run) && run.headSha === sha,
  );
  if (!runs.length) {
    return {
      ok: false,
      reason: `no workflow run exists at ${sha}, so no successful ${GATE_JOB_NAMES.join(" / ")} run covers that commit.`,
    };
  }

  const jobs = [];
  for (const run of runs) {
    const carried = Array.isArray(run.jobs) ? run.jobs : [];
    for (const job of carried) {
      if (isObject(job) && GATE_JOB_NAMES.includes(job.name)) {
        jobs.push({ run, job });
      }
    }
  }

  let succeeded = null;
  for (const name of GATE_JOB_NAMES) {
    const candidates = jobs.filter(({ job }) => job.name === name);
    if (!candidates.length) {
      return {
        ok: false,
        reason: `no run at ${sha} carries a ${name} job, so nothing gated that commit.`,
      };
    }

    const success = candidates.find(
      ({ job }) => job.status === "completed" && job.conclusion === "success",
    );
    if (success) {
      succeeded ??= success;
      continue;
    }

    const failed = candidates.find(
      ({ job }) => job.status === "completed" && job.conclusion !== "success",
    );
    if (failed) {
      return {
        ok: false,
        reason: `the blocking job ${name} at ${sha} concluded ${failed.job.conclusion ?? "an unknown result"}.`,
        url: failed.run.url ?? null,
      };
    }

    const pending = candidates[0];
    return {
      ok: false,
      reason: `the blocking job ${name} at ${sha} is still ${pending.job.status ?? "running"}.`,
      url: pending.run.url ?? null,
    };
  }

  return {
    ok: true,
    reason: `the blocking jobs at ${sha} succeeded: ${GATE_JOB_NAMES.join(", ")}.`,
    url: succeeded?.run.url ?? null,
  };
}

/**
 * The injected run state, when the operator (or the test lane) provided one.
 *
 * A source that is CONFIGURED but broken is a refusal, never a fall-through
 * to the network: the operator pointed at this state, so this state decides.
 */
export function readInjectedState(env = process.env) {
  const inline = env[RUN_STATE_VARIABLE];
  if (typeof inline === "string" && inline.trim().length) {
    try {
      return {
        ok: true,
        configured: true,
        document: parseRunState(inline, `$${RUN_STATE_VARIABLE}`),
        source: `the injected run state ($${RUN_STATE_VARIABLE})`,
      };
    } catch (error) {
      return { ok: false, configured: true, reason: error.message };
    }
  }

  const file = env[RUN_STATE_FILE_VARIABLE];
  if (typeof file === "string" && file.trim().length) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      return {
        ok: false,
        configured: true,
        reason: `the run-state file ${file} could not be read: ${error.message}`,
      };
    }
    try {
      return {
        ok: true,
        configured: true,
        document: parseRunState(text, `the run-state file ${file}`),
        source: `the run-state file ${file}`,
      };
    } catch (error) {
      return { ok: false, configured: true, reason: error.message };
    }
  }

  return { ok: false, configured: false, reason: "no run state was injected" };
}

function runCommand(command, args, { env, cwd, token }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  if (result.error) {
    return {
      ok: false,
      reason: `${command} could not be run: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `${command} ${args[0]} failed with exit ${result.status}: ${redact(
        String(result.stderr ?? "").trim(),
        token,
      )}`,
    };
  }
  return { ok: true, stdout: String(result.stdout ?? "") };
}

/**
 * The run state through the GitHub CLI: `gh run list --commit <sha>` for the
 * runs, then `gh run view` for the jobs of each one, because the verdict is
 * about the `quality-gate` JOB and not about the run as a whole.
 */
export function readStateFromGh(sha, { workflow, token, cwd, env }) {
  const childEnv = { ...env, GH_TOKEN: token };
  const list = runCommand(
    "gh",
    [
      "run",
      "list",
      "--commit",
      sha,
      "--workflow",
      workflow,
      "--limit",
      "100",
      "--json",
      "databaseId,workflowName,headSha,status,conclusion,url",
    ],
    { env: childEnv, cwd, token },
  );
  if (!list.ok) return list;

  let runs;
  try {
    runs = JSON.parse(list.stdout);
  } catch (error) {
    return {
      ok: false,
      reason: `gh run list returned unreadable JSON: ${error.message}`,
    };
  }
  if (!Array.isArray(runs)) {
    return { ok: false, reason: "gh run list returned no runs array" };
  }

  const normalized = [];
  for (const run of runs) {
    const view = runCommand(
      "gh",
      [
        "run",
        "view",
        String(run.databaseId),
        "--json",
        "jobs,headSha,status,conclusion,url,workflowName",
      ],
      { env: childEnv, cwd, token },
    );
    if (!view.ok) return view;
    let jobs;
    try {
      const parsed = JSON.parse(view.stdout);
      jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    } catch (error) {
      return {
        ok: false,
        reason: `gh run view returned unreadable JSON: ${error.message}`,
      };
    }
    normalized.push({
      id: run.databaseId,
      workflow: run.workflowName,
      headSha: run.headSha,
      status: run.status,
      conclusion: run.conclusion,
      url: run.url,
      jobs: jobs.map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
      })),
    });
  }
  return {
    ok: true,
    document: { sha, runs: normalized },
    source: "the GitHub CLI",
  };
}

/**
 * One read-only HTTP GET, answered with JSON.
 *
 * `node:http` is used rather than `fetch` on purpose: the default agent does
 * not keep the connection alive, so the gate's own process ends as soon as it
 * has its answer, and no socket outlives the check.
 */
export function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "http:" ? httpRequest : httpsRequest;
    const request = send(target, { method: "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch {
          // An unreadable body is not a JSON answer: the reader reports the
          // status it got, and the gate refuses on it.
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode ?? 0,
          body: parsed,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * The run state through the GitHub REST API. Every request is a GET and the
 * token travels in the `Authorization` header, never in the URL.
 */
export async function readStateFromRest(
  sha,
  { workflow, token, repo, apiUrl, getJson: readJson },
) {
  if (!repo) {
    return {
      ok: false,
      reason:
        "the repository is unknown, so the runs cannot be read (pass --repo <owner/name>)",
    };
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };
  const base = `${apiUrl}/repos/${repo}/actions`;

  let runsResponse;
  try {
    runsResponse = await readJson(
      `${base}/workflows/${workflow}/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
      headers,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `the GitHub API could not be reached: ${error.message}`,
    };
  }
  if (!runsResponse.ok) {
    return {
      ok: false,
      reason: `the GitHub API answered ${runsResponse.status} for the runs of ${sha}.`,
    };
  }
  const runsBody = runsResponse.body;
  const runs = Array.isArray(runsBody?.workflow_runs)
    ? runsBody.workflow_runs
    : [];

  const normalized = [];
  for (const run of runs) {
    let jobsResponse;
    try {
      jobsResponse = await readJson(
        `${base}/runs/${run.id}/jobs?per_page=100`,
        headers,
      );
    } catch (error) {
      return {
        ok: false,
        reason: `the GitHub API could not be reached: ${error.message}`,
      };
    }
    if (!jobsResponse.ok) {
      return {
        ok: false,
        reason: `the GitHub API answered ${jobsResponse.status} for the jobs of run ${run.id}.`,
      };
    }
    const jobsBody = jobsResponse.body;
    const jobs = Array.isArray(jobsBody?.jobs) ? jobsBody.jobs : [];
    normalized.push({
      id: run.id,
      workflow: run.name,
      headSha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      jobs: jobs.map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
      })),
    });
  }
  return {
    ok: true,
    document: { sha, runs: normalized },
    source: "the GitHub REST API",
  };
}

/**
 * The predecessor SHAs of a commit: its parents.
 *
 * F-567 (legacy `R10-T09-2`): the post-merge detector must not judge the SHA
 * of the run that hosts it. A push to `main` lands a commit whose parents are
 * the commits that were already on `main` and, for a merge, the merged branch
 * tip; the branch tip is the SHA the pre-merge gate was supposed to judge. The
 * detector therefore asks git for the parents and checks each of them. A
 * shallow checkout cannot answer this, so the workflow checks out with
 * `fetch-depth: 0`; a git failure or an empty parent list is a refusal.
 */
export function readPredecessorShas(sha, cwd) {
  const result = spawnSync("git", ["rev-list", "--parents", "-n", "1", sha], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    return {
      ok: false,
      reason: `git could not be run to read the predecessors of ${sha}: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `git could not read the predecessors of ${sha} (exit ${result.status}): ${String(
        result.stderr ?? "",
      ).trim()}`,
    };
  }
  const line =
    String(result.stdout ?? "")
      .trim()
      .split(/\r?\n/u)[0] ?? "";
  const [commit, ...parents] = line.split(/\s+/u).filter(Boolean);
  if (!commit) {
    return {
      ok: false,
      reason: `the commit ${sha} could not be resolved to a predecessor list.`,
    };
  }
  if (!parents.length) {
    return {
      ok: false,
      reason: `the commit ${commit} has no predecessor in this checkout: a shallow history cannot judge a merge.`,
    };
  }
  return { ok: true, commit, shas: parents };
}

/** The commit the gate checks when the operator names none. */
export function readHeadCommit(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "").trim() || null;
}

/** The repository the runs are read from, when the operator names none. */
export function readRepository(cwd, env) {
  const fromEnvironment = env.GITHUB_REPOSITORY;
  if (typeof fromEnvironment === "string" && fromEnvironment.includes("/")) {
    return fromEnvironment.trim();
  }
  const result = spawnSync(
    "git",
    ["-c", `safe.directory=${cwd}`, "remote", "get-url", "origin"],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) return null;
  const url = String(result.stdout ?? "").trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url);
  return match ? match[1] : null;
}

/** Is the GitHub CLI on this machine? */
export function ghAvailable(cwd, env) {
  const result = spawnSync("gh", ["--version"], {
    cwd,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function parseArguments(argv) {
  const options = { help: false, shas: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    const takesValue = ["--sha", "--workflow", "--repo", "--source"];
    if (takesValue.includes(argument) && value === undefined) {
      throw new Error(`${argument} needs a value.`);
    }
    switch (argument) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--sha":
        options.shas.push(value);
        index += 1;
        break;
      case "--predecessors":
        options.predecessors = true;
        break;
      case "--workflow":
        options.workflow = value;
        index += 1;
        break;
      case "--repo":
        options.repo = value;
        index += 1;
        break;
      case "--source":
        options.source = value;
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function usage() {
  return [
    "merge-gate: refuse a merge into `main` whose tip has no successful",
    "`quality-gate` run at that exact SHA.",
    "",
    "Usage: node scripts/merge-gate.mjs [options]",
    "",
    "  --sha <sha>          a commit to check; repeat it to check several",
    "                       (default: the current HEAD)",
    "  --predecessors       check the commit's predecessor SHAs (its parents)",
    "                       instead of the commit itself; needs full history",
    "  --workflow <file>    the workflow file that carries the gate",
    `                       (default: ${DEFAULT_WORKFLOW_FILE})`,
    "  --repo <owner/name>  the repository the runs are read from",
    "  --source <reader>    auto (default), file, gh or rest",
    "  --help               print this text",
  ].join("\n");
}

/**
 * The run state, from the source the options select. Every failure here is a
 * refusal: the gate never guesses what the run state was.
 */
export async function resolveRunState({
  sha,
  workflow,
  repo,
  token,
  source,
  cwd,
  env,
  apiUrl,
  getJson: readJson,
  ghIsAvailable,
}) {
  const requested = String(source ?? "auto").toLowerCase();
  if (!["auto", "file", "gh", "rest"].includes(requested)) {
    return {
      ok: false,
      reason: `unknown run-state source: ${requested}. Use auto, file, gh or rest.`,
    };
  }

  const injected = readInjectedState(env);
  if (requested === "file") {
    return injected.ok ? injected : { ok: false, reason: injected.reason };
  }
  if (requested === "auto" && injected.ok) {
    return injected;
  }
  if (requested === "auto" && injected.configured) {
    return { ok: false, reason: injected.reason };
  }

  if (!token) {
    return {
      ok: false,
      reason:
        "no token is available to read the run state (set GH_TOKEN or GITHUB_TOKEN), and no run state was injected",
    };
  }

  if (requested === "rest") {
    return readStateFromRest(sha, {
      workflow,
      token,
      repo,
      apiUrl,
      getJson: readJson,
    });
  }
  if (requested === "gh") {
    return readStateFromGh(sha, { workflow, token, cwd, env });
  }
  if (ghIsAvailable) {
    const viaGh = readStateFromGh(sha, { workflow, token, cwd, env });
    if (viaGh.ok) return viaGh;
    // The CLI failed. The REST API is the other reader of the same state, so
    // the gate tries it before it refuses - but it refuses if neither answers.
    const viaRest = await readStateFromRest(sha, {
      workflow,
      token,
      repo,
      apiUrl,
      getJson: readJson,
    });
    if (viaRest.ok) return viaRest;
    return {
      ok: false,
      reason: `${viaGh.reason}; ${viaRest.reason}`,
    };
  }
  return readStateFromRest(sha, {
    workflow,
    token,
    repo,
    apiUrl,
    getJson: readJson,
  });
}

export async function runGate(argv, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const readJson = options.getJson ?? getJson;
  const token = readToken(env);
  const parsed = parseArguments(argv);
  if (parsed.help) {
    console.log(usage());
    return 0;
  }

  if (parsed.predecessors && parsed.shas.length > 1) {
    console.error(
      "merge-gate: REFUSED — --predecessors judges one commit's predecessors; pass at most one --sha.",
    );
    return 1;
  }

  let targets;
  if (parsed.predecessors) {
    const tip = parsed.shas[0] ?? "HEAD";
    const predecessors = readPredecessorShas(tip, cwd);
    if (!predecessors.ok) {
      console.error(`merge-gate: REFUSED — ${predecessors.reason}`);
      return 1;
    }
    targets = predecessors.shas;
  } else {
    targets = parsed.shas.length ? parsed.shas : [readHeadCommit(cwd)];
    if (!targets[0]) {
      console.error(
        "merge-gate: REFUSED — no commit to check: pass --sha <sha>, or run the gate inside a repository whose HEAD can be read.",
      );
      return 1;
    }
  }

  const workflow = parsed.workflow ?? DEFAULT_WORKFLOW_FILE;
  const repo = parsed.repo ?? readRepository(cwd, env);

  let exitCode = 0;
  for (const sha of targets) {
    const state = await resolveRunState({
      sha,
      workflow,
      repo,
      token,
      source: parsed.source ?? env[STATE_SOURCE_VARIABLE],
      cwd,
      env,
      apiUrl: env.GITHUB_API_URL ?? DEFAULT_API_URL,
      getJson: readJson,
      ghIsAvailable: options.ghIsAvailable ?? ghAvailable(cwd, env),
    });
    if (!state.ok) {
      console.error(
        `merge-gate: REFUSED — the run state for ${sha} could not be determined: ${redact(state.reason, token)}`,
      );
      exitCode = 1;
      continue;
    }

    const verdict = evaluateGateState(state.document, sha);
    if (!verdict.ok) {
      console.error(`merge-gate: REFUSED — ${verdict.reason}`);
      if (verdict.url) console.error(`merge-gate: run ${verdict.url}`);
      exitCode = 1;
      continue;
    }

    console.log(`merge-gate: ${verdict.reason}`);
    if (verdict.url) console.log(`merge-gate: run ${verdict.url}`);
    console.log(`merge-gate: read from ${state.source}.`);
  }
  return exitCode;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const code = await runGate(process.argv.slice(2));
    if (code) process.exitCode = code;
  } catch (error) {
    console.error(`merge-gate: REFUSED — ${error.message}`);
    process.exitCode = 1;
  }
}
