// F-111 (R1-A15-02) -- the builder apply is bound to the transaction the
// apply orchestration took, and a transaction may be spent only once.
//
// The bare `--apply` reached the builder with no snapshot, no native patch, no
// byte verification and no gateway restart, and the "exactly one apply per
// grant" rule had no tool support at all: nothing recorded that a grant had
// been spent.
//
// The transaction attempt IS the grant now:
//
//   - the builder refuses `--apply` without `--apply-transaction <id>`;
//   - the apply marks the transaction consumed, so a second `--apply` against
//     the same transaction is refused; and
//   - the orchestration passes the transaction it took to the builder.
//
// The README half of the finding (the deploy block must name the entrypoint
// the orchestration uses and advertise `--preflight`) is a documentation
// change outside this agent's write scope and is handed off.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertBuilderApplyAvailable,
  markBuilderApplyConsumed,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const ATTEMPT_ID = `txn-${"a".repeat(64)}`;

function runConfigure(args) {
  return spawnSync(process.execPath, [CONFIGURE, ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 60000,
  });
}

test("F-111: the builder refuses --apply without the transaction", () => {
  const result = runConfigure(["--apply"]);
  assert.equal(result.status, 1, "the builder must refuse the bare apply");
  assert.ok(
    result.stderr.includes("APPLY_REQUIRES_TRANSACTION"),
    `the refusal must name the missing transaction: ${result.stderr}`,
  );
});

test("F-111: the builder accepts the transaction argument", () => {
  const elsewhere = path.resolve(os.tmpdir(), "zink-f111-nowhere");
  const result = runConfigure([
    "--apply",
    "--apply-transaction",
    ATTEMPT_ID,
    "--state-dir",
    elsewhere,
  ]);
  assert.equal(result.status, 1);
  assert.ok(
    !result.stderr.includes("APPLY_REQUIRES_TRANSACTION"),
    "the transaction argument must be accepted by the builder",
  );
  assert.ok(
    result.stderr.includes("OpenClaw state directory must be"),
    `the builder must stop at the state-directory check: ${result.stderr}`,
  );
});

test("F-111: a transaction may be spent only once", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f111-"));
  try {
    const stateDir = path.join(root, "state");
    const directory = path.join(
      stateDir,
      "operator",
      "m7-t2",
      "transactions",
      ATTEMPT_ID,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "transaction.json"),
      `${JSON.stringify({ attemptId: ATTEMPT_ID })}\n`,
      "utf8",
    );
    assert.doesNotThrow(() =>
      assertBuilderApplyAvailable(stateDir, ATTEMPT_ID),
    );
    markBuilderApplyConsumed(stateDir, ATTEMPT_ID);
    assert.throws(
      () => assertBuilderApplyAvailable(stateDir, ATTEMPT_ID),
      { message: /APPLY_ALREADY_SPENT/u },
      "a second apply against the same transaction must be refused",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-111: a transaction that does not exist is refused", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f111-missing-"));
  try {
    assert.throws(
      () => assertBuilderApplyAvailable(path.join(root, "state"), ATTEMPT_ID),
      { message: /TRANSACTION_NOT_FOUND/u },
      "the builder must refuse a transaction the orchestration never took",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-111: the apply orchestration passes the transaction to the builder", () => {
  const source = readFileSync(
    path.join(
      REPO,
      "integrations",
      "openclaw",
      "topology",
      "fixtures",
      "runtime-regression",
      "apply-orchestration.mjs",
    ),
    "utf8",
  );
  assert.ok(
    source.includes(
      'deps.runBuilder("--apply", identifiers, transaction?.attemptId',
    ),
    "the orchestration must hand the builder the transaction it took",
  );
  const stages = source.match(/"[a-z-]+",/gu) ?? [];
  for (const stage of [
    "transaction-snapshot",
    "builder-apply",
    "native-patch",
    "native-verify",
    "gateway-restart",
  ]) {
    assert.ok(
      stages.includes(`"${stage}",`),
      `the orchestration must keep the ${stage} stage`,
    );
  }
});
