// M12/T9 F-040 (R1-A03-03): `handleExecutionFinished` reads and hashes an
// artifact path with only OPTIONAL containment.
//
// The seam computes `effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null`
// and, when neither is supplied, `artifact-validator.mjs` puts BOTH the
// symlink-escape check and the sandbox-containment check behind `if (sandboxDir)`.
// The bytes are therefore read, hashed and RECORDED with no containment proven
// at all, and an absolute host path outside any governed root is accepted.
//
// The lane below is RED at HEAD and stays red until the PLUGIN agent lands the
// seam fix (`integrations/openclaw/plugins/zink-governance/index.mjs` owns
// `handleExecutionFinished`; the library cannot refuse here without
// contradicting the pinned `validateTechnicalArtifact` contract, which
// `tests/m8-t2-governed-runtime-audit.test.mjs` calls without a sandbox).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { handleExecutionFinished } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const CSV = "date,revenue\n2026-01-01,1000";
const TECH = { expectedType: "csv", expectedFields: ["date", "revenue"] };
const BIZ = { revenue: 1000 };
const BIZCFG = { kpiConstraints: { revenue: { min: 500 } } };

test("F-040: an artifact with no containment boundary is refused at the seam", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "f040-"));
  try {
    const queueManager = new QueueManager({
      storagePath: path.join(dir, "queue.json"),
    });
    queueManager.enqueueTask({ taskId: "t-outside", primaryCoordinator: "o1" });
    // The task is CLAIMED first, so the only thing that can fail the seam is
    // the artifact gate itself.
    const { leaseId, task } = queueManager.claimTaskById({
      taskId: "t-outside",
      agentId: "o1",
    });
    // An artifact OUTSIDE the fixture root, with no sandbox supplied at all.
    const outside = path.join(dir, "..", `f040-outside-${Date.now()}.csv`);
    writeFileSync(outside, CSV, "utf8");
    try {
      const res = handleExecutionFinished({
        taskId: "t-outside",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        artifacts: [outside],
        technicalConfig: TECH,
        businessData: BIZ,
        businessConfig: BIZCFG,
        queueManager,
      });
      assert.equal(
        res.status,
        "FAILED",
        "an artifact with no proven containment must be refused",
      );
      assert.equal(
        res.gateResult?.technical?.sha256 ?? null,
        null,
        "the refused artifact's bytes must not be read and hashed",
      );
    } finally {
      rmSync(outside, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
