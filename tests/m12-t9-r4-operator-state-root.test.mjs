// M12/T9-R4 lane L7 — the operator's named state root: precedence, disclosure
// and the refusal contract, for the rows F-489 (R9-L12-3), F-556 (R10-T07-1)
// and F-560 (R10-T07-6).
//
// What is pinned here:
//
//   F-489: `operator-lock-recovery.mjs` — the one mutating recovery the README
//   documents — resolves its root from the environment or the first argument
//   and refuses with `STATE_DIR_NOT_NAMED` (exit 2) when neither names one.
//   The homedir default is gone, and the root the operator names is the tree
//   the recovery actually inspects (and refuses to mutate unconfirmed).
//
//   F-556: the documented first-argument form of `operator-rollback.mjs`
//   reaches the recovery-authorization gate instead of being refused as
//   `UNSUPPORTED_ARGUMENT` by the strict flag parser.
//
//   F-560: in every mutating driver a TYPED argument outranks an inherited
//   `ZINK_OPERATOR_STATE_DIR`, and every record a driver prints discloses
//   `resolved_root_fingerprint` (a sha256 prefix of the resolved root, never
//   the path) and `state_root_source`. A driver that resolved a different
//   root than the one it names in its own output reddens this lane.
//
// The runs are refusal-path only: scratch state roots with no identifiers and
// no recovery authorization, so no driver reaches a builder child, a mutation
// or a real host. The `PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION` invariant
// is asserted for the rollback refusal path (installed_mutation:false and an
// untouched scratch tree).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The default is the live tree. The lane's red run points this at a pristine
// HEAD extraction (git archive) where the residue is absent, so the same
// expectations measure red against the committed bytes.
const FIXTURES =
  process.env.L7_FIXTURE_ROOT ??
  path.join(
    REPO,
    "integrations",
    "openclaw",
    "topology",
    "fixtures",
    "runtime-regression",
  );

const DRIVERS = {
  apply: "operator-apply.mjs",
  preflight: "operator-preflight.mjs",
  rollback: "operator-rollback.mjs",
  lockRecovery: "operator-lock-recovery.mjs",
};

function fingerprint(root) {
  return createHash("sha256")
    .update(path.resolve(root))
    .digest("hex")
    .slice(0, 16);
}

