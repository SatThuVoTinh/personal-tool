import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUILT_IN_TOOL_POLICY,
  isSessionStatusReadOnlyArgs,
  SESSION_MUTATION_TOOL_IDS,
  MODEL_ALLOWLIST,
  buildConfig,
  governanceManifest,
  governanceHash,
  effectiveOpenClawToolAllowlist,
} from "../integrations/openclaw/lib/policy.mjs";

function manifestForAgent(id) {
  return {
    allowed_tools: governanceManifest(id).effective_tool_policy,
    expected_governance_hash: governanceHash(id),
    observed_governance_hash: governanceHash(id),
  };
}
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";

// M10/T2-R9: the governed model provider resolves its endpoint and
// credential from the environment at build time; supply non-routable
// placeholders so this suite can assert config SHAPE only.
applyRouterTestEnv();

const AGENTS = ["main", "o1", "o2", "excel", "power-bi", "sql", "python"];
const SPECIALISTS = ["o1", "o2", "excel", "power-bi", "sql", "python"];

const IDENTIFIERS = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

function makeTask(root, { agentId, sessionKey, runId, originMessageId }) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: originMessageId,
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: agentId,
    root_session_key: sessionKey,
    root_run_id: runId,
  });
  return { paths, taskId };
}

describe("T1 — session-control authority", () => {
  it("policy grants session_status to main only", () => {
    assert.ok(BUILT_IN_TOOL_POLICY.main.includes("session_status"));
    for (const agent of SPECIALISTS) {
      assert.equal(
        BUILT_IN_TOOL_POLICY[agent].includes("session_status"),
        false,
        `${agent} must not hold session_status`,
      );
    }
  });

  it("runtime config, manifest and projection all agree", () => {
    const config = buildConfig({
      stateDir: "C:/state",
      identifiers: IDENTIFIERS,
    });
    for (const agent of AGENTS) {
      const manifestTools = governanceManifest(agent).effective_tool_policy;
      assert.deepEqual(
        [...manifestTools].sort(),
        [...BUILT_IN_TOOL_POLICY[agent]].sort(),
        `${agent} manifest must equal canonical policy`,
      );
      assert.deepEqual(
        [...effectiveOpenClawToolAllowlist(agent)].sort(),
        [...BUILT_IN_TOOL_POLICY[agent]].sort(),
        `${agent} runtime allowlist must equal canonical policy`,
      );
    }
    // Config must not re-grant session_status to a specialist.
    for (const agent of config.agents.list) {
      const alsoAllow = agent.tools.alsoAllow ?? [];
      if (agent.id !== "main") {
        assert.equal(
          [...alsoAllow].includes("session_status"),
          false,
          `${agent.id} config alsoAllow must not contain session_status`,
        );
      }
    }
    // Main keeps it.
    const mainEntry = config.agents.list.find((a) => a.id === "main");
    assert.ok(mainEntry.tools.alsoAllow.includes("session_status"));
  });

  it("session mutation is declared as a non-grantable capability", () => {
    assert.ok(SESSION_MUTATION_TOOL_IDS.includes("session_status"));
  });

  it("session_status argument classifier rejects every mutation vector", () => {
    // Read-only shapes.
    assert.equal(isSessionStatusReadOnlyArgs(undefined), true);
    assert.equal(isSessionStatusReadOnlyArgs(null), true);
    assert.equal(isSessionStatusReadOnlyArgs({}), true);
    assert.equal(isSessionStatusReadOnlyArgs({ sessionKey: "current" }), true);
    // Mutation vectors.
    for (const attack of [
      { model: MODEL_ALLOWLIST[1] },
      { model: "google/gemini-flash-latest" },
      { modelOverride: MODEL_ALLOWLIST[1] },
      { modelOverrideSource: "user" },
      { model_override: MODEL_ALLOWLIST[1] },
      { session: "other" },
      { label: "x" },
      { ["sessionKey"]: "current", model: MODEL_ALLOWLIST[1] },
    ]) {
      assert.equal(
        isSessionStatusReadOnlyArgs(attack),
        false,
        `must reject ${JSON.stringify(attack)}`,
      );
    }
    assert.equal(isSessionStatusReadOnlyArgs("not-an-object"), false);
    assert.equal(isSessionStatusReadOnlyArgs(["array"]), false);
  });

  it("TEST F/G: guard denies session_status for every non-main agent", async () => {
    for (const agentId of SPECIALISTS) {
      const root = mkdtempSync(path.join(os.tmpdir(), `t1-${agentId}-`));
      try {
        const { paths } = makeTask(root, {
          agentId,
          sessionKey: `agent:${agentId}:sess`,
          runId: "run-1",
          originMessageId: "72345678901234567",
        });
        const guard = createGovernanceGuard({
          paths,
          manifestFor: manifestForAgent,
        });
        const context = {
          agentId,
          sessionKey: `agent:${agentId}:sess`,
          runId: "run-1",
          toolCallId: "call-1",
        };
        for (const params of [
          {},
          { sessionKey: "current" },
          { model: MODEL_ALLOWLIST[1] },
        ]) {
          await assert.rejects(
            () =>
              guard.beforeToolCall(
                { toolName: "session_status", params, toolCallId: "call-1" },
                context,
              ),
            /AUTH_POLICY_DENIED/,
            `${agentId} must be denied session_status (${JSON.stringify(params)})`,
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("TEST G: main may inspect status but never mutate the session", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "t1-main-"));
    try {
      const { paths } = makeTask(root, {
        agentId: "main",
        sessionKey: "agent:main:sess",
        runId: "run-main",
        originMessageId: "82345678901234567",
      });
      const guard = createGovernanceGuard({
        paths,
        manifestFor: manifestForAgent,
      });
      const context = {
        agentId: "main",
        sessionKey: "agent:main:sess",
        runId: "run-main",
        toolCallId: "call-1",
      };
      // Read-only inspection is allowed.
      for (const params of [
        {},
        { sessionKey: "current" },
        { sessionKey: context.sessionKey },
      ]) {
        const decision = await guard.beforeToolCall(
          { toolName: "session_status", params, toolCallId: "call-1" },
          context,
        );
        assert.deepEqual(
          decision,
          { allow: true },
          `main may read ${JSON.stringify(params)}`,
        );
      }
      // Every mutation vector is denied — including the model pin.
      for (const params of [
        { model: MODEL_ALLOWLIST[1] },
        { modelOverride: MODEL_ALLOWLIST[1] },
        { modelOverrideSource: "user" },
        { model: MODEL_ALLOWLIST[1], sessionKey: "current" },
        { sessionKey: "agent:o1:other-session" },
      ]) {
        await assert.rejects(
          () =>
            guard.beforeToolCall(
              { toolName: "session_status", params, toolCallId: "call-1" },
              context,
            ),
          /POLICY_DENIED/,
          `main must be denied ${JSON.stringify(params)}`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("TEST H: no projection re-grants session_status to a specialist", () => {
    // Direct allowlist, manifest, effective policy, role manifest.
    for (const agent of SPECIALISTS) {
      assert.equal(
        effectiveOpenClawToolAllowlist(agent).includes("session_status"),
        false,
      );
      assert.equal(
        governanceManifest(agent).effective_tool_policy.includes(
          "session_status",
        ),
        false,
      );
      assert.equal(
        BUILT_IN_TOOL_POLICY[agent].includes("session_status"),
        false,
      );
    }
    // Role capability manifest (checked-in artifact) must agree.
    const roleManifest = JSON.parse(
      readFileSync(
        new URL(
          "../integrations/openclaw/topology/policy/role-capability-manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const role of roleManifest.roles) {
      if (role.id === "main") continue;
      assert.equal(
        role.tools.includes("session_status"),
        false,
        `${role.id} role manifest must not contain session_status`,
      );
    }
    // agents_list is main-only and must not leak either.
    for (const agent of SPECIALISTS) {
      assert.equal(BUILT_IN_TOOL_POLICY[agent].includes("agents_list"), false);
    }
  });

  it("TEST E: guard is the enforcement boundary for the 2026.6.34 alsoAllow group", () => {
    // The runtime config keeps tools.subagents.tools.alsoAllow for documented
    // 2026.6.34 empty-tool compatibility. That group MUST NOT be the authority:
    // even when the runtime group would expose the tool, the guard denies it.
    const config = buildConfig({
      stateDir: "C:/state",
      identifiers: IDENTIFIERS,
    });
    // Compatibility setting intentionally retained.
    assert.deepEqual(config.tools.subagents, {
      tools: { alsoAllow: ["session_status"] },
    });
    // ...and the canonical authority is unaffected by that group.
    for (const agent of SPECIALISTS) {
      assert.equal(
        BUILT_IN_TOOL_POLICY[agent].includes("session_status"),
        false,
      );
    }
  });
});
