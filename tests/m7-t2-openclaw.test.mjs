import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import process from "node:process";
import { setImmediate } from "node:timers";
import { execFileBounded } from "../integrations/openclaw/verify.mjs";
import governancePlugin from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  createRuntimeBackup,
  verifyRuntimeBackup,
  runtimeBackupPath,
  restoreT1RuntimeFiles,
} from "../integrations/openclaw/topology/lib/runtime-backup.mjs";
import {
  recordWorkflowEvent,
  inspectLedgerUpgrade,
  upgradeEmptyLegacyLedger,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  AGENT_IDS,
  governancePluginFiles,
} from "../integrations/openclaw/lib/policy.mjs";

test("ledger rejects escaped paths and symlink ancestors before touching targets", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-links-"));
  try {
    const external = path.join(root, "external");
    mkdirSync(external);
    writeFileSync(path.join(external, "events.jsonl"), "sentinel");
    const linked = path.join(root, "linked");
    symlinkSync(
      external,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () =>
        readSnapshot({
          root: linked,
          events: path.join(linked, "events.jsonl"),
          snapshot: path.join(linked, "snapshot.json"),
        }),
      /LEDGER_SYMLINK_DENIED/u,
    );
    const paths = ledgerPaths(path.join(root, "state"));
    assert.throws(
      () =>
        readSnapshot({ ...paths, events: path.join(external, "events.jsonl") }),
      /EXECUTION_STATE_UNKNOWN/u,
    );
    assert.equal(
      readFileSync(path.join(external, "events.jsonl"), "utf8"),
      "sentinel",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native root completion closes only validated work and leaves BLOCKED briefs active", async () => {
  for (const blocked of [false, true]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "zink-root-end-"));
    const paths = ledgerPaths(root);
    let unregister;
    try {
      const origin = {
        origin: "discord",
        origin_principal_ref: "b".repeat(64),
        origin_message_id: "123456789012345678",
      };
      const task_id = deriveTaskId(origin);
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id,
        root_agent_id: "main",
        root_session_key: "root-session",
        root_run_id: "root-run",
      });
      const guard = createGovernanceGuard({
        paths,
        manifestFor: (id) => ({
          expected_governance_hash: governanceHash(id),
          observed_governance_hash: governanceHash(id),
        }),
      });
      unregister = registerNativeGuard(paths.root, guard);
      const context = {
        agentId: "main",
        sessionKey: "root-session",
        runId: "root-run",
      };
      const payload = {
        ...resultPayloadFixture(),
        ...(blocked
          ? { outcome_claim: "BLOCKED", reason_claim: "MISSING_INPUT" }
          : {}),
      };
      const event = {
        success: true,
        yielded: false,
        lastAssistant: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: JSON.stringify(payload) }],
        },
      };
      await finishNativeRun(
        nativeConfig(paths.root),
        { yielded: true },
        context,
      );
      assert.equal(
        readSnapshot(paths).tasks[task_id].workflow_status,
        "ACTIVE",
      );
      await assert.rejects(
        finishNativeRun(
          nativeConfig(paths.root),
          { ...event, success: false },
          context,
        ),
      );
      const beforeAcceptance = readSnapshot(paths);
      for (const stopReason of [
        "error",
        "aborted",
        "length",
        "toolUse",
        undefined,
      ]) {
        await assert.rejects(
          finishNativeRun(
            nativeConfig(paths.root),
            {
              ...event,
              lastAssistant: { ...event.lastAssistant, stopReason },
            },
            context,
          ),
        );
        assert.deepEqual(readSnapshot(paths), beforeAcceptance);
      }
      await finishNativeRun(nativeConfig(paths.root), event, context);
      const task = readSnapshot(paths).tasks[task_id];
      assert.equal(task.workflow_status, blocked ? "BLOCKED" : "COMPLETE");
      assert.equal(task.brief_state, blocked ? "ACTIVE" : "CLOSED");
      assert.equal(task.root_result.payload_digest, payloadDigest(payload));
      assert.equal(JSON.stringify(task).includes(payload.output), false);
      await assert.rejects(
        finishNativeRun(nativeConfig(paths.root), event, context),
      );
      assert.deepEqual(readSnapshot(paths).tasks[task_id], task);
    } finally {
      unregister?.();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("root cannot close while a declared mandatory node has no accepted result", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-root-mandatory-"));
  try {
    const paths = ledgerPaths(root);
    const origin = {
      origin: "discord",
      origin_principal_ref: "b".repeat(64),
      origin_message_id: "123456789012345678",
    };
    const task_id = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id,
      root_agent_id: "main",
      root_session_key: "root-session",
      root_run_id: "root-run",
    });
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id,
      brief_revision: 1,
      nodes: [
        {
          node_id: "o1",
          agent_id: "o1",
          stack_id: "semantic",
          dependencies: [],
          required: true,
          input_digest: "a".repeat(64),
          constraints_digest: "b".repeat(64),
          validation_digest: "c".repeat(64),
        },
      ],
    });
    const before = readSnapshot(paths);
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_ROOT_RESULT_RECORDED", {
          task_id,
          brief_revision: 1,
          native_run_id: "root-run",
          agent_id: "main",
          payload_digest: "d".repeat(64),
          outcome_status: "COMPLETE",
          reason_code: "NONE",
          governance_hash: governanceHash("main"),
        }),
      /MISSING_PREREQUISITE/u,
    );
    assert.deepEqual(readSnapshot(paths), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime backup contains verified T1 fallback and immutable scoped preimages", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-runtime-backup-"));
  try {
    writeFileSync(
      path.join(root, "openclaw.json"),
      JSON.stringify(buildConfig({ stateDir: root, identifiers })),
    );
    const workspace = path.join(root, "workspaces", "main");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      path.join(workspace, "AGENTS.md"),
      "synthetic prior workspace",
    );
    const first = await createRuntimeBackup({ stateDir: root, identifiers });
    assert.equal(first.t1PolicyVerified, true);
    assert.equal(first.fileCount, 8);
    assert.deepEqual(
      await createRuntimeBackup({ stateDir: root, identifiers }),
      first,
    );
    const backup = runtimeBackupPath(root);
    const fallback = JSON.parse(
      readFileSync(path.join(backup, "t1-config.json"), "utf8"),
    );
    assert.deepEqual(fallback.plugins.allow, ["google", "discord"]);
    assert.equal(fallback.agents.defaults.subagents, undefined);
    assert.equal(
      fallback.agents.list.every(
        (agent) => agent.tools.profile === "minimal" && !agent.tools.alsoAllow,
      ),
      true,
    );
    const restored = await restoreT1RuntimeFiles({
      stateDir: root,
      identifiers,
    });
    assert.deepEqual(restored, {
      filesRestored: true,
      liveBaselineValidation: "NOT RUN",
      gatewayRestartRequired: true,
    });
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(root, "openclaw.json"), "utf8")),
      fallback,
    );
    assert.equal(
      readFileSync(
        path.join(backup, "quarantined-t2/workspaces/main/AGENTS.md"),
        "utf8",
      ),
      "synthetic prior workspace",
    );
    assert.deepEqual(
      await restoreT1RuntimeFiles({ stateDir: root, identifiers }),
      restored,
    );
    writeFileSync(path.join(workspace, "AGENTS.md"), "unexpected new content");
    await assert.rejects(
      restoreT1RuntimeFiles({ stateDir: root, identifiers }),
      /RESTORE_QUARANTINE_CONFLICT/u,
    );
    writeFileSync(
      path.join(backup, "preimages", "workspaces", "main", "AGENTS.md"),
      "tampered",
    );
    await assert.rejects(
      verifyRuntimeBackup({ stateDir: root, identifiers }),
      /BACKUP_DIGEST_MISMATCH/u,
    );
    assert.equal(
      readFileSync(path.join(workspace, "AGENTS.md"), "utf8"),
      "unexpected new content",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Main transitions consume task-global budget before spawn receipts and never refund", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-transitions-"));
  try {
    const paths = ledgerPaths(root);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "123456789012345678",
    };
    const task_id = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id,
      root_agent_id: "main",
      root_session_key: "main-session",
      root_run_id: "main-run",
    });
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      node_id: `node_${index}`,
      stack_id: index % 2 ? "data_plant" : "semantic",
      agent_id: index % 2 ? "o2" : "o1",
      dependencies: [],
      required: true,
      input_digest: "b".repeat(64),
      constraints_digest: "c".repeat(64),
      validation_digest: "d".repeat(64),
    }));
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id,
      brief_revision: 1,
      nodes,
    });
    for (const [index, node] of nodes.entries()) {
      const spec = {
        task_id,
        brief_revision: 1,
        node_id: node.node_id,
        agent_id: node.agent_id,
        parent_agent_id: "main",
        parent_session_key: "main-session",
        parent_run_id: "main-run",
        tool_call_id: `call-${index}`,
        turn: index + 1,
        attempt: 1,
        expected_governance_hash: governanceHash(node.agent_id),
        request_digest: "e".repeat(64),
      };
      spec.delegation_id = deriveDelegationId(spec);
      if (index === 11) {
        assert.throws(
          () => recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spec),
          /WORKFLOW_BUDGET_EXHAUSTED/u,
        );
        break;
      }
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spec);
      assert.equal(readSnapshot(paths).tasks[task_id].transitions_used, index);
      if (index === 0) continue; // lost receipt remains UNKNOWN; never refunded
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id,
        delegation_id: spec.delegation_id,
        native_run_id: `run-${index}`,
        child_session_key: `child-${index}`,
        agent_id: node.agent_id,
        parent_session_key: "main-session",
      });
      const run =
        readSnapshot(paths).tasks[task_id].delegations[spec.delegation_id];
      const envelope = createTrustedResultEnvelope({
        payload: resultPayloadFixture(),
        lineage: run,
        governance: {
          expected_governance_hash: run.expected_governance_hash,
          observed_governance_hash: run.expected_governance_hash,
        },
        runState: "COMPLETE",
        verifierValidation: "VALID",
        resultAcceptance: "ACCEPTED",
      });
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id,
        envelope,
      });
    }
    const task = readSnapshot(paths).tasks[task_id];
    assert.equal(task.transitions_used, 10);
    assert.equal(task.delegated_runs_used, 11);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R12 ledger upgrade accepts only an exact empty predecessor and preserves identity", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-upgrade-"));
  try {
    const paths = ledgerPaths(root);
    const current = readSnapshot(paths);
    const legacy = { ...current, governance_version: "m7-t2-r11" };
    writeFileSync(paths.identityKey, "synthetic-identity-not-a-real-key");
    writeFileSync(paths.snapshot, JSON.stringify(legacy));
    assert.equal(inspectLedgerUpgrade(paths), "EMPTY_R11");
    assert.equal(
      upgradeEmptyLegacyLedger(paths).governance_version,
      "m7-t2-r12",
    );
    assert.equal(
      readFileSync(paths.identityKey, "utf8"),
      "synthetic-identity-not-a-real-key",
    );
    assert.equal(readFileSync(paths.events, "utf8"), "");
    for (const invalid of [
      { ...legacy, tasks: { existing: {} } },
      { ...legacy, sequence: 1 },
      { ...legacy, extra: true },
    ]) {
      writeFileSync(paths.snapshot, JSON.stringify(invalid));
      assert.throws(
        () => upgradeEmptyLegacyLedger(paths),
        /EXECUTION_STATE_UNKNOWN/u,
      );
      assert.deepEqual(
        JSON.parse(readFileSync(paths.snapshot, "utf8")),
        invalid,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materialized plugin imports canonical assets and requires native invocation leases", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-plugin-integrated-"));
  const hooks = new Map();
  try {
    const paths = ledgerPaths(root);
    readSnapshot(paths);
    const extension = path.join(root, "extensions", "zink-governance");
    const generated = governancePluginFiles();
    for (const [relative, contents] of Object.entries({
      ...generated.assets,
      "index.mjs": generated.entrypoint,
      "package.json": generated.package,
    })) {
      const target = path.join(extension, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    for (const agentId of AGENT_IDS) {
      const folder = path.join(root, "workspaces", agentId);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
    }
    writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`);
    const plugin = (
      await import(pathToFileURL(path.join(extension, "index.mjs")).href)
    ).default;
    const fakeOwner = "123456789012345678";
    plugin.register({
      pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: fakeOwner },
      on: (name, fn) => hooks.set(name, fn),
      logger: { error: () => assert.fail("unexpected plugin error") },
    });
    const syntheticSecret = "SYNTHETIC_ONLY_DO_NOT_USE";
    const sanitized = await sanitizeNativePrompt(
      nativeConfig(paths.root),
      `Authorization: Bearer ${syntheticSecret}\nowner=${fakeOwner}\nordinary request`,
    );
    assert.equal(sanitized.includes(syntheticSecret), false);
    assert.equal(sanitized.includes(fakeOwner), false);
    assert.match(sanitized, /ordinary request/u);
    await enterNativeRun(nativeConfig(paths.root), {
      channelId: "discord",
      agentId: "main",
      senderId: fakeOwner,
      currentMessageId: "123456789012345679",
      sessionKey: "main-session",
      runId: "main-run",
    });
    const snapshot = readSnapshot(paths);
    assert.equal(Object.keys(snapshot.tasks).length, 1);
    await enterNativeRun(nativeConfig(paths.root), {
      channelId: "discord",
      agentId: "main",
      senderId: fakeOwner,
      currentMessageId: "123456789012345679",
      sessionKey: "main-session",
      runId: "main-run",
    });
    assert.equal(readSnapshot(paths).sequence, snapshot.sequence);
    await assert.rejects(
      enterNativeRun(nativeConfig(paths.root), {
        channelId: "discord",
        agentId: "main",
        senderId: "223456789012345678",
        currentMessageId: "123456789012345679",
        sessionKey: "main-session",
        runId: "main-run",
      }),
    );
    const task_id = Object.keys(snapshot.tasks)[0];
    assert.equal(JSON.stringify(snapshot).includes(fakeOwner), false);
    const context = {
      agentId: "main",
      sessionKey: "main-session",
      runId: "main-run",
      toolCallId: "call-0",
    };
    const event = nativeEvent(["session_status"]);
    assert.equal(
      hooks.get("before_tool_call")(
        { toolName: "session_status", params: {} },
        context,
      ).block,
      true,
    );
    const nativeAgent = {};
    installNativeToolGate(nativeAgent, nativeConfig(paths.root), context);
    assert.equal(await nativeAgent.beforeToolCall(event), undefined);
    assert.equal(
      hooks.get("before_tool_call")(
        { toolName: "session_status", params: event.args },
        context,
      ),
      undefined,
    );
    assert.equal(
      hooks.get("before_tool_call")(
        { toolName: "session_status", params: event.args },
        context,
      ).block,
      true,
    );
    const receipt = hooks.get("before_prompt_build")({}, context);
    assert.match(receipt.prependContext, new RegExp(task_id, "u"));
    const node = {
      node_id: "o1",
      agent_id: "o1",
      stack_id: "semantic",
      required: true,
      dependencies: [],
      input_digest: "a".repeat(64),
      constraints_digest: "b".repeat(64),
      validation_digest: "c".repeat(64),
    };
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id,
      brief_revision: 1,
      nodes: [node],
    });
    const spawn = {
      task_id,
      brief_revision: 1,
      node_id: "o1",
      agent_id: "o1",
      parent_agent_id: "main",
      parent_session_key: "main-session",
      parent_run_id: "main-run",
      tool_call_id: "spawn-race",
      turn: 1,
      attempt: 1,
      expected_governance_hash: governanceHash("o1"),
      request_digest: "d".repeat(64),
    };
    spawn.delegation_id = deriveDelegationId(spawn);
    recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spawn);
    let childStarted = false;
    const childStart = enterNativeRun(nativeConfig(paths.root), {
      agentId: "o1",
      sessionKey: "child-session",
      runId: "child-native-run",
    }).then(() => {
      childStarted = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(childStarted, false);
    hooks.get("subagent_spawned")(
      {
        label: spawn.delegation_id,
        runId: "child-native-run",
        childSessionKey: "child-session",
        agentId: "o1",
      },
      { requesterSessionKey: "main-session" },
    );
    await childStart;
    assert.equal(childStarted, true);
    assert.equal(
      readSnapshot(paths).tasks[task_id].delegations[spawn.delegation_id]
        .run_state,
      "RUNNING",
    );
    // Workspace drift blocks the mandatory native callback before execution.
    writeFileSync(path.join(root, "workspaces", "main", "AGENTS.md"), "drift");
    assert.equal(
      (await nativeAgent.beforeToolCall(nativeEvent(["session_status"]))).block,
      true,
    );
    hooks.get("subagent_ended")(
      {
        targetKind: "subagent",
        targetSessionKey: "child-session",
        runId: "child-native-run",
        outcome: "timeout",
      },
      {
        childSessionKey: "child-session",
        requesterSessionKey: "main-session",
        runId: "child-native-run",
      },
    );
    const timedOut = readSnapshot(paths);
    assert.equal(timedOut.tasks[task_id].workflow_status, "BLOCKED");
    assert.equal(
      timedOut.tasks[task_id].delegations[spawn.delegation_id]
        .runtime_reason_code,
      "RUN_TIMEOUT",
    );
    await assert.rejects(
      enterNativeRun(nativeConfig(paths.root), {
        agentId: "o1",
        sessionKey: "child-session",
        runId: "child-native-run",
      }),
    );
  } finally {
    hooks.get("gateway_stop")?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("native boundary and durable guard integrate nested synthetic delegation and acceptance", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-guard-chain-"));
  const scope = `${root}/synthetic-scope`;
  let unregister;
  try {
    const paths = ledgerPaths(root);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "123456789012345679",
    };
    const task_id = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id,
      root_agent_id: "main",
      root_session_key: "main-session",
      root_run_id: "main-run",
    });
    const inputs = "Synthetic semantic check",
      constraints = "No external data";
    const validation_criteria = "agent-result-payload.schema.json";
    const nodes = ["o1", "python"].map((agent_id) => ({
      node_id: agent_id,
      agent_id,
      stack_id: "semantic",
      required: true,
      dependencies: [],
      input_digest: canonicalHash("zink-input-v1", inputs),
      constraints_digest: canonicalHash("zink-constraints-v1", constraints),
      validation_digest: canonicalHash(
        "zink-validation-v1",
        validation_criteria,
      ),
    }));
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id,
      brief_revision: 1,
      nodes,
    });
    const manifestFor = (agentId) => ({
      expected_governance_hash: governanceHash(agentId),
      observed_governance_hash: governanceHash(agentId),
      allowed_tools: governanceManifest(agentId).effective_tool_policy,
    });
    const guard = createGovernanceGuard({ paths, manifestFor });
    unregister = registerNativeGuard(scope, guard);
    const makeAgent = (agentId) => {
      const agent = {};
      installNativeToolGate(agent, nativeConfig(scope), {
        agentId,
        sessionKey: `${agentId}-session`,
        runId: `${agentId}-run`,
      });
      return agent;
    };
    const main = makeAgent("main"),
      o1 = makeAgent("o1");
    const handoffFor = (parent, target) => {
      const task = readSnapshot(paths).tasks[task_id];
      const handoff = {
        schema_version: "1.0.0",
        governance_version: "m7-t2-r12",
        task_id,
        brief_revision: 1,
        node_id: target,
        attempt: 1,
        parent_agent_id: parent,
        target_agent_id: target,
        target_stack: "semantic",
        expected_governance_hash: governanceHash(target),
        inputs,
        input_refs: [],
        constraints,
        validation_criteria,
        remaining_task_budget: {
          revisions: 15,
          transitions: 10,
          delegated_runs: 71 - task.delegated_runs_used,
        },
        requested_output_schema: "agent-result-payload.schema.json",
      };
      handoff.delegation_id = deriveDelegationId({
        ...handoff,
        agent_id: target,
      });
      return handoff;
    };
    const spawn = async (agent, parent, target) => {
      const handoff = handoffFor(parent, target);
      const event = nativeEvent(["sessions_spawn"]);
      event.args = {
        task: JSON.stringify(
          Object.fromEntries(
            [
              "schema_version",
              "governance_version",
              "node_id",
              "inputs",
              "input_refs",
              "constraints",
              "validation_criteria",
            ].map((key) => [key, handoff[key]]),
          ),
        ),
        agentId: target,
        runtime: "subagent",
        mode: "run",
        thread: false,
        context: "isolated",
        sandbox: "require",
        cleanup: "keep",
      };
      assert.equal(await agent.beforeToolCall(event), undefined);
      assert.deepEqual(JSON.parse(event.args.task), handoff);
      const reserved =
        readSnapshot(paths).tasks[task_id].delegations[handoff.delegation_id];
      assert.equal(reserved.run_state, "SPAWN_UNKNOWN");
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id,
        delegation_id: handoff.delegation_id,
        native_run_id: `${target}-run`,
        child_session_key: `${target}-session`,
        agent_id: target,
        parent_session_key: `${parent}-session`,
      });
      return handoff;
    };
    assert.equal(
      (await main.beforeToolCall(nativeEvent(["sessions_yield"]))).block,
      true,
    );
    const coordinator = await spawn(main, "main", "o1");
    assert.equal(
      await main.beforeToolCall(nativeEvent(["sessions_yield"])),
      undefined,
    );
    const leaf = await spawn(o1, "o1", "python");
    assert.equal(readSnapshot(paths).tasks[task_id].delegated_runs_used, 2);
    const announce = (child, parent) => ({
      phase: "completion",
      childSessionKey: `${child}-session`,
      childRunId: `${child}-run`,
      requesterSessionKey: `${parent}-session`,
      findings: JSON.stringify(resultPayloadFixture()),
      outcome: { status: "ok" },
    });
    assert.equal(
      (await gateNativeAnnounce(nativeConfig(scope), announce("o1", "main")))
        .action,
      "block",
    );
    const acceptedLeaf = await gateNativeAnnounce(
      nativeConfig(scope),
      announce("python", "o1"),
    );
    assert.equal(acceptedLeaf.action, "deliver");
    assert.equal(
      JSON.parse(acceptedLeaf.receipt).envelope.delegation_id,
      leaf.delegation_id,
    );
    assert.equal(
      (await gateNativeAnnounce(nativeConfig(scope), announce("python", "o1")))
        .action,
      "discard",
    );
    const wake = {
      ...announce("o1", "main"),
      phase: "descendant_wake",
      nextRunId: "o1-wake-run",
    };
    assert.equal(
      (await gateNativeAnnounce(nativeConfig(scope), wake)).action,
      "deliver",
    );
    // Reloaded guard uses the journal, not in-memory pending-child maps.
    unregister();
    unregister = registerNativeGuard(
      scope,
      createGovernanceGuard({ paths, manifestFor }),
    );
    const resumed = {
      agentId: "o1",
      sessionKey: "o1-session",
      runId: "o1-wake-run",
      inputProvenance: {
        kind: "inter_session",
        sourceTool: "subagent_announce",
        sourceSessionKey: "o1-session",
      },
    };
    await assert.rejects(
      enterNativeRun(nativeConfig(scope), { ...resumed, runId: "forged-run" }),
    );
    await assert.rejects(
      enterNativeRun(nativeConfig(scope), {
        ...resumed,
        inputProvenance: undefined,
      }),
    );
    await enterNativeRun(nativeConfig(scope), resumed);
    await assert.rejects(
      enterNativeRun(nativeConfig(scope), { ...resumed, runId: "o1-run" }),
    );
    const acceptedCoordinator = await gateNativeAnnounce(nativeConfig(scope), {
      ...announce("o1", "main"),
      childRunId: "o1-wake-run",
      nextRunId: "main-completion-run",
    });
    assert.equal(acceptedCoordinator.action, "deliver");
    assert.equal(
      JSON.parse(acceptedCoordinator.receipt).envelope.delegation_id,
      coordinator.delegation_id,
    );
    const acceptedSequence = readSnapshot(paths).sequence;
    const deliveryRetry = await gateNativeAnnounce(nativeConfig(scope), {
      ...announce("o1", "main"),
      childRunId: "o1-wake-run",
      nextRunId: "main-completion-run",
    });
    assert.equal(deliveryRetry.receipt, acceptedCoordinator.receipt);
    assert.equal(readSnapshot(paths).sequence, acceptedSequence);
    assert.equal(readSnapshot(paths).tasks[task_id].delegated_runs_used, 2);
    recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
      task_id,
      reason_code: "OWNER_CANCELLED",
    });
    await assert.rejects(
      enterNativeRun(nativeConfig(scope), {
        agentId: "main",
        sessionKey: "main-session",
        runId: "main-completion-run",
        inputProvenance: {
          kind: "inter_session",
          sourceTool: "subagent_announce",
          sourceSessionKey: "o1-session",
        },
      }),
    );
  } finally {
    unregister?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("trusted workflow journals reservation, native receipt and cancellation across restart", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-workflow-replay-"));
  try {
    const paths = ledgerPaths(root);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "123456789012345678",
    };
    const task_id = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id,
      root_agent_id: "main",
      root_session_key: "synthetic-main",
      root_run_id: "main-run",
    });
    const node = {
      node_id: "semantic",
      stack_id: "semantic",
      agent_id: "o1",
      dependencies: [],
      required: true,
      input_digest: "b".repeat(64),
      constraints_digest: "c".repeat(64),
      validation_digest: "d".repeat(64),
    };
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id,
      brief_revision: 1,
      nodes: [node],
    });
    const before = readSnapshot(paths);
    const run = {
      task_id,
      brief_revision: 1,
      node_id: node.node_id,
      agent_id: "o1",
      parent_agent_id: "main",
      parent_session_key: "synthetic-main",
      parent_run_id: "main-run",
      tool_call_id: "call-1",
      turn: 1,
      attempt: 1,
      expected_governance_hash: "e".repeat(64),
      request_digest: "f".repeat(64),
    };
    run.delegation_id = deriveDelegationId(run);
    const committed = recordWorkflowEvent(
      paths,
      "WORKFLOW_SPAWN_RESERVED",
      run,
    );
    assert.equal(committed.tasks[task_id].delegated_runs_used, 1);
    writeFileSync(paths.snapshot, JSON.stringify(before));
    assert.deepEqual(readSnapshot(paths), committed);
    const eventCount = readSnapshot(paths).sequence;
    assert.throws(
      () => recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", run),
      /SPAWN_UNKNOWN/u,
    );
    assert.equal(readSnapshot(paths).sequence, eventCount);
    const receipt = {
      task_id,
      delegation_id: run.delegation_id,
      native_run_id: "child-run",
      child_session_key: "synthetic-o1",
      agent_id: "o1",
      parent_session_key: "synthetic-main",
    };
    recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", receipt);
    assert.equal(
      readSnapshot(paths).tasks[task_id].delegations[run.delegation_id]
        .run_state,
      "RUNNING",
    );
    const ended = {
      task_id,
      native_run_id: receipt.native_run_id,
      child_session_key: receipt.child_session_key,
      parent_session_key: receipt.parent_session_key,
      outcome: "ok",
    };
    const running = readSnapshot(paths);
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
          ...ended,
          native_run_id: "untrusted-run",
        }),
      /LINEAGE_MISMATCH/u,
    );
    recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", ended);
    assert.deepEqual(
      readSnapshot(paths),
      running,
      "native ok is not semantic acceptance",
    );
    recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
      ...ended,
      outcome: "timeout",
    });
    const suspended = readSnapshot(paths);
    assert.equal(suspended.tasks[task_id].workflow_status, "BLOCKED");
    assert.equal(
      suspended.tasks[task_id].delegations[run.delegation_id].run_state,
      "UNKNOWN",
    );
    assert.equal(
      suspended.tasks[task_id].reason_code,
      "EXECUTION_STATE_UNKNOWN",
    );
    assert.equal(
      suspended.tasks[task_id].delegations[run.delegation_id]
        .runtime_reason_code,
      "RUN_TIMEOUT",
    );
    writeFileSync(paths.snapshot, JSON.stringify(running));
    assert.deepEqual(
      readSnapshot(paths),
      suspended,
      "failure survives stale snapshot recovery",
    );
    assert.throws(() =>
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", run),
    );
    assert.deepEqual(
      readSnapshot(paths),
      suspended,
      "uncertainty must not consume another spawn",
    );
    recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
      task_id,
      reason_code: "OWNER_CANCELLED",
    });
    recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", receipt);
    const cancelled = readSnapshot(paths);
    recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
      ...ended,
      outcome: "error",
    });
    assert.deepEqual(
      readSnapshot(paths),
      cancelled,
      "late failure cannot revive cancellation",
    );
    assert.equal(
      readSnapshot(paths).tasks[task_id].delegations[run.delegation_id]
        .run_state,
      "CANCELLED",
    );
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id,
          brief_revision: 2,
          nodes: [node],
        }),
      /INVALID_STATE_TRANSITION/u,
    );
    const corrupt = readSnapshot(paths);
    corrupt.tasks[task_id].delegations[run.delegation_id].run_state = "RUNNING";
    writeFileSync(paths.snapshot, JSON.stringify(corrupt));
    assert.throws(() => readSnapshot(paths), {
      code: "EXECUTION_STATE_UNKNOWN",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const resultPayloadFixture = () => ({
  schema_version: "1.0.0",
  governance_version: "m7-t2-r12",
  outcome_claim: "COMPLETE",
  reason_claim: "NONE",
  output: "synthetic output",
  assumptions: [],
  limitations: [],
  requested_prerequisites: [],
  agent_self_validation: "Claim only",
});

test("agent payloads execute strict schema and byte/conditional limits", () => {
  const valid = resultPayloadFixture();
  assert.equal(validateContract("agent-result-payload", valid), true);
  for (const patch of [
    { run_state: "COMPLETE" },
    { agent_id: "python" },
    { expected_governance_hash: "a".repeat(64) },
    { output: null },
    { output: "é".repeat(8193) },
    { assumptions: Array(17).fill("x") },
    { governance_version: "stale" },
    { claimed_artifact_refs: [{}] },
    {
      requested_prerequisites: [
        { stack_id: "semantic", requirement: "x", blocking_node_id: "x" },
      ],
    },
  ])
    assert.throws(
      () => validateContract("agent-result-payload", { ...valid, ...patch }),
      /SCHEMA_INVALID/u,
    );
  for (const field of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[field];
    assert.throws(
      () => validateContract("agent-result-payload", missing),
      /SCHEMA_INVALID/u,
    );
  }
  const blocked = {
    ...valid,
    outcome_claim: "BLOCKED",
    reason_claim: "MISSING_PREREQUISITE",
    requested_prerequisites: [
      {
        stack_id: "semantic",
        requirement: "define KPI",
        blocking_node_id: "kpi",
      },
    ],
  };
  assert.equal(validateContract("agent-result-payload", blocked), true);
  assert.throws(
    () =>
      validateContract("agent-result-payload", {
        ...blocked,
        requested_prerequisites: [],
      }),
    /SCHEMA_INVALID/u,
  );
});
import {
  enterNativeRun,
  finishNativeRun,
  sanitizeNativePrompt,
  installNativeToolGate,
  registerNativeGuard,
  gateNativeAnnounce,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});
const nativeEvent = (names, index = 0) => {
  const calls = names.map((name, slot) => ({
    type: "toolCall",
    name,
    id: `call-${slot}`,
    arguments: {},
  }));
  return {
    assistantMessage: { role: "assistant", content: calls },
    toolCall: calls[index],
    args: {},
  };
};

test("ledger corruption errors do not echo malformed persisted content", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-redaction-"));
  try {
    const paths = ledgerPaths(root);
    readSnapshot(paths);
    writeFileSync(paths.snapshot, "SENTINEL");
    assert.throws(
      () => readSnapshot(paths),
      (error) => {
        assert.equal(error.code, "EXECUTION_STATE_UNKNOWN");
        assert.equal(error.message.includes("SENTINEL"), false);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R12 native bridge blocks every sibling before any execution", async () => {
  let guards = 0;
  let original = 0;
  const unregister = registerNativeGuard("synthetic-batch", {
    beforeToolCall: () => {
      guards++;
      return { allow: true };
    },
    beforeAnnounce: () => ({ action: "discard" }),
  });
  try {
    const agent = {
      beforeToolCall: () => {
        original++;
      },
    };
    installNativeToolGate(agent, nativeConfig("synthetic-batch"), {
      agentId: "main",
      sessionKey: "synthetic",
      runId: "run-1",
    });
    const first = nativeEvent(["sessions_spawn", "sessions_yield"]);
    const second = { ...first, toolCall: first.assistantMessage.content[1] };
    for (const event of [first, second])
      assert.equal((await agent.beforeToolCall(event)).block, true);
    assert.equal(guards, 0);
    assert.equal(original, 0);
    assert.equal(
      await agent.beforeToolCall(nativeEvent(["sessions_spawn"])),
      undefined,
    );
    assert.equal(guards, 1);
    assert.equal(original, 1);
  } finally {
    unregister();
  }
});

test("R12 native bridge rejects malformed batch identities before callbacks", async () => {
  let called = 0;
  const unregister = registerNativeGuard("synthetic-identities", {
    beforeToolCall: () => {
      called++;
      return { allow: true };
    },
    beforeAnnounce: () => ({ action: "discard" }),
  });
  try {
    const agent = {
      beforeToolCall: () => {
        called++;
      },
    };
    installNativeToolGate(agent, nativeConfig("synthetic-identities"), {
      agentId: "main",
      sessionKey: "synthetic",
      runId: "run-1",
    });
    for (const id of [undefined, null, "", 1, {}, []]) {
      const event = nativeEvent(["sessions_spawn"]);
      event.toolCall.id = id;
      assert.equal((await agent.beforeToolCall(event)).block, true);
    }
    const duplicate = nativeEvent(["sessions_spawn", "sessions_spawn"]);
    duplicate.assistantMessage.content[1].id = duplicate.toolCall.id;
    assert.equal((await agent.beforeToolCall(duplicate)).block, true);
    assert.equal(called, 0);
  } finally {
    unregister();
  }
});

test("R12 missing guard, rejected decision and abort fail closed", async () => {
  const agent = {};
  installNativeToolGate(agent, nativeConfig("synthetic-unavailable"), {
    agentId: "main",
    sessionKey: "synthetic",
    runId: "run-1",
  });
  assert.equal(
    (await agent.beforeToolCall(nativeEvent(["sessions_spawn"]))).block,
    true,
  );
  const unregister = registerNativeGuard("synthetic-unavailable", {
    beforeToolCall: async () => new Promise(() => {}),
    beforeAnnounce: () => {
      throw new Error("fake-sensitive-error");
    },
  });
  try {
    const controller = new globalThis.AbortController();
    const pending = agent.beforeToolCall(
      nativeEvent(["sessions_spawn"]),
      controller.signal,
    );
    controller.abort();
    assert.equal((await pending).block, true);
    assert.deepEqual(
      await gateNativeAnnounce(nativeConfig("synthetic-unavailable"), {}),
      { governed: true, action: "block" },
    );
  } finally {
    unregister();
  }
});

test("R12 native announce exposes only bounded accepted receipts", async () => {
  let decision = { action: "deliver", receipt: "accepted synthetic receipt" };
  const unregister = registerNativeGuard("synthetic-announce", {
    beforeToolCall: () => ({ allow: true }),
    beforeAnnounce: () => decision,
  });
  try {
    const config = nativeConfig("synthetic-announce");
    assert.deepEqual(await gateNativeAnnounce(config, {}), {
      governed: true,
      ...decision,
    });
    decision = { action: "deliver", receipt: "é".repeat(32769) };
    assert.equal((await gateNativeAnnounce(config, {})).action, "block");
    decision = { action: "discard", receipt: "must not escape" };
    assert.deepEqual(await gateNativeAnnounce(config, {}), {
      governed: true,
      action: "discard",
    });
    assert.deepEqual(await gateNativeAnnounce({}, {}), { governed: false });
  } finally {
    unregister();
  }
});

test("governance uses typed hooks and cannot trust spoofed event identity", async (t) => {
  const hooks = new Map();
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-plugin-hooks-"));
  t.after(() => {
    hooks.get("gateway_stop")?.();
    rmSync(root, { recursive: true, force: true });
  });
  assert.throws(
    () => governancePlugin.register({ pluginConfig: {} }),
    /GOVERNANCE_CONFIGURATION_INVALID/u,
  );
  governancePlugin.register({
    pluginConfig: {
      ledgerRoot: ledgerPaths(root).root,
      ownerDiscordId: "123456789012345678",
    },
    on: (name, handler) => hooks.set(name, handler),
    registerHook: () =>
      assert.fail("typed hooks must not use internal registration"),
  });
  assert.ok(hooks.has("before_tool_call"));
  assert.ok(hooks.has("subagent_spawned"));
  const event = {
    toolName: "sessions_spawn",
    agentId: "main",
    requesterAgentId: "main",
    params: {
      agentId: "o1",
      runtime: "subagent",
      mode: "run",
      thread: false,
      context: "isolated",
      sandbox: "require",
      cleanup: "keep",
    },
  };
  for (const context of [{}, { agentId: "python", sessionKey: "synthetic" }]) {
    assert.equal(
      (await hooks.get("before_tool_call")(event, context)).block,
      true,
    );
  }
  assert.equal(
    (
      await hooks.get("before_tool_call")(
        { toolName: "sessions_yield", agentId: "main" },
        { agentId: "main", sessionKey: "synthetic" },
      )
    ).block,
    true,
  );
});

test("bounded verifier preserves UTF-8 split across child writes", async () => {
  const result = await execFileBounded(process.execPath, [
    "-e",
    "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82,0xac])), 100);",
  ]);
  assert.equal(result.stdout, "€");
});

test("bounded verifier rejects timeout, overflow and missing executable", async () => {
  await assert.rejects(
    execFileBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeout: 200,
    }),
    { code: "ETIMEDOUT" },
  );
  await assert.rejects(
    execFileBounded(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(1024))"],
      { maxBuffer: 16 },
    ),
    /exceeded output limit/u,
  );
  await assert.rejects(
    execFileBounded("zink-nonexistent-test-executable", []),
    { code: "ENOENT" },
  );
});

test("bounded verifier handles a child closing stdin early", async () => {
  await assert.rejects(
    execFileBounded(process.execPath, ["-e", "process.exit(2)"], {
      input: "x".repeat(8 * 1024 * 1024),
      timeout: 5000,
    }),
  );
});

import {
  AGENT_SPAWN_POLICY,
  GOVERNANCE_PLUGIN_ALLOWLIST,
  OPENCLAW_RELEASE,
  agentInstructions,
  buildConfig,
  governanceHash,
  governanceManifest,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  BUDGETS,
  appendEvent,
  emptySnapshot,
  ledgerPaths,
  readSnapshot,
  reserveBudget,
  reserveBudgetAtomically,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  canonicalJson,
  deriveDelegationId,
  derivePrincipalRef,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  classifyDuplicate,
  createTrustedResultEnvelope,
  payloadDigest,
  reasonEmitterAllowed,
  revisionCanCarryForward,
  sanitizeDelegationText,
  workflowAggregate,
} from "../integrations/openclaw/topology/lib/runtime.mjs";

const identifiers = {
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
};

test("R11 freezes five-stack topology and exact native tool policy", () => {
  const config = buildConfig({ stateDir: "C:/state", identifiers });
  assert.deepEqual(config.agents.defaults.subagents, {
    maxSpawnDepth: 2,
    maxChildrenPerAgent: 4,
    maxConcurrent: 4,
    runTimeoutSeconds: 300,
    announceTimeoutMs: 120000,
    requireAgentId: true,
  });
  assert.deepEqual(config.tools.subagents, {
    tools: { alsoAllow: ["session_status"] },
  });
  assert.equal(config.tools.agentToAgent.enabled, false);
  assert.equal(config.tools.sessions_spawn.attachments.enabled, false);
  assert.equal(
    config.plugins.entries["zink-governance"].config.ownerDiscordId,
    identifiers.discordOwnerId,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "main").subagents
      .allowAgents,
    AGENT_SPAWN_POLICY.main,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "o1").subagents.allowAgents,
    AGENT_SPAWN_POLICY.o1,
  );
  assert.deepEqual(
    config.agents.list.find((agent) => agent.id === "o2").subagents.allowAgents,
    AGENT_SPAWN_POLICY.o2,
  );
  for (const id of ["excel", "power-bi", "sql", "python"]) {
    const agent = config.agents.list.find((entry) => entry.id === id);
    assert.deepEqual(agent.subagents.allowAgents, []);
    assert.deepEqual(agent.tools, { profile: "minimal" });
  }
  assert.equal(OPENCLAW_RELEASE, "2026.6.34");
  assert.deepEqual(config.plugins.allow, GOVERNANCE_PLUGIN_ALLOWLIST);
});

test("canonical hashing rejects lossy identities and normalizes keys without collisions", () => {
  assert.throws(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => canonicalJson(new Date()));
  assert.equal(
    canonicalJson({ "e\u0301": "e\u0301" }),
    canonicalJson({ é: "é" }),
  );
  assert.throws(() => canonicalJson({ "e\u0301": 1, é: 2 }));
  assert.equal(
    canonicalJson({ allowed_tools: ["z", "ä", "a"] }),
    '{"allowed_tools":["a","z","ä"]}',
  );
  const identity = { origin: "discord", origin_principal_ref: "a".repeat(64) };
  for (const invalid of [Number("123456789012345678"), "1", null, undefined]) {
    assert.throws(() =>
      deriveTaskId({ ...identity, origin_message_id: invalid }),
    );
    assert.throws(() => derivePrincipalRef("synthetic-key", invalid));
  }
});

test("R11 canonical identity and delegation hashes are deterministic and domain separated", () => {
  const identity = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
  };
  assert.equal(
    deriveTaskId(identity),
    deriveTaskId({ ...identity, origin_session_key: "runtime-changed" }),
  );
  assert.notEqual(
    canonicalHash("zink-task-id-v1", identity),
    canonicalHash("zink-delegation-id-v1", identity),
  );
  assert.equal(
    derivePrincipalRef("identity-key", "32345678901234567").length,
    64,
  );
  const delegation = {
    task_id: "b".repeat(64),
    brief_revision: 1,
    node_id: "semantic",
    agent_id: "o1",
    attempt: 1,
  };
  assert.equal(
    deriveDelegationId(delegation),
    deriveDelegationId({ ...delegation }),
  );
});

test("R11 ledger reserves monotonic task-global budgets and chains events", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r11-ledger-"));
  try {
    const paths = ledgerPaths(root);
    let snapshot = emptySnapshot();
    snapshot = appendEvent(paths, snapshot, "TASK_CREATED", {
      task_id: "a".repeat(64),
    });
    snapshot = reserveBudgetAtomically(
      paths,
      snapshot,
      "a".repeat(64),
      "delegated_runs",
      1,
    );
    snapshot = appendEvent(paths, snapshot, "DELEGATION_RESERVED", {
      task_id: "a".repeat(64),
    });
    assert.equal(readSnapshot(paths).sequence, snapshot.sequence);
    assert.equal(snapshot.sequence, 3);
    assert.equal(
      readFileSync(paths.events, "utf8").trim().split("\n").length,
      3,
    );
    assert.throws(
      () =>
        reserveBudget(
          {
            ...snapshot,
            tasks: {
              ["a".repeat(64)]: {
                revisions_used: 1,
                transitions_used: 0,
                delegated_runs_used: BUDGETS.maxTotalDelegatedRunsPerTask,
              },
            },
          },
          "a".repeat(64),
          "delegated_runs",
        ),
      /budget exhausted/u,
    );
    const corrupted = readFileSync(paths.events, "utf8").replace(
      "DELEGATION_RESERVED",
      "CORRUPTED",
    );
    writeFileSync(paths.events, corrupted, "utf8");
    assert.throws(() => readSnapshot(paths), /Ledger corruption/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger reservations re-read counters under lock and reject stale appends", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-race-"));
  try {
    const paths = ledgerPaths(root);
    const stale = readSnapshot(paths);
    const taskId = "a".repeat(64);
    reserveBudgetAtomically(paths, stale, taskId, "delegated_runs", 70);
    reserveBudgetAtomically(paths, stale, taskId, "delegated_runs", 2);
    assert.equal(readSnapshot(paths).tasks[taskId].delegated_runs_used, 72);
    assert.throws(
      () => reserveBudgetAtomically(paths, stale, taskId, "delegated_runs"),
      { code: "WORKFLOW_BUDGET_EXHAUSTED" },
    );
    const before = readFileSync(paths.events, "utf8");
    assert.throws(() => appendEvent(paths, stale, "STALE_WRITE"), {
      code: "EXECUTION_STATE_UNKNOWN",
    });
    assert.equal(readFileSync(paths.events, "utf8"), before);
    assert.equal(readSnapshot(paths).sequence, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger recovers a durable budget event after a stale snapshot", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-recovery-"));
  try {
    const paths = ledgerPaths(root);
    const before = readSnapshot(paths);
    const committed = reserveBudgetAtomically(
      paths,
      before,
      "a".repeat(64),
      "delegated_runs",
      72,
    );
    // Simulate a crash after journal fsync but before snapshot replacement.
    writeFileSync(paths.snapshot, JSON.stringify(before));
    assert.deepEqual(readSnapshot(paths), committed);
    assert.deepEqual(
      JSON.parse(readFileSync(paths.snapshot, "utf8")),
      committed,
    );
    assert.throws(
      () =>
        reserveBudgetAtomically(
          paths,
          before,
          "a".repeat(64),
          "delegated_runs",
        ),
      { code: "WORKFLOW_BUDGET_EXHAUSTED" },
    );
    const last = readSnapshot(paths);
    const journal = readFileSync(paths.events, "utf8");
    assert.throws(
      () => appendEvent(paths, last, "UNKNOWN_STATE_CHANGE", {}),
      /SCHEMA_INVALID/u,
    );
    assert.equal(readFileSync(paths.events, "utf8"), journal);
    assert.deepEqual(readSnapshot(paths), last);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger rejects snapshot counter corruption despite a valid event anchor", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-integrity-"));
  try {
    const paths = ledgerPaths(root);
    const committed = reserveBudgetAtomically(
      paths,
      readSnapshot(paths),
      "a".repeat(64),
      "delegated_runs",
      72,
    );
    const corrupted = globalThis.structuredClone(committed);
    corrupted.tasks["a".repeat(64)].delegated_runs_used = 0;
    writeFileSync(paths.snapshot, JSON.stringify(corrupted));
    assert.throws(() => readSnapshot(paths), {
      code: "EXECUTION_STATE_UNKNOWN",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger rejects caller snapshot counter edits before appending", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-ledger-integrity-"));
  try {
    const paths = ledgerPaths(root);
    const committed = reserveBudgetAtomically(
      paths,
      readSnapshot(paths),
      "a".repeat(64),
      "delegated_runs",
      72,
    );
    const before = readFileSync(paths.events, "utf8");
    assert.throws(
      () => appendEvent(paths, { ...committed, tasks: {} }, "AUDIT"),
      { code: "EXECUTION_STATE_UNKNOWN" },
    );
    assert.equal(readFileSync(paths.events, "utf8"), before);
    assert.equal(
      readSnapshot(paths).tasks["a".repeat(64)].delegated_runs_used,
      72,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R11 governance manifests are role-specific and injected into every workspace contract", () => {
  assert.notEqual(governanceHash("main"), governanceHash("python"));
  assert.equal(governanceManifest("python").runtime_version, "2026.6.34");
  assert.match(agentInstructions("main"), /sessions_yield is allowed only/u);
  assert.match(
    agentInstructions("python"),
    /sessions_yield and sessions_spawn are unavailable/u,
  );
});

test("R11 separates agent claims from trusted result acceptance and redacts handoffs", () => {
  const payload = {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r12",
    outcome_claim: "COMPLETE",
    reason_claim: "NONE",
    output: "validated",
    assumptions: [],
    limitations: [],
    requested_prerequisites: [],
    agent_self_validation: "Synthetic fixture checked",
  };
  const acceptance = {
    payload,
    lineage: {
      task_id: "a".repeat(64),
      brief_revision: 1,
      node_id: "python",
      agent_id: "python",
      stack_id: "intelligence",
      attempt: 1,
      native_run_id: "run-1",
    },
    governance: {
      expected_governance_hash: "b".repeat(64),
      observed_governance_hash: "b".repeat(64),
    },
    runState: "COMPLETE",
    verifierValidation: "VALID",
    resultAcceptance: "ACCEPTED",
  };
  const envelope = createTrustedResultEnvelope(acceptance);
  for (const attempt of [1, 3]) {
    const normalized = createTrustedResultEnvelope({
      ...acceptance,
      lineage: { ...acceptance.lineage, attempt },
      payload: {
        ...payload,
        outcome_claim: "FAILED",
        reason_claim: "SELF_VALIDATION_FAILED",
      },
    });
    assert.equal(
      normalized.accepted_outcome_status,
      attempt === 3 ? "FAILED" : "BLOCKED",
    );
    assert.equal(
      normalized.accepted_reason_code,
      attempt === 3 ? "RETRY_EXHAUSTED" : "VALIDATION_FAILED",
    );
  }
  const partialClaim = createTrustedResultEnvelope({
    ...acceptance,
    payload: {
      ...payload,
      outcome_claim: "PARTIAL",
      reason_claim: "OPTIONAL_BRANCH_FAILED",
    },
  });
  assert.equal(partialClaim.accepted_outcome_status, "BLOCKED");
  assert.equal(partialClaim.accepted_reason_code, "OWNER_DECISION_REQUIRED");
  for (const runState of ["CANCELLED", "UNKNOWN", "RUNNING", "FAILED"])
    assert.throws(
      () => createTrustedResultEnvelope({ ...acceptance, runState }),
      /INVALID_STATE_TRANSITION/u,
    );
  assert.throws(
    () =>
      createTrustedResultEnvelope({
        ...acceptance,
        verifierValidation: undefined,
      }),
    /VALIDATION_FAILED/u,
  );
  assert.throws(
    () =>
      createTrustedResultEnvelope({
        ...acceptance,
        resultAcceptance: undefined,
      }),
    /VALIDATION_FAILED/u,
  );
  assert.throws(
    () =>
      createTrustedResultEnvelope({
        ...acceptance,
        governance: {
          ...acceptance.governance,
          observed_governance_hash: "c".repeat(64),
        },
      }),
    /GOVERNANCE_HASH_MISMATCH/u,
  );
  assert.throws(
    () =>
      createTrustedResultEnvelope({
        ...acceptance,
        lineage: { ...acceptance.lineage, delegation_id: "d".repeat(64) },
      }),
    /LINEAGE_MISMATCH/u,
  );
  assert.equal(envelope.accepted_outcome_status, "COMPLETE");
  assert.equal(envelope.run_state, "COMPLETE");
  assert.equal(reasonEmitterAllowed("RUN_TIMEOUT", "agent"), false);
  assert.equal(reasonEmitterAllowed("RUN_TIMEOUT", "runtime"), true);
  assert.match(
    sanitizeDelegationText("token=real-secret /home/private/data.csv"),
    /REDACTED_SECRET/u,
  );
  assert.doesNotMatch(
    sanitizeDelegationText("token=real-secret /home/private/data.csv"),
    /real-secret|\/home\/private/u,
  );
});

test("R11 duplicate, aggregation and supersession rules are deterministic", () => {
  for (const downstream of [undefined, "BLOCKED", "RUNNING"]) {
    assert.equal(
      workflowAggregate([
        { required: true, accepted_outcome_status: "FAILED" },
        { required: true, accepted_outcome_status: downstream },
      ]),
      "FAILED",
      "terminal mandatory failure must not wait for dependent work",
    );
  }
  for (const nodes of [
    [],
    [{ required: true }],
    [{ required: true, outcome_status: "CANCELLED" }],
    [{ required: true, outcome_status: "RUNNING" }],
  ]) {
    assert.equal(workflowAggregate(nodes), "BLOCKED");
  }
  const base = {
    delegation_id: "d".repeat(64),
    native_run_id: "run-1",
    payload_digest: "p".repeat(64),
  };
  assert.equal(classifyDuplicate(base, base), "IDEMPOTENT_DUPLICATE");
  assert.equal(
    classifyDuplicate(base, { ...base, payload_digest: "q".repeat(64) }),
    "CONFLICT_REJECTED",
  );
  assert.equal(
    workflowAggregate([
      { required: true, outcome_status: "COMPLETE" },
      { required: false, outcome_status: "FAILED" },
    ]),
    "COMPLETE",
  );
  assert.equal(
    workflowAggregate([{ required: true, outcome_status: "PARTIAL" }]),
    "PARTIAL",
  );
  assert.equal(
    revisionCanCarryForward({
      producerStatus: "COMPLETE",
      referenceStatus: "VALID",
      dependencyDigestsMatch: true,
      constraintsUnchanged: true,
    }),
    true,
  );
  assert.equal(
    revisionCanCarryForward({
      producerStatus: "COMPLETE",
      referenceStatus: "VALID",
      dependencyDigestsMatch: false,
      constraintsUnchanged: true,
    }),
    false,
  );
});

test("budget reservations reject counter rollback and non-integer amounts", () => {
  for (const amount of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
  ]) {
    assert.throws(
      () => reserveBudget(emptySnapshot(), "task", "delegated_runs", amount),
      /positive safe integer/u,
    );
  }
  for (const counter of [NaN, -1, "0", Infinity]) {
    const snapshot = emptySnapshot();
    snapshot.tasks.task = { delegated_runs_used: counter };
    assert.throws(
      () => reserveBudget(snapshot, "task", "delegated_runs"),
      /budget exhausted/u,
    );
  }
});
