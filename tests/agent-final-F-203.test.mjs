// M12/T9 F-203 (legacy R1-A05-06): the two entrypoint families disagreed on
// which state tree they inspect and on whether permission assertions apply
// at all.
//
// `requireFileMode` (configure.mjs) and `requireMode` (verify.mjs) return
// early on win32, so the whole 0o600/0o700 battery is vacuous on that host
// while the gate still reads PASS. The tree the builder inspects on win32 is
// the NTFS copy under the Windows homedir, NOT the governed WSL tree
// `/home/hoang_vinh/.openclaw-zink`, so a green Windows preflight was
// readable as deployment evidence for a tree nobody governs.
//
// Acceptance criteria: "Every PASS emitted by `configure.mjs` and `verify.mjs`
// records which state tree it actually inspected and whether the host enforces
// POSIX modes, and a host where the governed WSL tree
// `/home/hoang_vinh/.openclaw-zink` is unreachable or modes are unenforced
// yields `NOT RUN` rather than PASS, so a green Windows preflight against the
// homedir copy can no longer be recorded as deployment evidence."
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const CONFIGURE = path.join(
  process.cwd(),
  "integrations",
  "openclaw",
  "configure.mjs",
);
const VERIFY = path.join(
  process.cwd(),
  "integrations",
  "openclaw",
  "verify.mjs",
);
const GOVERNED_STATE_TREE = "/home/hoang_vinh/.openclaw-zink";

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
});

const identifierArguments = Object.freeze([
  "--discord-guild-id",
  identifiers.discordGuildId,
  "--discord-owner-id",
  identifiers.discordOwnerId,
  "--discord-office-channel-id",
  identifiers.discordOfficeChannelId,
  "--discord-results-forum-id",
  identifiers.discordResultsForumId,
  "--discord-approvals-forum-id",
  identifiers.discordApprovalsForumId,
  "--discord-incidents-forum-id",
  identifiers.discordIncidentsForumId,
]);

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "agent-final-f203-"));
}

function environmentForTemporaryHome(root) {
  return {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    ZINK_ROUTER_HOST: "router.invalid",
    ZINK_ROUTER_PORT: "1",
    ZINK_ROUTER_API_KEY: "test-router-key-not-a-credential",
  };
}

function run(script, args, environment) {
  try {
    const stdout = execFileSync(process.execPath, ["--", script, ...args], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout: stdout.toString("utf8"), stderr: "" };
  } catch (error) {
    return {
      status: typeof error.status === "number" ? error.status : 1,
      stdout: error.stdout ? error.stdout.toString("utf8") : "",
      stderr: error.stderr ? error.stderr.toString("utf8") : "",
    };
  }
}

function takeTransaction(stateDir, seed = "d") {
  const attemptId = `txn-${seed.repeat(64)}`;
  const transactionDirectory = path.join(
    stateDir,
    "operator",
    "m7-t2",
    "transactions",
    attemptId,
  );
  mkdirSync(transactionDirectory, { recursive: true });
  writeFileSync(
    path.join(transactionDirectory, "transaction.json"),
    `${JSON.stringify({ attemptId })}\n`,
    "utf8",
  );
  return attemptId;
}

function provision(root) {
  const stateDir = path.join(root, ".openclaw-zink");
  const systemdUserDir = path.join(root, ".config", "systemd", "user");
  const environment = environmentForTemporaryHome(root);
  const baseArgs = [
    "--state-dir",
    stateDir,
    "--systemd-user-dir",
    systemdUserDir,
    ...identifierArguments,
  ];
  const applied = run(
    CONFIGURE,
    ["--apply", "--apply-transaction", takeTransaction(stateDir), ...baseArgs],
    environment,
  );
  assert.equal(
    applied.status,
    0,
    `the apply must succeed on a clean tree: ${applied.stderr}`,
  );
  return { stateDir, systemdUserDir, environment, baseArgs };
}

