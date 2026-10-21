// M12/T9 F-373 — the operator's documented deploy path must name the state root.
//
// F-219 made the machine-specific state root an OPERATOR INPUT: the driver
// reads `ZINK_OPERATOR_STATE_DIR` or its first argument and refuses without
// one (`STATE_DIR_NOT_NAMED`). The README's deploy block was never updated to
// match, so the commands the owner is told to run STOPPED with that refusal:
// the preflight never ran, the apply never ran, and the operator was left
// reading `STATE_DIR_NOT_NAMED` twice with no indication that nothing was
// deployed.
//
// This lane pins the DOCUMENTED path, because the operator reads the document,
// not the driver:
//
//   1. every operator-driver invocation in the README and in the deploy
//      runbook NAMES the state root;
//   2. the README names it BEFORE the first invocation;
//   3. the driver still refuses without one - the refusal is the contract the
//      document has to satisfy, so it is asserted here too.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const README = readFileSync(path.join(REPO, "README.md"), "utf8");
const RUNBOOK = readFileSync(
  path.join(REPO, "docs", "runbooks", "deploying-the-m12-t9-build.md"),
  "utf8",
);

/** The operator drivers that refuse to run without a named state root. */
const DRIVERS = [
  "operator-preflight.mjs",
  "operator-apply.mjs",
  "operator-rollback.mjs",
];

function invocationLines(text) {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), at: index + 1 }))
    .filter((entry) => entry.line.startsWith("node "));
}

test("F-373: every operator-driver invocation in the operator documents names the state root", () => {
  for (const [name, text] of [
    ["README.md", README],
    ["docs/runbooks/deploying-the-m12-t9-build.md", RUNBOOK],
  ]) {
    const invocations = invocationLines(text).filter((entry) =>
      DRIVERS.some((driver) => entry.line.includes(driver)),
    );
    assert.ok(
      invocations.length > 0,
      `${name}: the operator documents must still show the deploy path`,
    );
    for (const entry of invocations) {
      assert.match(
        entry.line,
        /"\$ZINK_OPERATOR_STATE_DIR"|\$HOME\/\.openclaw-zink/u,
        `${name}:${entry.at}: "${entry.line}" does not name the state root — the driver refuses without one (STATE_DIR_NOT_NAMED), so this command deploys nothing`,
      );
    }
  }
});

test("F-373: the README names the state root before the first driver invocation", () => {
  const exported = README.split("\n").findIndex((line) =>
    line.startsWith("export ZINK_OPERATOR_STATE_DIR="),
  );
  const first = invocationLines(README).find((entry) =>
    DRIVERS.some((driver) => entry.line.includes(driver)),
  );
  assert.ok(first, "the README must show the deploy path");
  assert.ok(
    exported !== -1 && exported + 1 < first.at,
    "the README must export ZINK_OPERATOR_STATE_DIR before it invokes a driver",
  );
});

test("F-373: the driver still refuses without a named state root", () => {
  // The refusal is the reason the document has to name the root. If the driver
  // ever starts guessing a machine path again, this case fails and the
  // document's obligation is stated here rather than only in the README.
  const driver = path.join(
    REPO,
    "integrations",
    "openclaw",
    "topology",
    "fixtures",
    "runtime-regression",
    "operator-preflight.mjs",
  );
  const result = spawnSync(process.execPath, [driver], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ZINK_OPERATOR_STATE_DIR: "" },
  });
  assert.equal(result.status, 2, "the driver must refuse with exit 2");
  assert.match(
    result.stderr,
    /STATE_DIR_NOT_NAMED/u,
    "the refusal must name itself, so an operator can tell it from a failure",
  );
});
