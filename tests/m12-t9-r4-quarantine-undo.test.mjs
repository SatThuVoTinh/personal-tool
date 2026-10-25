// M12/T9 F-421 (legacy R9-L03-6): quarantine prechecked every destination and
// then performed N independent renames with no undo, so a failure on the
// second rename left the first tree quarantined and the rest live — the
// docblock's all-or-nothing claim was false.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  quarantineDisplacedPluginTrees,
  runtimeBackupPath,
} from "../integrations/openclaw/topology/lib/runtime-backup.mjs";

const PLUGIN_ID = "zink-governance";

function displacedTree(stateDir, name) {
  const directory = path.join(stateDir, "extensions", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "openclaw.plugin.json"),
    JSON.stringify({ id: PLUGIN_ID, name }),
  );
  return directory;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r4-quarantine-"));
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const dispose = () => fs.rmSync(root, { recursive: true, force: true });
  return { stateDir, dispose };
}

describe("M12/T9 F-421 - quarantine is all-or-nothing above one tree", () => {
  it("a forced second-rename failure leaves every tree where it was", () => {
    const rt = fixture();
    try {
      const first = displacedTree(rt.stateDir, "zink-governance-a-20260101");
      const second = displacedTree(rt.stateDir, "zink-governance-b-20260202");
      let calls = 0;
      const rename = (...args) => {
        calls += 1;
        if (calls === 2) {
          const error = new Error("simulated rename failure");
          error.code = "EPERM";
          throw error;
        }
        fs.renameSync(...args);
      };

      assert.throws(
        () =>
          quarantineDisplacedPluginTrees(rt.stateDir, PLUGIN_ID, { rename }),
        { code: "EPERM" },
      );
      assert.equal(
        fs.existsSync(first),
        true,
        "the first tree must be restored",
      );
      assert.equal(
        fs.existsSync(second),
        true,
        "the failing tree was never moved",
      );
      assert.deepEqual(
        fs.readdirSync(path.join(rt.stateDir, "extensions")).sort(),
        [path.basename(first), path.basename(second)].sort(),
        "the scanned directory must be exactly as it was",
      );
    } finally {
      rt.dispose();
    }
  });

  it("the normal path still moves every displaced tree", () => {
    const rt = fixture();
    try {
      const first = displacedTree(rt.stateDir, "zink-governance-a-20260101");
      const second = displacedTree(rt.stateDir, "zink-governance-b-20260202");
      const moved = quarantineDisplacedPluginTrees(rt.stateDir, PLUGIN_ID);
      assert.equal(moved.length, 2);
      assert.deepEqual(
        fs.readdirSync(path.join(rt.stateDir, "extensions")).sort(),
        [],
        "no displaced tree may stay in the scanned directory",
      );
      const quarantine = path.join(
        runtimeBackupPath(rt.stateDir),
        "quarantined-t2",
        "extensions",
      );
      assert.deepEqual(
        fs.readdirSync(quarantine).sort(),
        [path.basename(first), path.basename(second)].sort(),
      );
    } finally {
      rt.dispose();
    }
  });
});
