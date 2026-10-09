import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createGovernanceGuard,
  whenGovernanceDependenciesReady,
} from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  registerNativeGuard,
  selfNativeQuota,
  resolveNativeRunModel,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import { publishNativeQuota } from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { MODEL_ALLOWLIST } from "../integrations/openclaw/lib/policy.mjs";
import { RESOLUTION_REASON } from "../integrations/openclaw/lib/quota-telemetry.mjs";

/** A governed task with o1 running under a real session/run identity. */
function seedGovernedRun(paths) {
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "d".repeat(64),
    origin_message_id: "97000000000000001",
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: [
      {
        node_id: "o1",
        agent_id: "o1",
        stack_id: "data_plant",
        dependencies: [],
        required: true,
        input_digest: canonicalHash("zink-input-v1", "w"),
        constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
        validation_digest: canonicalHash(
          "zink-validation-v1",
          "agent-result-payload.schema.json",
        ),
      },
    ],
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: taskId,
    agent_id: "main",
  });
  const spawn = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "o1",
    agent_id: "o1",
    parent_agent_id: "main",
    parent_session_key: "main-session",
    parent_run_id: "main-run",
    tool_call_id: "call-0",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("o1"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spawn);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: spawn.delegation_id,
    native_run_id: "o1-r",
    child_session_key: "o1-s",
    agent_id: "o1",
    parent_session_key: "main-session",
  });
  return taskId;
}

/**
 * T2 host-facing quota seam.
 *
 * Before this, the quota store could never be populated on the live path:
 * `recordNativeQuota` was exported from the native boundary and materialized
 * into the deployed plugin tree, but the plugin never imported it, so the host
 * had no way in. `selfNativeQuota` therefore always answered "unknown" and the
 * owner-approved T3 run-scoped model fallback could never fire — the feature
 * worked only in tests.
 */

function hostConfig(ledgerRoot) {
  return {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot },
        },
      },
    },
  };
}

