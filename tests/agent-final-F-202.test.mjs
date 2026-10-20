// M12/T9 F-202 (legacy R1-A05-04): the systemd drop-in ceiling was asserted
// against ONE filename.
//
// `renderSystemdDropIn` puts `MemoryMax=768M` in `10-zink.conf`, but systemd
// reads EVERY `*.conf` fragment in `openclaw-gateway-zink.service.d/` in
// lexical order and a later fragment wins every single-valued assignment. A
// sibling `20-override.conf` therefore raises the ceiling above 768M, removes
// it, or injects an `ExecStart=` - while preflight, apply and verify all
// compared only `10-zink.conf` and printed PASS.
//
// Acceptance criteria: "Preflight, apply and verify enforce the ceiling
// against the effective drop-in set instead of one filename: they enumerate
// `openclaw-gateway-zink.service.d/` and fail or report drift on any fragment
// other than the rendered `10-zink.conf`, so no sibling `20-*.conf` can raise
// or remove `MemoryMax=768M` or inject `ExecStart` while the gates still
// print PASS."
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  return mkdtempSync(path.join(tmpdir(), "agent-final-f202-"));
}

function environmentForTemporaryHome(root) {
  // The router endpoint is baked into the generated config at apply time
  // (M10/T2-R9), so the fixture supplies the shared non-routable placeholders.
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

// A transaction the orchestration took: the builder apply may be spent only
// once, so every apply in this file takes its own.
function takeTransaction(stateDir, seed = "b") {
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
  // The builder apply is bound to the transaction the orchestration took
  // (F-111), so the fixture takes one before it applies.
  const attemptId = takeTransaction(stateDir);
  const applied = run(
    CONFIGURE,
    ["--apply", "--apply-transaction", attemptId, ...baseArgs],
    environment,
  );
  assert.equal(
    applied.status,
    0,
    `the apply must succeed on a clean tree: ${applied.stderr}`,
  );
  const dropInDirectory = path.join(
    systemdUserDir,
    "openclaw-gateway-zink.service.d",
  );
  assert.equal(
    existsSync(path.join(dropInDirectory, "10-zink.conf")),
    true,
    "the apply must render the owned drop-in",
  );
  return { stateDir, systemdUserDir, environment, baseArgs, dropInDirectory };
}

test("F-202: a sibling drop-in fragment refuses preflight, apply and verify", () => {
  const root = temporaryDirectory();
  try {
    const { environment, baseArgs, dropInDirectory } = provision(root);
    // The sibling that wins the single-valued assignment under systemd's
    // lexical drop-in order.
    writeFileSync(
      path.join(dropInDirectory, "20-override.conf"),
      "[Service]\nMemoryMax=infinity\nExecStart=/usr/bin/false\n",
      "utf8",
    );

    const preflight = run(CONFIGURE, ["--preflight", ...baseArgs], environment);
    assert.notEqual(
      preflight.status,
      0,
      "the preflight must refuse an unowned sibling drop-in",
    );
    assert.match(
      preflight.stderr,
      /Systemd drop-in drift detected/u,
      "the refusal must name the drop-in drift",
    );
    assert.match(
      preflight.stderr,
      /20-override\.conf/u,
      "the refusal must name the offending fragment",
    );
    assert.doesNotMatch(
      preflight.stdout,
      /"preflight":\s*"PASS"/u,
      "the preflight must not print PASS while a sibling fragment stands",
    );

    const apply = run(
      CONFIGURE,
      [
        "--apply",
        "--apply-transaction",
        takeTransaction(path.join(root, ".openclaw-zink"), "c"),
        ...baseArgs,
      ],
      environment,
    );
    assert.notEqual(
      apply.status,
      0,
      "the apply must refuse an unowned sibling drop-in",
    );
    assert.match(
      apply.stderr,
      /20-override\.conf/u,
      "the apply refusal must name the offending fragment",
    );

    const verified = run(VERIFY, baseArgs, environment);
    assert.notEqual(
      verified.status,
      0,
      "verify must refuse an unowned sibling drop-in",
    );
    assert.match(
      verified.stderr,
      /20-override\.conf/u,
      "the verify refusal must name the offending fragment",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-202: the owned drop-in alone leaves every gate green", () => {
  const root = temporaryDirectory();
  try {
    const { environment, baseArgs, dropInDirectory } = provision(root);
    const preflight = run(CONFIGURE, ["--preflight", ...baseArgs], environment);
    assert.equal(
      preflight.status,
      0,
      `the preflight must pass on an owned tree: ${preflight.stderr}`,
    );
    assert.match(preflight.stdout, /"preflight":\s*"PASS"/u);
    const verified = run(VERIFY, baseArgs, environment);
    assert.equal(
      verified.status,
      0,
      `verify must pass on an owned tree: ${verified.stderr}`,
    );
    assert.match(verified.stdout, /"static":\s*"PASS"/u);
    // The owned drop-in is the ONLY fragment the directory may carry.
    assert.deepEqual(readdirSync(dropInDirectory).sort(), ["10-zink.conf"]);
    assert.match(
      readFileSync(path.join(dropInDirectory, "10-zink.conf"), "utf8"),
      /MemoryMax=768M/u,
      "the owned drop-in still carries the ceiling",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-202: the refusal is a named drop-in drift, not a bare error", () => {
  const root = temporaryDirectory();
  try {
    const { environment, baseArgs, dropInDirectory } = provision(root);
    mkdirSync(path.join(dropInDirectory, "30-extra.conf"), { recursive: true });
    const preflight = run(CONFIGURE, ["--preflight", ...baseArgs], environment);
    assert.notEqual(preflight.status, 0);
    assert.match(preflight.stderr, /30-extra\.conf/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
