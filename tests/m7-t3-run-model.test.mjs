import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  registerNativeGuard,
  recordNativeQuota,
  selfNativeQuota,
  resolveNativeRunModel,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  governanceManifest,
  governanceHash,
  MODEL_ALLOWLIST,
  AGENT_IDS,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  QUOTA_FALLBACK_THRESHOLD_PCT,
  QUOTA_FRESHNESS_MS,
} from "../integrations/openclaw/lib/quota-telemetry.mjs";

function manifestForAgent(id) {
  return {
    allowed_tools: governanceManifest(id).effective_tool_policy,
    expected_governance_hash: governanceHash(id),
    observed_governance_hash: governanceHash(id),
  };
}

function makeRoot(agentId, originMessageId) {
  const root = mkdtempSync(path.join(os.tmpdir(), "t3-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: originMessageId,
  };
  const taskId = deriveTaskId(origin);
  const sessionKey = `agent:${agentId}:sess`;
  const runId = "run-1";
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: agentId,
    root_session_key: sessionKey,
    root_run_id: runId,
  });
  return { root, paths, taskId, sessionKey, runId };
}

function nativeConfig(root) {
  return {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot: root },
        },
      },
    },
  };
}

function usageSnapshot(agentId, remainingPct, observedAt) {
  return {
    agentId,
    provider: "google",
    model: MODEL_ALLOWLIST[0],
    remainingPct,
    resetAt: new Date(observedAt + 3_600_000).toISOString(),
    source: "canonical-provider-usage",
    observedAt,
  };
}

function ledgerBytes(paths) {
  return {
    events: readFileSync(paths.events, "utf8"),
    snapshot: readFileSync(paths.snapshot, "utf8"),
  };
}

