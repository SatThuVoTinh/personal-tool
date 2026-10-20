// F-219 (R5-E14-02) -- every tracked executable under the runtime-regression
// fixtures is invoked by a NAMED gate.
//
// Six tracked executables read like supported probes but could never fail in
// CI: nothing invoked them, so their drift went undetected. They were also
// further instances of the machine-specific state root.
//
// This lane is the named gate for the fixtures that no package script names:
// it SPAWNS each one with a scrubbed environment and no operator input, and
// requires a deterministic, side-effect-free outcome -- a probe that runs
// without its input must refuse, and it must not leak a machine path.
//
// The machine-specific STATE ROOT is gone from the fixtures: the operator
// drivers and the probes now take it from the environment or the first
// argument and refuse without one, exactly like the live governance probe
// already did. The one remaining literal is the deliberate production-root
// GUARD in that probe, which is a comparison, not an input.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "fixtures",
);

function trackedFixtureScripts() {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs"))
        found.push(path.relative(REPO, full).split(path.sep).join("/"));
    }
  };
  walk(FIXTURES);
  return found.sort();
}

function packageScriptText() {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO, "package.json"), "utf8"),
  );
  return Object.values(manifest.scripts ?? {}).join("\n");
}

function workflowText() {
  const directory = path.join(REPO, ".github", "workflows");
  let text = "";
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    text += readFileSync(path.join(directory, entry), "utf8");
  }
  return text;
}

const FIXTURE_SCRIPTS = trackedFixtureScripts();
const SCRIPTS_TEXT = packageScriptText();
const WORKFLOWS_TEXT = workflowText();

// The fixtures this lane invokes. A fixture that a package script or a
// workflow step already names is NOT spawned here: that script IS its named
// gate.
const SPAWNED_BY_THIS_LANE = FIXTURE_SCRIPTS.filter(
  (relative) =>
    !SCRIPTS_TEXT.includes(path.basename(relative)) &&
    !WORKFLOWS_TEXT.includes(path.basename(relative)),
);

function namedByScriptOrWorkflow(relative) {
  const name = path.basename(relative);
  return SCRIPTS_TEXT.includes(name) || WORKFLOWS_TEXT.includes(name);
}

function scrubbedEnvironment(home) {
  const environment = { ...process.env };
  for (const key of [
    "ZINK_PROBE_STATE_DIR",
    "ZINK_OPERATOR_STATE_DIR",
    "ZINK_PRODUCTION_STATE_DIR",
  ])
    delete environment[key];
  environment.HOME = home;
  environment.USERPROFILE = home;
  return environment;
}

test("F-219: every tracked fixture executable is invoked by a named gate", () => {
  assert.ok(
    FIXTURE_SCRIPTS.length > 0,
    "the fixtures directory must not be empty",
  );
  for (const relative of FIXTURE_SCRIPTS) {
    const invoked =
      namedByScriptOrWorkflow(relative) ||
      SPAWNED_BY_THIS_LANE.includes(relative);
    assert.ok(
      invoked,
      `${relative} is tracked under the runtime-regression fixtures but no named gate invokes it, so its drift cannot fail anything`,
    );
  }
});

test("F-219: the package script gate names the rehearsal fixture", () => {
  const rehearsal = FIXTURE_SCRIPTS.find((relative) =>
    relative.endsWith("r16-rehearsal.mjs"),
  );
  assert.ok(rehearsal, "the rehearsal fixture must be tracked");
  assert.ok(
    namedByScriptOrWorkflow(rehearsal),
    "the rehearsal fixture must be named by a package script or a workflow step",
  );
});

test("F-219: no fixture source encodes the machine-specific state root", () => {
  // The live governance probe keeps ONE literal: the production root it
  // guards a write against. That is a comparison, never an input.
  const guard = "live-governance-probe.mjs";
  for (const relative of FIXTURE_SCRIPTS) {
    const source = readFileSync(path.join(REPO, relative), "utf8");
    const assignments = source.match(
      /=\s*"\/home\/hoang_vinh\/\.openclaw-zink"/gu,
    );
    if (!assignments) continue;
    assert.ok(
      relative.endsWith(guard),
      `${relative} must not assign the machine-specific state root; the operator names it`,
    );
    assert.equal(
      assignments.length,
      1,
      `${relative} may keep exactly one literal: the production-root guard`,
    );
  }
});

// The probes and drivers that take a state root MUST refuse without one, and
// they must name the refusal. The refusal is the fail-closed contract the
// machine-specific literal was replaced with.
const EXPECTED_REFUSALS = {
  "operator-token-probe.mjs": "PROBE_STATE_DIR_NOT_NAMED",
  "runtime-preflight.mjs": "RUNTIME_PREFLIGHT_STATE_DIR_NOT_NAMED",
  "live-governance-probe.mjs": "PROBE_STATE_DIR_NOT_NAMED",
  "operator-apply.mjs": "STATE_DIR_NOT_NAMED",
  "operator-preflight.mjs": "STATE_DIR_NOT_NAMED",
  "operator-rollback.mjs": "STATE_DIR_NOT_NAMED",
};

const OPERATOR_STATE_ROOT = "/home/hoang_vinh/.openclaw-zink";

test("F-219: every fixture this lane invokes refuses without operator input", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "zink-f219-home-"));
  const operatorRootExisted = existsSync(OPERATOR_STATE_ROOT);
  try {
    for (const relative of SPAWNED_BY_THIS_LANE) {
      const result = spawnSync(process.execPath, [relative], {
        cwd: REPO,
        env: scrubbedEnvironment(home),
        encoding: "utf8",
        timeout: 30000,
      });
      assert.notEqual(
        result.error?.code,
        "ETIMEDOUT",
        `${relative} must not hang when it is invoked without its input`,
      );
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      const machinePaths = [
        "/home/hoang_vinh",
        "/mnt/c/Users",
        "C:\\Users\\HOANG VINH",
      ];
      assert.ok(
        !machinePaths.some((needle) => output.includes(needle)),
        `${relative} must not print a machine-specific path`,
      );
      assert.ok(
        [0, 1, 2].includes(result.status),
        `${relative} must refuse or complete, never crash: exit ${result.status}`,
      );
      const name = path.basename(relative);
      const refusal = EXPECTED_REFUSALS[name];
      if (refusal) {
        assert.equal(
          result.status,
          2,
          `${relative} must refuse with exit 2 when no state root is named`,
        );
        assert.ok(
          output.includes(refusal),
          `${relative} must name the refusal (${refusal}), not fail silently`,
        );
      }
    }
    assert.equal(
      existsSync(OPERATOR_STATE_ROOT),
      operatorRootExisted,
      "no fixture may create or remove the operator's state root when it is invoked without its input",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
