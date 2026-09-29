import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  registerTools,
  evaluateToolAccess,
  isIngressSenderAuthorized,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  DISCORD_BOT_IDS,
  isAllowedDiscordSender,
  validateActionAuthority,
  validateComponentThreadCorrelation,
  validateContextVisibilityForThread,
  validateDiscordTargetGuild,
} from "../integrations/openclaw/lib/authority.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OWNER = "854005217715814432";
const IMPOSTOR = "999999999999999999";
/** A registered agent bot snowflake, from the canonical authority table. */
const AGENT_BOT_ID = DISCORD_BOT_IDS.o1;

/** The five governed execution tools the matrix must cover. */
const GOVERNED_TOOLS = [
  "zink_excel",
  "zink_power_bi",
  "zink_sql",
  "zink_python",
  "zink_n8n",
];

/** A minimal valid parameter set per tool, so schema is never the reason. */
function validParams(tool) {
  switch (tool) {
    case "zink_excel":
      return { file_path: "reports/bao_cao.xlsx" };
    case "zink_power_bi":
      return { report: "revenue" };
    case "zink_sql":
      return { query: "SELECT 1" };
    case "zink_python":
      return { code: "print(1)" };
    case "zink_n8n":
      return { workflow_id: "wf-1" };
    default:
      return {};
  }
}

function captureApi() {
  const tools = [];
  return {
    api: {
      registerTool: (def) => tools.push(def),
      pluginConfig: {},
      logger: {},
    },
    tools,
  };
}

function briefNode(agentId) {
  return {
    node_id: agentId,
    agent_id: agentId,
    stack_id: "data_plant",
    dependencies: [],
    required: true,
    input_digest: canonicalHash("zink-input-v1", "work"),
    constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
    validation_digest: canonicalHash(
      "zink-validation-v1",
      "agent-result-payload.schema.json",
    ),
  };
}

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-h3-"));
}

function seededTask(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: canonicalHash("zink-principal-v1", OWNER),
    origin_message_id: "95000000000000001",
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
    nodes: [briefNode("o1")],
  });
  return { paths, taskId };
}

describe("Lane H3 — tool authorization matrix", () => {
  it("every governed tool reaches one identical verdict on every ingress path", async () => {
    const { api, tools } = captureApi();
    registerTools(api);
    const agents = [
      "main",
      "o1",
      "o2",
      "excel",
      "power-bi",
      "sql",
      "python",
      "unknown-agent",
    ];
    for (const tool of GOVERNED_TOOLS) {
      const wrapper = tools.find((entry) => entry.name === tool);
      assert.ok(wrapper, `${tool} must be registered`);
      for (const agent of agents) {
        // Ingress path 1: the canonical resolver.
        const canonical = evaluateToolAccess(agent, tool, validParams(tool));
        // Ingress path 2: the registered wrapper, driven with trusted context.
        const response = await wrapper.execute({ agent }, validParams(tool));
        const body = JSON.parse(response.content[0].text);
        const wrapperAllowed =
          body.status !== "DENIED" && body.status !== "INVALID_PARAMETERS";
        // The wrapper must never be MORE permissive than the canonical
        // resolver. A wrapper denial where the resolver allows is acceptable
        // (an additional gate such as an unavailable backend), but the reverse
        // is a policy bypass.
        assert.equal(
          canonical.allowed || !wrapperAllowed,
          true,
          `${agent} x ${tool}: the wrapper allowed what the canonical resolver denied`,
        );
        if (!canonical.allowed) {
          assert.equal(
            wrapperAllowed,
            false,
            `${agent} x ${tool}: the wrapper must deny when the resolver denies (wrapper said ${body.status}/${body.code})`,
          );
          // The denial must carry an explicit, machine-readable code, never a
          // bare message and never a governed-looking success.
          assert.equal(
            typeof body.code === "string" && body.code.length > 0,
            true,
            `${agent} x ${tool}: a denial must name a reason code`,
          );
        }
      }
    }
  });

  it("a spoofed payload identity never changes the verdict", async () => {
    const { api, tools } = captureApi();
    registerTools(api);
    for (const tool of GOVERNED_TOOLS) {
      const wrapper = tools.find((entry) => entry.name === tool);
      const honest = JSON.parse(
        (await wrapper.execute({ agent: "main" }, validParams(tool))).content[0]
          .text,
      );
      const spoofed = JSON.parse(
        (
          await wrapper.execute(
            { agent: "main" },
            {
              ...validParams(tool),
              requesting_agent: "sql",
            },
          )
        ).content[0].text,
      );
      // "main" never executes a specialist tool. A payload claiming to be
      // "sql" must not make the call succeed; the payload identity is refused
      // at the identity gate, BEFORE the authorization verdict is reached.
      assert.equal(
        spoofed.status,
        "DENIED",
        `${tool}: a spoofed requesting_agent must not execute (honest: ${honest.status}/${honest.code})`,
      );
      assert.equal(
        spoofed.code,
        "IDENTITY_SPOOF",
        `${tool}: the refusal must name the identity conflict`,
      );
      // The trusted context is what authorization saw, and it is not permitted.
      assert.notEqual(honest.status, "OK");
    }
  });

  it("a payload identity that contradicts trusted context is refused outright", async () => {
    const { api, tools } = captureApi();
    registerTools(api);
    const wrapper = tools.find((entry) => entry.name === "zink_sql");
    const spoof = JSON.parse(
      (
        await wrapper.execute(
          { agent: "sql" },
          {
            ...validParams("zink_sql"),
            requesting_agent: "python",
          },
        )
      ).content[0].text,
    );
    assert.equal(spoof.status, "DENIED");
    assert.equal(spoof.code, "IDENTITY_SPOOF");
    // The task identity is derived from trusted context, never from the payload.
    const noIdentity = JSON.parse(
      (await wrapper.execute({}, validParams("zink_sql"))).content[0].text,
    );
    assert.equal(noIdentity.code, "IDENTITY_REQUIRED");
  });
});