test("F-203: the preflight PASS records the tree it inspected and the mode enforcement", () => {
  const root = temporaryDirectory();
  try {
    const { stateDir, environment, baseArgs } = provision(root);
    const preflight = run(CONFIGURE, ["--preflight", ...baseArgs], environment);
    assert.equal(preflight.status, 0, preflight.stderr);
    const parsed = JSON.parse(preflight.stdout);
    assert.equal(parsed.preflight, "PASS");
    assert.ok(parsed.inspection, "the PASS must carry an inspection record");
    assert.equal(
      parsed.inspection.stateTree,
      stateDir,
      "the record must name the tree the run actually inspected",
    );
    assert.equal(
      parsed.inspection.posixModesEnforced,
      process.platform !== "win32",
      "the record must state whether the host enforces POSIX modes",
    );
    assert.equal(
      parsed.inspection.governedStateTree,
      GOVERNED_STATE_TREE,
      "the record must name the governed tree",
    );
    assert.equal(
      typeof parsed.inspection.governedStateTreeReachable,
      "boolean",
      "the record must state whether the governed tree is reachable",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-203: a host that cannot reach the governed tree yields NOT RUN, not PASS", () => {
  const root = temporaryDirectory();
  try {
    const { environment, baseArgs } = provision(root);
    const preflight = run(CONFIGURE, ["--preflight", ...baseArgs], environment);
    assert.equal(preflight.status, 0, preflight.stderr);
    const parsed = JSON.parse(preflight.stdout);
    const governedReachable =
      parsed.inspection.governedStateTreeReachable === true;
    const modesEnforced = parsed.inspection.posixModesEnforced === true;
    if (!governedReachable || !modesEnforced) {
      assert.equal(
        parsed.deploymentEvidence,
        "NOT RUN",
        "a host that cannot reach the governed tree or enforce POSIX modes must record NOT RUN rather than a PASS that reads as deployment evidence",
      );
    } else {
      assert.equal(parsed.deploymentEvidence, "PASS");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-203: the verify PASS carries the same inspection record", () => {
  const root = temporaryDirectory();
  try {
    const { stateDir, environment, baseArgs } = provision(root);
    const verified = run(VERIFY, baseArgs, environment);
    assert.equal(verified.status, 0, verified.stderr);
    const parsed = JSON.parse(verified.stdout);
    assert.equal(parsed.static, "PASS");
    assert.ok(
      parsed.inspection,
      "the verify PASS must carry an inspection record",
    );
    assert.equal(
      parsed.inspection.stateTree,
      stateDir,
      "the record must name the tree the run actually inspected",
    );
    assert.equal(
      parsed.inspection.posixModesEnforced,
      process.platform !== "win32",
      "the record must state whether the host enforces POSIX modes",
    );
    assert.equal(
      parsed.inspection.governedStateTree,
      GOVERNED_STATE_TREE,
      "the record must name the governed tree",
    );
    if (
      parsed.inspection.governedStateTreeReachable !== true ||
      parsed.inspection.posixModesEnforced !== true
    ) {
      assert.equal(
        parsed.deploymentEvidence,
        "NOT RUN",
        "a host that cannot reach the governed tree or enforce POSIX modes must record NOT RUN",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-203: the apply record names the inspected tree too", () => {
  const root = temporaryDirectory();
  try {
    const { stateDir, environment, baseArgs } = provision(root);
    const applied = run(
      CONFIGURE,
      [
        "--apply",
        "--apply-transaction",
        takeTransaction(stateDir, "e"),
        ...baseArgs,
      ],
      environment,
    );
    assert.equal(applied.status, 0, applied.stderr);
    const parsed = JSON.parse(applied.stdout);
    assert.ok(parsed.inspection, "the apply must carry an inspection record");
    assert.equal(parsed.inspection.stateTree, stateDir);
    assert.equal(
      parsed.inspection.posixModesEnforced,
      process.platform !== "win32",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