/** Recursively list files with their bytes, for restart/persistence proof. */
function treeSnapshot(dir) {
  const out = {};
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out[rel] = readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

describe("T3 — run-scoped model resolution (no session override)", () => {
  it("guard exposes quota publication, self receipt and run resolution", async () => {
    const { root, sessionKey, runId } = makeRoot("o1", "92345678901234567");
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths: ledgerPaths(root),
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);

      // No telemetry yet -> PRIMARY.
      const before = await resolveNativeRunModel(config, {
        agentId: "o1",
        sessionKey,
        runId,
      });
      assert.equal(before.model, MODEL_ALLOWLIST[0]);

      // Host publishes low quota for o1 only.
      assert.equal(
        await recordNativeQuota(config, usageSnapshot("o1", 5, Date.now())),
        true,
      );

      const after = await resolveNativeRunModel(config, {
        agentId: "o1",
        sessionKey,
        runId,
      });
      // M10/T2-R12: failover restored — low quota moves to the fallback.
      assert.equal(after.model, MODEL_ALLOWLIST[1]);
      assert.equal(after.run_scoped, true);
      assert.equal(after.session_override, false);
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST E/J: resolution never mutates ledger, queue or session state", async () => {
    const { root, paths, sessionKey, runId } = makeRoot(
      "python",
      "10234567890123456",
    );
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);
      await recordNativeQuota(config, usageSnapshot("python", 3, Date.now()));

      const ledgerBefore = ledgerBytes(paths);
      const treeBefore = treeSnapshot(root);

      const result = await resolveNativeRunModel(config, {
        agentId: "python",
        sessionKey,
        runId,
      });
      // M10/T2-R12: failover restored — low quota moves to the fallback.
      assert.equal(result.model, MODEL_ALLOWLIST[1]);

      const ledgerAfter = ledgerBytes(paths);
      assert.deepEqual(
        ledgerAfter,
        ledgerBefore,
        "ledger must be byte-identical",
      );
      const treeAfter = treeSnapshot(root);
      assert.deepEqual(
        Object.keys(treeAfter).sort(),
        Object.keys(treeBefore).sort(),
        "no new file may be created by resolution",
      );
      for (const [file, bytes] of Object.entries(treeBefore)) {
        assert.equal(treeAfter[file], bytes, `${file} must be byte-identical`);
      }
      // Explicit non-mutation of the canonical override concepts.
      for (const file of Object.values(treeAfter)) {
        for (const forbidden of [
          "modelOverride",
          "model_override",
          "modelOverrideSource",
        ]) {
          assert.equal(
            file.includes(forbidden),
            false,
            `no artifact may contain ${forbidden}`,
          );
        }
      }
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST J: restart does not pin the fallback model into the session", async () => {
    const { root, paths, sessionKey, runId } = makeRoot(
      "sql",
      "11234567890123456",
    );
    let unregister;
    try {
      const first = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, first);
      const config = nativeConfig(root);
      await recordNativeQuota(config, usageSnapshot("sql", 2, Date.now()));
      const firstRun = await resolveNativeRunModel(config, {
        agentId: "sql",
        sessionKey,
        runId,
      });
      // M10/T2-R12: failover restored — low quota moves to the fallback.
      assert.equal(firstRun.model, MODEL_ALLOWLIST[1]);
      const afterFirst = ledgerBytes(paths);
      unregister?.();
      unregister = null;

      // Restart: a brand-new guard instance, i.e. reconstructed runtime.
      const second = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, second);
      // Ledger untouched by the restart and by the fallback.
      assert.deepEqual(ledgerBytes(paths), afterFirst);

      // Telemetry is process-local: after restart there is no snapshot, so the
      // resolver returns PRIMARY. The fallback did NOT survive as a session pin.
      const afterRestart = await resolveNativeRunModel(config, {
        agentId: "sql",
        sessionKey,
        runId,
      });
      assert.equal(
        afterRestart.model,
        MODEL_ALLOWLIST[0],
        "fallback must not persist across restart",
      );
      // And the task state is unchanged.
      assert.equal(
        readSnapshot(paths).sequence,
        JSON.parse(afterFirst.snapshot).sequence,
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST K: two parallel runs near the threshold resolve deterministically", async () => {
    const { root, paths, sessionKey, runId } = makeRoot(
      "power-bi",
      "12234567890123456",
    );
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);
      await recordNativeQuota(
        config,
        usageSnapshot("power-bi", QUOTA_FALLBACK_THRESHOLD_PCT, Date.now()),
      );
      const ledgerBefore = ledgerBytes(paths);
      const results = await Promise.all(
        Array.from({ length: 24 }, () =>
          Promise.resolve().then(() =>
            resolveNativeRunModel(config, {
              agentId: "power-bi",
              sessionKey,
              runId,
            }),
          ),
        ),
      );
      const models = new Set(results.map((r) => r.model));
      assert.equal(
        models.size,
        1,
        "resolution must be deterministic under race",
      );
      assert.deepEqual(ledgerBytes(paths), ledgerBefore);
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST F: resolution is refused for a session the caller does not own", async () => {
    const { root, paths, sessionKey, runId } = makeRoot(
      "o2",
      "13234567890123456",
    );
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);
      await recordNativeQuota(config, usageSnapshot("o2", 5, Date.now()));
      // A different agent claiming this session is a lineage mismatch.
      await assert.rejects(
        () =>
          resolveNativeRunModel(config, {
            agentId: "o1",
            sessionKey,
            runId,
          }),
        /LINEAGE_MISMATCH/,
      );
      // Unknown session cannot resolve anything.
      await assert.rejects(
        () =>
          resolveNativeRunModel(config, {
            agentId: "o2",
            sessionKey: "agent:o1:not-mine",
            runId: "run-x",
          }),
        /EXECUTION_STATE_UNKNOWN/,
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST I: self receipt is agent-scoped through the native boundary", async () => {
    const { root } = makeRoot("o1", "14234567890123456");
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths: ledgerPaths(root),
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);
      for (const [agentId, pct] of [
        ["o1", 90],
        ["o2", 40],
        ["python", 15],
      ]) {
        await recordNativeQuota(
          config,
          usageSnapshot(agentId, pct, Date.now()),
        );
      }
      for (const [agentId, expected] of [
        ["o1", 90],
        ["o2", 40],
        ["python", 15],
      ]) {
        const receipt = await selfNativeQuota(config, { agentId });
        assert.equal(receipt.quota_self_read.agent_id, agentId);
        assert.equal(receipt.quota_self_read.quota.remaining_pct, expected);
        // M12/T9 F-319: the previous check searched the serialised receipt for
        // the other agents' percentage in QUOTED form, but the field is
        // numeric in the producer and in the assertion two lines above, so
        // JSON never emits it quoted: the condition was unfalsifiable and a
        // reader widened with another agent's snapshot stayed green. The
        // receipt is now checked for the absence of the other agents BY
        // IDENTIFIER ? a form the data type can produce ? and for the absence
        // of any field a widened reader would have to add.
        const serialized = JSON.stringify(receipt);
        assert.deepEqual(
          Object.keys(receipt).sort(),
          ["quota_self_read"],
          "the receipt must carry the self-scope and nothing else",
        );
        assert.deepEqual(
          Object.keys(receipt.quota_self_read).sort(),
          ["agent_id", "health", "policy", "quota", "scope", "status"],
          "the self-read must carry exactly the published fields",
        );
        assert.deepEqual(
          Object.keys(receipt.quota_self_read.quota ?? {}).sort(),
          [
            "age_ms",
            "model",
            "observed_at",
            "provider",
            "remaining_pct",
            "reset_at",
            "source",
          ],
          "the quota block must carry exactly the published fields",
        );
        for (const other of ["o1", "o2", "python"].filter(
          (a) => a !== agentId,
        )) {
          assert.equal(
            serialized.includes(`"${other}"`),
            false,
            `${agentId} receipt must not expose ${other} quota`,
          );
        }
      }
      // A missing agentId is refused, not defaulted.
      await assert.rejects(
        () => selfNativeQuota(config, {}),
        /GOVERNANCE_CONTEXT_MISSING/,
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST D: stale quota keeps PRIMARY through the native boundary", async () => {
    const { root, sessionKey, runId } = makeRoot("o1", "15234567890123456");
    let unregister;
    try {
      const guard = createGovernanceGuard({
        paths: ledgerPaths(root),
        manifestFor: manifestForAgent,
      });
      unregister = registerNativeGuard(root, guard);
      const config = nativeConfig(root);
      await recordNativeQuota(
        config,
        usageSnapshot("o1", 5, Date.now() - QUOTA_FRESHNESS_MS - 60_000),
      );
      const result = await resolveNativeRunModel(config, {
        agentId: "o1",
        sessionKey,
        runId,
      });
      assert.equal(
        result.model,
        MODEL_ALLOWLIST[0],
        "stale quota keeps primary",
      );
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("every agent can resolve both models under its own quota", async () => {
    let snowflake = 70000000000000001n;
    for (const agentId of AGENT_IDS) {
      const originMessageId = String(snowflake++);
      const { root, sessionKey, runId } = makeRoot(agentId, originMessageId);
      let unregister;
      try {
        const guard = createGovernanceGuard({
          paths: ledgerPaths(root),
          manifestFor: manifestForAgent,
        });
        unregister = registerNativeGuard(root, guard);
        const config = nativeConfig(root);
        await recordNativeQuota(config, usageSnapshot(agentId, 95, Date.now()));
        assert.equal(
          (await resolveNativeRunModel(config, { agentId, sessionKey, runId }))
            .model,
          MODEL_ALLOWLIST[0],
          `${agentId} high quota -> primary`,
        );
        await recordNativeQuota(config, usageSnapshot(agentId, 5, Date.now()));
        assert.equal(
          (await resolveNativeRunModel(config, { agentId, sessionKey, runId }))
            .model,
          MODEL_ALLOWLIST[1],
          `${agentId} low quota -> fallback (R12 failover restoration)`,
        );
      } finally {
        unregister?.();
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