describe("Lane H3 — identity matrix", () => {
  it("valid owner / wrong user / missing user / bot user", () => {
    // Valid owner.
    assert.equal(
      isIngressSenderAuthorized({ senderId: OWNER }, OWNER).ok,
      true,
    );
    assert.equal(
      isAllowedDiscordSender({ senderId: OWNER, ownerId: OWNER }),
      true,
    );
    // Wrong user.
    assert.equal(
      isIngressSenderAuthorized({ senderId: IMPOSTOR }, OWNER).ok,
      false,
    );
    assert.equal(
      isAllowedDiscordSender({ senderId: IMPOSTOR, ownerId: OWNER }),
      false,
    );
    // Missing user.
    assert.equal(isIngressSenderAuthorized({}, OWNER).ok, false);
    assert.equal(
      isIngressSenderAuthorized({ senderId: null }, OWNER).ok,
      false,
    );
    assert.equal(isAllowedDiscordSender({ ownerId: OWNER }), false);
    // Bot user, including one whose snowflake is a registered bot.
    assert.equal(
      isIngressSenderAuthorized({ senderId: OWNER, isBot: true }, OWNER).ok,
      false,
      "a bot is never the human owner",
    );
    assert.equal(
      isIngressSenderAuthorized(
        { senderId: OWNER, author: { bot: true } },
        OWNER,
      ).ok,
      false,
      "a nested bot author is never the human owner",
    );
    assert.equal(
      isAllowedDiscordSender({
        senderId: AGENT_BOT_ID,
        isBot: true,
        ownerId: OWNER,
      }),
      true,
      "a registered agent bot may act as a bot",
    );
    assert.equal(
      isAllowedDiscordSender({
        senderId: IMPOSTOR,
        isBot: true,
        ownerId: OWNER,
      }),
      false,
      "an unregistered bot is refused",
    );
  });

  it("wrong agent and spoofed requesting agent are refused at the action seam", () => {
    // Only the assigned coordinator may act on a task.
    const authorized = validateActionAuthority({
      actor: "user",
      channel: "approvals",
      taskId: "task-1",
      currentState: "APPROVAL_PENDING",
      action: "APPROVE",
      primaryCoordinator: "o1",
    });
    assert.equal(authorized.allowed, true);
    // A non-user actor can never approve.
    for (const actor of ["o1", "o2", "excel", "unknown"]) {
      const verdict = validateActionAuthority({
        actor,
        channel: "approvals",
        taskId: "task-1",
        currentState: "APPROVAL_PENDING",
        action: "APPROVE",
        primaryCoordinator: "o1",
      });
      assert.equal(
        verdict.allowed,
        false,
        `agent ${actor} must not be able to approve`,
      );
    }
    // A missing task identity is refused before any state is consulted.
    assert.equal(
      validateActionAuthority({
        actor: "user",
        channel: "approvals",
        taskId: "",
        currentState: "APPROVAL_PENDING",
        action: "APPROVE",
        primaryCoordinator: "o1",
      }).allowed,
      false,
    );
  });

  it("mismatched session key and run id are refused on the governed actions", () => {
    // Each forgery is evaluated on its own task, so the refusal under test is
    // the identity check rather than a prior question still being open.
    for (const forged of [
      { field: "session_key", value: "impostor-session" },
      { field: "run_id", value: "impostor-run" },
      { field: "agent_id", value: "impostor-agent" },
    ]) {
      const root = fixture();
      try {
        const { paths, taskId } = seededTask(root);
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
        });
        // A question is admissible only while the task is executing and the
        // root run owns it, so the claim precedes the question.
        recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
          task_id: taskId,
          agent_id: "main",
        });
        const honest = {
          task_id: taskId,
          agent_id: "main",
          question: "Which period?",
          session_key: "main-session",
          run_id: "main-run",
        };
        // A mismatched run identity is a lineage violation, never a new
        // question bound to a session string the runtime never authorised.
        assert.throws(
          () =>
            recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
              ...honest,
              [forged.field]: forged.value,
            }),
          (err) => {
            // The exact code depends on which check rejects first (an unknown
            // session never resolves; a known session under the wrong owner is
            // a lineage violation). What matters is that it is a governance
            // refusal, not a permissive outcome and not a raw exception.
            assert.equal(
              typeof err?.code === "string" &&
                /^[A-Z][A-Z0-9_]{2,63}$/u.test(err.code),
              true,
              `a forged ${forged.field} must fail with a governance code, got ${err?.code}: ${err?.message}`,
            );
            return true;
          },
          `a forged ${forged.field} must be refused`,
        );
        // The forgery created no question binding at all.
        const task = readSnapshot(paths).tasks[taskId];
        assert.equal(
          task.waiting_question_session_key,
          undefined,
          `a forged ${forged.field} must not open a question`,
        );
        assert.equal(task.workflow_status, "EXECUTING");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    // The honest identity is accepted on a clean task.
    const root = fixture();
    try {
      const { paths, taskId } = seededTask(root);
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
      recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
        task_id: taskId,
        agent_id: "main",
        question: "Which period?",
        session_key: "main-session",
        run_id: "main-run",
      });
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.waiting_question_session_key, "main-session");
      assert.equal(task.waiting_question_run_id, "main-run");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("mismatched thread and channel are refused at the correlation seams", () => {
    // Thread correlation.
    assert.equal(
      validateComponentThreadCorrelation({
        replyToThreadId: "thread-1",
        expectedThreadId: "thread-1",
      }).valid,
      true,
    );
    assert.equal(
      validateComponentThreadCorrelation({
        replyToThreadId: "thread-2",
        expectedThreadId: "thread-1",
      }).valid,
      false,
      "a reply on another thread must not act on this task",
    );
    assert.equal(
      validateComponentThreadCorrelation({
        replyToThreadId: null,
        expectedThreadId: "thread-1",
      }).valid,
      false,
      "a missing correlation is not an implicit match",
    );
    // Channel allowlist.
    assert.equal(
      validateContextVisibilityForThread({
        contextVisibility: "allowlist",
        allowlistChannelIds: ["chan-1"],
        threadChannelId: "chan-1",
      }).covered,
      true,
    );
    assert.equal(
      validateContextVisibilityForThread({
        contextVisibility: "allowlist",
        allowlistChannelIds: ["chan-1"],
        threadChannelId: "chan-2",
      }).covered,
      false,
      "a thread outside the allowlist is not covered",
    );
    // An allowlist that is present but empty covers nothing.
    assert.equal(
      validateContextVisibilityForThread({
        contextVisibility: "allowlist",
        allowlistChannelIds: [],
        threadChannelId: "chan-1",
      }).covered,
      false,
    );
  });

  it("mismatched guild is refused at the target validator", () => {
    assert.equal(
      validateDiscordTargetGuild({
        guildId: "guild-1",
        configuredGuildId: "guild-1",
        channelId: "chan-1",
        surfaceChannelIds: ["chan-1"],
      }).valid,
      true,
    );
    assert.equal(
      validateDiscordTargetGuild({
        guildId: "guild-2",
        configuredGuildId: "guild-1",
      }).valid,
      false,
      "another guild must never be a target",
    );
    assert.equal(
      validateDiscordTargetGuild({ configuredGuildId: "guild-1" }).valid,
      false,
      "a missing guild is not an implicit match",
    );
    assert.equal(
      validateDiscordTargetGuild({
        guildId: "guild-1",
        configuredGuildId: "guild-1",
        channelId: "chan-9",
        surfaceChannelIds: ["chan-1"],
      }).valid,
      false,
      "an unrecognized surface channel is refused",
    );
  });
});
