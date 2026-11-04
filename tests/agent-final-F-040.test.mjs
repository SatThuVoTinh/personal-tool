// M12/T9 F-040 (legacy R1-A03-03): `handleExecutionFinished` read and hashed an
// artifact path with only OPTIONAL containment.
//
// The seam computed `effectiveSandbox = sandboxDir || technicalConfig.sandboxDir
// || null`, and `artifact-validator.mjs` puts BOTH its symlink-escape check and
// its sandbox-containment check behind `if (sandboxDir)`. With neither
// supplied, the bytes were read, hashed and RECORDED with no containment
// proven at all, and an absolute host path outside any governed root was
// accepted.
//
// Acceptance criteria: "an out-of-sandbox absolute artifact is refused at this
// seam." The refusal happens BEFORE the artifact is read or hashed, and it
// carries a named code.
//
// The library's own optional-sandbox contract is untouched: the refusal
// belongs to the plugin seam, not to `validateTechnicalArtifact`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import {
  artifactContainmentFailure,
  handleExecutionFinished,
  resolveArtifactBoundary,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const CSV = "date,revenue\n2026-01-01,1000";
const TECH = { expectedType: "csv", expectedFields: ["date", "revenue"] };
const BIZ = { revenue: 1000 };
const BIZCFG = { kpiConstraints: { revenue: { min: 500 } } };

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "agent-final-f040-"));
}

function claimed(queueManager, taskId) {
  queueManager.enqueueTask({ taskId, primaryCoordinator: "o1" });
  const claim = queueManager.claimTaskById({ taskId, agentId: "o1" });
  return { leaseId: claim.leaseId, attempt: claim.task.attempt };
}

test("F-040: an artifact outside the governed root is refused before it is read", () => {
  const dir = fixture();
  const outside = path.join(dir, "..", `f040-outside-${process.pid}.csv`);
  try {
    const queueManager = new QueueManager({
      storagePath: path.join(dir, "queue.json"),
    });
    const { leaseId, attempt } = claimed(queueManager, "t-outside");
    writeFileSync(outside, CSV, "utf8");
    const res = handleExecutionFinished({
      taskId: "t-outside",
      agentId: "o1",
      leaseId,
      attempt,
      artifacts: [outside],
      technicalConfig: TECH,
      businessData: BIZ,
      businessConfig: BIZCFG,
      queueManager,
    });
    assert.equal(
      res.status,
      "FAILED",
      "an uncontained artifact must be refused",
    );
    assert.match(
      res.error,
      /ARTIFACT_(OUTSIDE_SANDBOX|SANDBOX_UNSPECIFIED)/u,
      "the refusal must carry a named code",
    );
    assert.equal(
      res.artifactSet,
      undefined,
      "the refused artifact must never be hashed",
    );
    assert.equal(res.artifactSetDigest, undefined);
    assert.equal(
      res.gateResult,
      undefined,
      "the gate must not have run over the refused artifact",
    );
    assert.notEqual(
      queueManager.getTask("t-outside").status,
      "RESULT_PENDING_REVIEW",
      "nothing may reach the queue",
    );
  } finally {
    rmSync(outside, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-040: an artifact inside the governed root is still accepted", () => {
  const dir = fixture();
  try {
    const queueManager = new QueueManager({
      storagePath: path.join(dir, "queue.json"),
    });
    const { leaseId, attempt } = claimed(queueManager, "t-inside");
    const inside = path.join(dir, "inside.csv");
    writeFileSync(inside, CSV, "utf8");
    const res = handleExecutionFinished({
      taskId: "t-inside",
      agentId: "o1",
      leaseId,
      attempt,
      artifacts: [inside],
      technicalConfig: TECH,
      businessData: BIZ,
      businessConfig: BIZCFG,
      queueManager,
    });
    assert.equal(res.status, "READY_FOR_REVIEW");
    assert.equal(res.artifactSet.length, 1);
    assert.match(res.artifactSetDigest, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-040: a declared sandbox is the boundary, and an artifact outside it is refused", () => {
  const dir = fixture();
  try {
    const sandbox = path.join(dir, "sandbox");
    const queueManager = new QueueManager({
      storagePath: path.join(dir, "queue.json"),
    });
    const { leaseId, attempt } = claimed(queueManager, "t-sandbox");
    const outside = path.join(dir, "outside.csv");
    writeFileSync(outside, CSV, "utf8");
    const res = handleExecutionFinished({
      taskId: "t-sandbox",
      agentId: "o1",
      leaseId,
      attempt,
      artifacts: [outside],
      sandboxDir: sandbox,
      technicalConfig: TECH,
      businessData: BIZ,
      businessConfig: BIZCFG,
      queueManager,
    });
    assert.equal(res.status, "FAILED");
    assert.match(res.error, /ARTIFACT_OUTSIDE_SANDBOX/u);
    assert.equal(res.artifactSet, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-040: no boundary at all is a named refusal, not a silent pass", () => {
  const dir = fixture();
  try {
    const queueManager = new QueueManager({
      storagePath: path.join(dir, "queue.json"),
    });
    const { leaseId, attempt } = claimed(queueManager, "t-noboundary");
    const inside = path.join(dir, "inside.csv");
    writeFileSync(inside, CSV, "utf8");
    // A queue manager with no provable storage path leaves the seam with no
    // root it can prove, so the artifact is refused by name.
    const boundary = resolveArtifactBoundary({
      sandboxDir: null,
      queueManager: {
        get storagePath() {
          throw new Error("GOVERNED_STORE_ROOT_UNCONFIGURED");
        },
      },
    });
    assert.equal(boundary, null);
    assert.match(
      artifactContainmentFailure(inside, boundary),
      /ARTIFACT_SANDBOX_UNSPECIFIED/u,
      "an unprovable boundary must be a named refusal",
    );
    const res = handleExecutionFinished({
      taskId: "t-noboundary",
      agentId: "o1",
      leaseId,
      attempt,
      artifacts: [inside],
      technicalConfig: TECH,
      businessData: BIZ,
      businessConfig: BIZCFG,
      queueManager,
    });
    assert.equal(res.status, "READY_FOR_REVIEW");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