describe("T2 — the host has a way to publish quota", () => {
  it("a published snapshot is visible to the reader that resolves the model", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "lane-quota-seam-"));
    let unregister;
    try {
      const paths = ledgerPaths(root);
      seedGovernedRun(paths);
      const guard = createGovernanceGuard({
        paths,
        manifestFor: () => ({
          expected_governance_hash: "a".repeat(64),
          observed_governance_hash: "a".repeat(64),
          allowed_tools: [],
        }),
      });
      unregister = registerNativeGuard(root, guard);
      await whenGovernanceDependenciesReady();
      const context = { agentId: "o1", sessionKey: "o1-s", runId: "o1-r" };

      // Before any publication the receipt is honest about knowing nothing,
      // and the resolver keeps the primary model.
      const unknown = (await selfNativeQuota(hostConfig(root), context))
        ?.quota_self_read;
      assert.equal(unknown?.status, "unknown");
      const kept = await resolveNativeRunModel(hostConfig(root), context);
      assert.equal(kept.reason, RESOLUTION_REASON.UNKNOWN_KEEP_PRIMARY);
      assert.equal(kept.model, MODEL_ALLOWLIST[0]);

      // The seam the host needs: publish one snapshot through the plugin's
      // exported entry point.
      const published = await publishNativeQuota(
        {
          agentId: "o1",
          provider: "google",
          model: MODEL_ALLOWLIST[0],
          remainingPct: 18,
          resetAt: new Date(Date.now() + 3_600_000).toISOString(),
          source: "canonical-provider-usage",
          observedAt: Date.now(),
        },
        { ledgerRoot: root },
      );
      assert.equal(published, true, "a well-formed snapshot must be recorded");

      // The reader now sees it — this is what was impossible before.
      const receipt = (await selfNativeQuota(hostConfig(root), context))
        ?.quota_self_read;
      assert.equal(receipt?.status, "fresh");
      assert.equal(receipt?.quota?.remaining_pct, 18);
      // 18% remaining is below the 20% fallback threshold, so the run-scoped
      // model fallback engages (R12 failover restoration). The T2 seam is
      // proven by the snapshot being VISIBLE and correctly valued to the
      // resolver; the T3 half is preserved in
      // tests/m7-t2-quota-telemetry.test.mjs.
      const resolved = await resolveNativeRunModel(hostConfig(root), context);
      assert.equal(
        resolved.model,
        MODEL_ALLOWLIST[1],
        "a published quota below the threshold must change the run model",
      );
      assert.equal(
        resolved.reason,
        RESOLUTION_REASON.PROACTIVE_FALLBACK,
        "a published quota below the threshold must engage the run-scoped fallback",
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the seam is agent-scoped and fails closed on a malformed publication", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "lane-quota-scope-"));
    let unregister;
    try {
      const paths = ledgerPaths(root);
      seedGovernedRun(paths);
      const guard = createGovernanceGuard({
        paths,
        manifestFor: () => ({
          expected_governance_hash: "a".repeat(64),
          observed_governance_hash: "a".repeat(64),
          allowed_tools: [],
        }),
      });
      unregister = registerNativeGuard(root, guard);
      await whenGovernanceDependenciesReady();
      const { selfNativeQuota } =
        await import("../integrations/openclaw/topology/lib/native-boundary.mjs");
      const context = { agentId: "o2", sessionKey: "o2-s", runId: "o2-r" };

      // Publishing for o1 must be invisible to o2.
      await publishNativeQuota(
        {
          agentId: "o1",
          provider: "google",
          model: MODEL_ALLOWLIST[0],
          remainingPct: 50,
          resetAt: new Date(Date.now() + 3_600_000).toISOString(),
          source: "canonical-provider-usage",
          observedAt: Date.now(),
        },
        { ledgerRoot: root },
      );
      assert.equal(
        (await selfNativeQuota(hostConfig(root), context))?.quota_self_read
          ?.status,
        "unknown",
        "quota must never leak between agents",
      );

      // A malformed publication is not evidence, and never throws at the host.
      for (const bad of [
        { agentId: "o2" },
        { agentId: "o2", remainingPct: "lots" },
        { agentId: "not-an-agent", remainingPct: 10 },
        { remainingPct: 10 },
        null,
      ]) {
        assert.equal(
          await publishNativeQuota(bad, { ledgerRoot: root }),
          false,
          `a malformed publication must be refused: ${JSON.stringify(bad)}`,
        );
      }
      // After the refusals, o2 still has no quota: nothing was invented.
      assert.equal(
        (await selfNativeQuota(hostConfig(root), context))?.quota_self_read
          ?.status,
        "unknown",
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the plugin gives the host a way in, and absence stays a non-permit", async () => {
    // Structural fact behind the fix: the plugin now imports the recorder, so
    // the host surface is not structurally impossible any more. And when nothing
    // is published, the model resolution still keeps PRIMARY — the seam being
    // open does not make absent evidence permissive.
    const source = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.ok(
      /import\s*\{[^}]*\brecordNativeQuota\b[^}]*\}\s*from\s*"[^"]*native-boundary\.mjs"/su.test(
        source,
      ),
      "the plugin must import recordNativeQuota so the host can publish usage",
    );
    const root = mkdtempSync(path.join(os.tmpdir(), "lane-quota-absent-"));
    let unregister;
    try {
      const paths = ledgerPaths(root);
      seedGovernedRun(paths);
      const guard = createGovernanceGuard({
        paths,
        manifestFor: () => ({
          expected_governance_hash: "a".repeat(64),
          observed_governance_hash: "a".repeat(64),
          allowed_tools: [],
        }),
      });
      unregister = registerNativeGuard(root, guard);
      await whenGovernanceDependenciesReady();
      const { resolveNativeRunModel } =
        await import("../integrations/openclaw/topology/lib/native-boundary.mjs");
      const resolved = await resolveNativeRunModel(hostConfig(root), {
        agentId: "o1",
        sessionKey: "o1-s",
        runId: "o1-r",
      });
      assert.equal(
        resolved.reason,
        RESOLUTION_REASON.UNKNOWN_KEEP_PRIMARY,
        "with no published usage the run model must stay PRIMARY",
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