function scratch(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function driverEnv(home, extra = {}) {
  const env = { ...process.env, ...extra, HOME: home, USERPROFILE: home };
  if (!("ZINK_OPERATOR_STATE_DIR" in extra)) delete env.ZINK_OPERATOR_STATE_DIR;
  return env;
}

function runDriver(name, args = [], env = {}) {
  const home = env.HOME ?? scratch("l7-home-");
  const result = spawnSync(
    process.execPath,
    [path.join(FIXTURES, name), ...args],
    {
      cwd: REPO,
      encoding: "utf8",
      timeout: 30000,
      env: driverEnv(home, env),
    },
  );
  return result;
}

function firstRecord(stdout) {
  const line = String(stdout ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  assert.ok(line, `the driver must print one JSON record, got: ${stdout}`);
  return JSON.parse(line);
}

// `operator-rollback.mjs` resolves the installed Discord channel package at
// module scope (`nativeDiscordChannelRoot`), and a state root that carries no
// install refuses with NATIVE_DISCORD_CHANNEL_UNRESOLVED before any argument
// is read. Seed the minimal resolved install so the refusal-path runs reach
// the argument/authorization surface this lane pins. Scratch directories only.
function seedChannelInstall(root) {
  const packageRoot = path.join(
    root,
    "npm",
    "projects",
    "openclaw-discord-l7",
    "node_modules",
    "@openclaw",
    "discord",
  );
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@openclaw/discord", version: "0.0.0-test" }),
    "utf8",
  );
  return root;
}

// ---------------------------------------------------------------------------
// F-489 — operator-lock-recovery.mjs adopts the named-root contract.
// ---------------------------------------------------------------------------

test("F-489: lock recovery refuses with STATE_DIR_NOT_NAMED when no root is named", () => {
  const home = scratch("l7-f489-home-");
  try {
    const result = runDriver(DRIVERS.lockRecovery, [], { HOME: home });
    assert.equal(
      result.status,
      2,
      `a bare invocation must refuse with exit 2, got ${result.status}: ${result.stdout}${result.stderr}`,
    );
    assert.match(result.stderr, /STATE_DIR_NOT_NAMED/u);
    // The homedir default is gone: nothing was inspected or created under the
    // home the run was given.
    assert.equal(
      existsSync(path.join(home, ".openclaw-zink")),
      false,
      "the driver must not fall back to a homedir state root",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F-489: lock recovery resolves the positional root and the homedir default is removed", () => {
  const root = scratch("l7-f489-root-");
  try {
    const result = runDriver(DRIVERS.lockRecovery, [root]);
    assert.equal(result.status, 0, result.stderr);
    const record = firstRecord(result.stdout);
    assert.equal(record.state_dir, root);
    assert.equal(record.state_root_source, "argument");
    assert.equal(record.lock_present, false);
    assert.equal(record.mutated, false);
    const source = readFileSync(
      path.join(FIXTURES, DRIVERS.lockRecovery),
      "utf8",
    );
    assert.ok(
      !source.includes("os.homedir") && !source.includes("node:os"),
      "the driver source must not seed a root from the homedir any more",
    );
    assert.ok(
      !source.includes("Unknown argument") ||
        source.includes("resolveStateRoot"),
      "the named-root rule must be the shared one",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-489: lock recovery accepts the environment root and the --state-dir flag", () => {
  const envRoot = scratch("l7-f489-env-");
  const flagRoot = scratch("l7-f489-flag-");
  try {
    const fromEnv = runDriver(DRIVERS.lockRecovery, [], {
      ZINK_OPERATOR_STATE_DIR: envRoot,
    });
    assert.equal(fromEnv.status, 0, fromEnv.stderr);
    const envRecord = firstRecord(fromEnv.stdout);
    assert.equal(envRecord.state_dir, envRoot);
    assert.equal(envRecord.state_root_source, "environment");

    const fromFlag = runDriver(DRIVERS.lockRecovery, ["--state-dir", flagRoot]);
    assert.equal(fromFlag.status, 0, fromFlag.stderr);
    const flagRecord = firstRecord(fromFlag.stdout);
    assert.equal(flagRecord.state_dir, flagRoot);
    assert.equal(flagRecord.state_root_source, "flag");
  } finally {
    rmSync(envRoot, { recursive: true, force: true });
    rmSync(flagRoot, { recursive: true, force: true });
  }
});

test("F-489: the named root is the tree the recovery inspects, and it mutates nothing unconfirmed", () => {
  const root = scratch("l7-f489-lock-");
  try {
    // Seed an orphan-shaped lock whose holder is THIS test process, so the
    // driver's liveness proof refuses: the run must report, never remove.
    const lockDir = path.join(
      root,
      "operator",
      "m7-t2",
      "ledger",
      "writer.lock",
    );
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        token: "0123456789abcdef0123456789abcdef",
      }),
      "utf8",
    );
    const result = runDriver(DRIVERS.lockRecovery, [root, "--recover"]);
    const record = firstRecord(result.stdout);
    assert.equal(record.state_dir, root);
    assert.equal(
      record.lock_present,
      true,
      "the driver must inspect the lock under the root the operator named",
    );
    assert.equal(record.mutated, false);
    assert.equal(record.action, "REFUSED_LIVE_HOLDER");
    assert.equal(
      existsSync(lockDir),
      true,
      "a refused recovery must leave the lock directory untouched",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F-556 — the documented first-argument form of operator-rollback.mjs.
// ---------------------------------------------------------------------------

test("F-556: the documented positional root reaches the authorization gate, not UNSUPPORTED_ARGUMENT", () => {
  const root = seedChannelInstall(scratch("l7-f556-root-"));
  try {
    const result = runDriver(DRIVERS.rollback, [root]);
    assert.equal(result.status, 1, "an unauthorized recovery exits non-zero");
    assert.equal(result.stdout.trim().split("\n").length, 1);
    const record = firstRecord(result.stdout);
    assert.equal(record.status, "FAIL");
    assert.notEqual(
      record.reason,
      "UNSUPPORTED_ARGUMENT",
      "the documented form must not be refused by the strict flag parser",
    );
    assert.equal(record.reason, "RECOVERY_NOT_AUTHORIZED");
    assert.equal(record.action, "HISTORICAL_RECOVERY");
    assert.equal(record.isTransactionRollback, false);
    // Zero mutation: the refusal reports no write, no recovery authorization
    // was minted, and nothing was installed or quarantined under the root.
    assert.equal(record.installed_mutation, false);
    assert.equal(
      existsSync(path.join(root, "operator")),
      false,
      "a refused rollback must leave the named root untouched",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F-560 — typed-argument precedence and resolved-root disclosure.
// ---------------------------------------------------------------------------

test("F-560: a typed argument outranks an inherited ZINK_OPERATOR_STATE_DIR in every mutating driver", () => {
  // Both roots are seeded so a driver that resolved the WRONG one still runs
  // far enough to print its record — the divergence is then proven by the
  // fingerprint, not by a crash.
  const envRoot = seedChannelInstall(scratch("l7-f560-env-"));
  const argvRoot = seedChannelInstall(scratch("l7-f560-argv-"));
  try {
    const expected = fingerprint(argvRoot);
    for (const [name, file] of [
      ["rollback", DRIVERS.rollback],
      ["preflight", DRIVERS.preflight],
      ["apply", DRIVERS.apply],
    ]) {
      const result = runDriver(file, [argvRoot], {
        ZINK_OPERATOR_STATE_DIR: envRoot,
      });
      assert.equal(
        result.status,
        1,
        `${name}: a scratch root with no identifiers/authorization must fail closed, got ${result.status}: ${result.stdout}${result.stderr}`,
      );
      const record = firstRecord(result.stdout);
      assert.equal(
        record.resolved_root_fingerprint,
        expected,
        `${name}: the driver must resolve the root the operator TYPED, not the inherited environment value (record: ${result.stdout.trim()})`,
      );
      assert.equal(
        record.state_root_source,
        "argument",
        `${name}: the disclosure must name which input won`,
      );
      assert.equal(record.installed_mutation ?? false, false);
      assert.ok(
        !result.stdout.includes(argvRoot) && !result.stdout.includes(envRoot),
        `${name}: the report discloses the root by digest only, never by path`,
      );
    }
  } finally {
    rmSync(envRoot, { recursive: true, force: true });
    rmSync(argvRoot, { recursive: true, force: true });
  }
});

test("F-560: an environment-only root is disclosed as the environment source", () => {
  const envRoot = seedChannelInstall(scratch("l7-f560-envonly-"));
  try {
    const result = runDriver(DRIVERS.rollback, [], {
      ZINK_OPERATOR_STATE_DIR: envRoot,
    });
    assert.equal(result.status, 1);
    const record = firstRecord(result.stdout);
    assert.equal(record.reason, "RECOVERY_NOT_AUTHORIZED");
    assert.equal(record.resolved_root_fingerprint, fingerprint(envRoot));
    assert.equal(record.state_root_source, "environment");
  } finally {
    rmSync(envRoot, { recursive: true, force: true });
  }
});

test("F-560: the three mutating drivers still refuse with STATE_DIR_NOT_NAMED when nothing names a root", () => {
  for (const file of [DRIVERS.rollback, DRIVERS.preflight, DRIVERS.apply]) {
    const result = runDriver(file, [], { ZINK_OPERATOR_STATE_DIR: "" });
    assert.equal(result.status, 2, `${file} must refuse with exit 2`);
    assert.match(result.stderr, /STATE_DIR_NOT_NAMED/u);
  }
});

test("F-560: the shared rule — typed argument first, environment second, refusal third", async () => {
  const module = await import(
    pathToFileURL(path.join(FIXTURES, "operator-state-root.mjs")).href
  );
  const env = { ZINK_OPERATOR_STATE_DIR: "/from/env" };

  const typed = module.resolveStateRoot({
    argv: ["/from/argv", "--target=x"],
    env,
  });
  assert.equal(typed.stateDir, "/from/argv");
  assert.equal(typed.source, "argument");
  assert.deepEqual(typed.rest, ["--target=x"]);

  const fromEnv = module.resolveStateRoot({ argv: ["--recover"], env });
  assert.equal(fromEnv.stateDir, "/from/env");
  assert.equal(fromEnv.source, "environment");
  assert.deepEqual(fromEnv.rest, ["--recover"]);

  const named = module.resolveStateRoot({ argv: [], env: {} });
  assert.equal(named.stateDir, null);
  assert.equal(named.source, null);

  const blank = module.resolveStateRoot({
    argv: [],
    env: { ZINK_OPERATOR_STATE_DIR: "" },
  });
  assert.equal(blank.stateDir, null, "an empty export names nothing");

  // A value flag's value is never mistaken for the positional root: the
  // `--state-dir <path>` form itself belongs to the driver's own parser (the
  // F-489 spawn case pins it end to end), so the shared resolver skips both
  // the flag and its value and falls through to the next source.
  const flagValue = module.resolveStateRoot({
    argv: ["--state-dir", "/from/flag", "--recover"],
    env,
    valueFlags: ["--state-dir"],
  });
  assert.equal(
    flagValue.stateDir,
    "/from/env",
    "a value flag's value must not be read as the positional root",
  );
  assert.deepEqual(flagValue.rest, ["--state-dir", "/from/flag", "--recover"]);
  const flagValueNoEnv = module.resolveStateRoot({
    argv: ["--state-dir", "/from/flag"],
    env: {},
    valueFlags: ["--state-dir"],
  });
  assert.equal(flagValueNoEnv.stateDir, null);

  // The disclosure is a digest of the resolved root, never the path.
  const disclosure = module.rootDisclosure("/root/a", "argument");
  assert.match(disclosure.resolved_root_fingerprint, /^[0-9a-f]{16}$/u);
  assert.equal(
    disclosure.resolved_root_fingerprint,
    createHash("sha256")
      .update(path.resolve("/root/a"))
      .digest("hex")
      .slice(0, 16),
  );
  assert.equal(disclosure.state_root_source, "argument");
  assert.ok(
    !JSON.stringify(disclosure).includes("/root/a"),
    "the disclosure must not carry the path it digests",
  );
});

test("F-560/F-489: every operator driver binds the one shared named-root rule", () => {
  for (const file of Object.values(DRIVERS)) {
    const source = readFileSync(path.join(FIXTURES, file), "utf8");
    assert.ok(
      source.includes('from "./operator-state-root.mjs"'),
      `${file} must resolve its root through the shared named-root module`,
    );
    assert.ok(
      !source.includes("process.env.ZINK_OPERATOR_STATE_DIR ?? process.argv"),
      `${file} must not keep the env-outranks-argument precedence inline`,
    );
  }
});
