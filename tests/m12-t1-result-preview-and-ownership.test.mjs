// M12/T1-R1 Phase 4 — the expected-result image and who is allowed to send it.
//
// Owner instruction: "Kết quả: Trả về hình ảnh kết quả dự kiến, ưu tiên hình ảnh trùng
// khớp với giao diện Excel, SQL, Python, PowerBI" and option D, "sau khi accept thì chính
// bot O1 trả về kết quả chứ không phải main". These tests pin the renderer, the attachment
// confinement, and the provenance rule that replaced the blanket specialist suppression.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RESULT_PREVIEW_BRANDS,
  buildPreviewTable,
  renderExpectedResultPreview,
} from "../integrations/openclaw/lib/discord-result-preview.mjs";
import { formatGovernedResultCard } from "../integrations/openclaw/lib/discord-formatter.mjs";
import {
  assertMediaInsideRoots,
  sendNativePayload,
} from "../integrations/openclaw/lib/discord-native-send.mjs";
import governancePlugin, { evaluateSpecialistProvenance } from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import {
  checkpointDigest,
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function tempRoot(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `m12t1-${tag}-`));
}

describe("M12/T1 P4 — the expected-result preview", () => {
  it("writes a real PNG and brands it with the target screen", () => {
    const root = tempRoot("preview");
    try {
      const excel = renderExpectedResultPreview({
        target: "excel",
        title: "TASK 13102026CDEF",
        columns: [" thang", " Doanh thu ", " Đơn "],
        rows: [["01/2026", "120.000.000", "34"]],
        outputDirectory: root,
      });
      assert.match(
        path.basename(excel),
        /^expected_result_excel_[0-9a-f]{16}\.png$/u,
        "F-468: the name is target-scoped AND content-scoped",
      );
      const bytes = readFileSync(excel);
      assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE);
      assert.ok(bytes.length > 1000, "a blank canvas is not a preview");

      const powerBi = renderExpectedResultPreview({
        target: "power-bi",
        title: "TASK 13102026CDEF",
        outputDirectory: root,
      });
      assert.notDeepEqual(readFileSync(powerBi), bytes);
      assert.equal(Object.keys(RESULT_PREVIEW_BRANDS).includes("sql"), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("F-468: two same-target renders keep their own image, not the last writer's", () => {
    // The preview root is the SHARED `main` agent sandbox and the card's
    // `mediaUrl` is resolved after the thread-post await, so a second in-flight
    // task for the same targetAgentId used to overwrite the first task's PNG
    // inside the render -> await -> upload window and the first card attached
    // the second task's screen.
    const root = tempRoot("f468");
    try {
      const first = renderExpectedResultPreview({
        target: "excel",
        title: "TASK 13102026AAAA",
        columns: [" thang", " Doanh thu "],
        rows: [["01/2026", "120.000.000"]],
        outputDirectory: root,
      });
      const firstBytes = readFileSync(first);
      const second = renderExpectedResultPreview({
        target: "excel",
        title: "TASK 13102026BBBB",
        columns: [" thang", " Doanh thu "],
        rows: [["02/2026", "999.000.000"]],
        outputDirectory: root,
      });
      assert.notEqual(
        second,
        first,
        "a second same-target render must not reuse the first card's path",
      );
      assert.deepEqual(
        readFileSync(first),
        firstBytes,
        "the first card's image must survive the overlapping render",
      );
      assert.notDeepEqual(
        readFileSync(second),
        firstBytes,
        "each returned path carries its own image",
      );
      // Content-scoped, not call-scoped: the same brief re-renders onto the
      // same file, so a retry does not accumulate residue in the shared root.
      const repeat = renderExpectedResultPreview({
        target: "excel",
        title: "TASK 13102026AAAA",
        columns: [" thang", " Doanh thu "],
        rows: [["01/2026", "120.000.000"]],
        outputDirectory: root,
      });
      assert.equal(repeat, first, "identical content stays one file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("labels what the plan never declared instead of inventing data", () => {
    const { headers, rows } = buildPreviewTable({
      columns: [],
      rows: [],
      notes: "",
    });
    assert.deepEqual(headers, ["(cột sẽ được xác định khi chạy)"]);
    assert.match(rows[0][0], /chua khai bao|du kien/u);
    const declared = buildPreviewTable({
      columns: ["month", "revenue"],
      rows: [["01/2026"]],
    });
    assert.deepEqual(declared.rows, [["01/2026", ""]]);
  });

  it("refuses to write outside an absolute, traversal-free directory", () => {
    assert.throws(
      () =>
        renderExpectedResultPreview({ target: "sql", outputDirectory: "out" }),
      /RESULT_PREVIEW_OUTPUT_DIR_REQUIRED/u,
    );
    assert.throws(
      () =>
        renderExpectedResultPreview({
          target: "sql",
          outputDirectory: path.resolve(os.tmpdir()) + path.sep + "..",
        }),
      /RESULT_PREVIEW_OUTPUT_DIR_UNSAFE/u,
    );
  });
});

describe("M12/T1 P4 — attachment confinement", () => {
  it("accepts only a file inside a declared root", () => {
    const root = tempRoot("media");
    try {
      const inside = path.join(root, "expected_result_excel.png");
      assert.equal(assertMediaInsideRoots(inside, [root]), inside);
      assert.throws(
        () =>
          assertMediaInsideRoots(path.join(os.tmpdir(), "elsewhere.png"), [
            root,
          ]),
        /MEDIA_PATH_OUTSIDE_ROOTS/u,
      );
      assert.throws(
        () => assertMediaInsideRoots(`${root}/../escape.png`, [root]),
        /MEDIA_PATH_UNSAFE/u,
      );
      assert.throws(
        () => assertMediaInsideRoots(inside, []),
        /MEDIA_LOCAL_ROOTS_REQUIRED/u,
      );
      assert.throws(
        () => assertMediaInsideRoots("", [root]),
        /MEDIA_URL_REQUIRED/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // M12/T9 F-039: the containment was a lexical prefix test, so a link inside a
  // declared root that points OUTSIDE it passed. The sibling attachment
  // containment already resolves the real path; this boundary must not be the
  // weaker twin.
  it("refuses a linked media path that resolves outside the declared root", () => {
    const root = tempRoot("media-link");
    const outside = tempRoot("media-outside");
    const link = path.join(root, "j");
    try {
      const secret = path.join(outside, "host-secret.png");
      writeFileSync(secret, PNG_SIGNATURE);
      symlinkSync(outside, link, "junction");
      assert.throws(
        () =>
          assertMediaInsideRoots(path.join(link, "host-secret.png"), [root]),
        /MEDIA_PATH_OUTSIDE_ROOTS/u,
        "a link that leaves the declared root must be refused",
      );
    } finally {
      rmSync(link, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("passes the media through the host payload with its roots", async () => {
    const root = tempRoot("payload");
    try {
      const media = path.join(root, "preview.png");
      const calls = [];
      const api = {
        runtime: {
          channel: {
            outbound: {
              loadAdapter: async () => ({
                sendPayload: async (ctx) => {
                  calls.push(ctx);
                  return { messageId: "msg-media", channelId: "chan-1" };
                },
              }),
            },
          },
        },
      };
      const receipt = await sendNativePayload({
        api,
        to: "chan-1",
        accountId: "o1",
        payload: { text: "🖼️ kết quả dự kiến" },
        mediaUrl: media,
        mediaLocalRoots: [root],
      });
      assert.equal(receipt.messageId, "msg-media");
      assert.equal(calls[0].payload.mediaUrl, media);
      assert.deepEqual(calls[0].payload.mediaLocalRoots, [path.resolve(root)]);
      assert.equal(
        existsSync(media),
        false,
        "the transport must not create the file",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to put a card and an image in one message", async () => {
    const root = tempRoot("both");
    try {
      const api = {
        runtime: {
          channel: {
            outbound: {
              loadAdapter: async () => ({
                sendPayload: async () => ({ messageId: "x", channelId: "y" }),
              }),
            },
          },
        },
      };
      await assert.rejects(
        () =>
          sendNativePayload({
            api,
            to: "chan-1",
            payload: { text: "card" },
            buttons: [
              {
                customId: "occomp:cid=zink:approval:approve:13102026CDEF:1",
                label: "Approve",
                style: 3,
              },
            ],
            mediaUrl: path.join(root, "preview.png"),
            mediaLocalRoots: [root],
            sdk: {
              buildDiscordComponentMessage: () => ({
                components: [],
                entries: [],
              }),
              registerBuiltDiscordComponentMessage: () => {},
            },
          }),
        /cannot also carry media/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M12/T1 P4 — the executing specialist may report its own task", () => {
  it("F-OC-007: message_sending hook refuses a superseded run ID and admits current run ID", async () => {
    const root = tempRoot("f-oc-007");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);

      const nextMessageId = "1556249093729427470";
      const origin = {
        origin: "discord",
        origin_principal_ref: "a".repeat(64),
        origin_message_id: nextMessageId,
      };
      const taskId = deriveTaskId(origin);
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id: taskId,
        root_agent_id: "main",
        root_session_key: "main-session",
        root_run_id: "main-run",
      });

      const nodeDef = (agentId) => ({
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
      });

      recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
        task_id: taskId,
        brief_revision: 1,
        semantic_contract_status: "VALID",
        nodes: [nodeDef("o1"), nodeDef("excel")],
      });

      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
        brief_revision: 1,
      });

      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "o1",
      });

      const coordinator = buildSpawnProposal({
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
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", coordinator);
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id: taskId,
        delegation_id: coordinator.delegation_id,
        native_run_id: "o1-run-1",
        child_session_key: "o1-session-1",
        agent_id: "o1",
        parent_session_key: "main-session",
      });

      const specialist = buildSpawnProposal({
        task_id: taskId,
        brief_revision: 1,
        node_id: "excel",
        agent_id: "excel",
        parent_agent_id: "o1",
        parent_session_key: "o1-session-1",
        parent_run_id: "o1-run-1",
        tool_call_id: "call-1",
        turn: 1,
        attempt: 1,
        expected_governance_hash: governanceHash("excel"),
      });
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", specialist);
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id: taskId,
        delegation_id: specialist.delegation_id,
        native_run_id: "excel-run-2",
        child_session_key: "agent:excel:task-1",
        agent_id: "excel",
        parent_session_key: "o1-session-1",
      });

      // Update snapshot to add previous_native_run_ids
      const snap = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      const del = Object.values(snap.tasks[taskId].delegations).find(
        (d) => d.agent_id === "excel",
      );
      del.previous_native_run_ids = ["excel-run-1"];
      writeFileSync(paths.snapshot, JSON.stringify(snap, null, 2), "utf8");

      // Re-write checkpoint with the new tasks
      const cpFile = path.join(paths.root, "checkpoint.json");
      const cp = JSON.parse(readFileSync(cpFile, "utf8"));
      const eventsBuf = readFileSync(paths.events);
      cp.prefix_digest = checkpointDigest(
        eventsBuf.subarray(0, cp.events_offset),
        snap.tasks,
      );
      writeFileSync(cpFile, JSON.stringify(cp, null, 2), "utf8");

      const hooks = new Map();
      const logs = [];
      governancePlugin.register({
        pluginConfig: {
          ledgerRoot: paths.root,
          ownerDiscordId: "123456789012345678",
          approvalsChannelId: "1556249093729427459",
          resultsChannelId: "1556249093729427460",
          officeChannelId: "1556249093729427461",
          enabled: true,
        },
        on: (name, fn) => hooks.set(name, fn),
        registerTool: () => {},
        logger: {
          warn: (m) => logs.push("warn:" + m),
          info: (m) => logs.push("info:" + m),
          error: (m) => logs.push("error:" + m),
        },
      });

      const hook = hooks.get("message_sending");
      assert.ok(
        typeof hook === "function",
        "message_sending hook must be registered",
      );

      const event = {
        content: "Result payload from excel",
        channelId: "1556249093729427460",
      };

      // 1. Superseded run ("excel-run-1") must be blocked
      const supersededCtx = {
        channelId: "discord",
        sessionKey: "agent:excel:task-1",
        agentId: "excel",
        runId: "excel-run-1",
      };
      const supersededResult = await hook(event, supersededCtx);
      assert.deepEqual(
        supersededResult,
        { block: true, cancel: true },
        "message from superseded run ID must be blocked",
      );

      const currentCtx = {
        channelId: "discord",
        sessionKey: "agent:excel:task-1",
        agentId: "excel",
        runId: "excel-run-2",
      };
      const currentResult = await hook(event, currentCtx);
      assert.equal(
        currentResult?.block,
        undefined,
        "message from current run ID must be admitted",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits a specialist whose task the owner approved and that is executing", () => {
    const admitted = evaluateSpecialistProvenance({
      agentId: "excel",
      task: {
        task_id: "13102026CDEF",
        approved_at: "2026-10-13T03:00:00.000Z",
        claimed_at: "2026-10-13T03:01:00.000Z",
        workflow_status: "EXECUTING",
      },
      delegationAgentId: "excel",
    });
    assert.deepEqual(admitted, { allowed: true, taskId: "13102026CDEF" });
    assert.equal(
      evaluateSpecialistProvenance({
        agentId: "sql",
        task: {
          task_id: "13102026CDEF",
          approved_at: "x",
          workflow_status: "RESULT_PENDING_REVIEW",
        },
      }).allowed,
      true,
    );
  });

  it("admits a task that is active but already claimed, and the admitted set is the production's own", () => {
    // M12/T9 F-316: the rule admits three situations, but the claimed-active
    // clause appeared in the fixtures ONLY as a denial built without the claim
    // timestamp, so the clause was never exercised and deleting it changed
    // nothing. This is the executed positive case for it.
    const admitted = evaluateSpecialistProvenance({
      agentId: "excel",
      task: {
        task_id: "13102026CDEF",
        approved_at: "2026-10-13T03:00:00.000Z",
        claimed_at: "2026-10-13T03:01:00.000Z",
        workflow_status: "ACTIVE",
      },
      delegationAgentId: "excel",
    });
    assert.deepEqual(admitted, { allowed: true, taskId: "13102026CDEF" });

    // And the status matrix is asserted EQUAL to the production's own
    // vocabulary: the admitted set is derived from the rule itself, so a
    // change to the rule reddens this assertion instead of passing silently.
    const admittedStatuses = [
      "ACTIVE",
      "COMPLETE",
      "EXECUTING",
      "RESULT_PENDING_REVIEW",
      "REJECTED",
    ].filter(
      (status) =>
        evaluateSpecialistProvenance({
          agentId: "excel",
          task: {
            task_id: "13102026CDEF",
            approved_at: "2026-10-13T03:00:00.000Z",
            claimed_at: "2026-10-13T03:01:00.000Z",
            workflow_status: status,
          },
        }).allowed,
    );
    assert.deepEqual(
      admittedStatuses,
      ["ACTIVE", "EXECUTING", "RESULT_PENDING_REVIEW"],
      "the admitted status set must be the production's own vocabulary",
    );
  });

  it("still blocks everything that is not its own approved running work", () => {
    const cases = [
      [{ agentId: "excel", task: null }, "TASK_NOT_KNOWN"],
      [
        { agentId: "excel", task: { workflow_status: "EXECUTING" } },
        "TASK_NOT_APPROVED",
      ],
      [
        {
          agentId: "excel",
          task: { approved_at: "x", workflow_status: "ACTIVE" },
        },
        "TASK_NOT_EXECUTING:ACTIVE",
      ],
      [
        {
          agentId: "excel",
          task: { approved_at: "x", workflow_status: "COMPLETE" },
        },
        "TASK_NOT_EXECUTING:COMPLETE",
      ],
      [
        {
          agentId: "excel",
          task: { approved_at: "x", workflow_status: "EXECUTING" },
          delegationAgentId: "python",
        },
        "TASK_NOT_OWNED_BY_THIS_AGENT",
      ],
      [
        {
          agentId: "",
          task: { approved_at: "x", workflow_status: "EXECUTING" },
        },
        "NO_AGENT_IDENTITY",
      ],
    ];
    for (const [input, reason] of cases) {
      const verdict = evaluateSpecialistProvenance(input);
      assert.equal(verdict.allowed, false, `${reason} must stay blocked`);
      assert.equal(verdict.reason, reason);
    }
  });
});

// =========================================================================
// M12/T9 F-301 — the card told the owner the preview image was ATTACHED, and
// no outbound path in the integration can attach a file: the governed publish
// helper takes no file argument and the transport builds a JSON body.
//
// The card now states the truth — the preview is rendered on the host and is
// named for the record, and it is NOT attached to this message. The renderer
// is NOT dropped: the governance policy still requires a real rendered
// preview, and it still produces one.
// =========================================================================
describe("M12/T9 F-301 — the card does not claim an attachment it cannot make", () => {
  it("F-301: the card states the preview is on the host, not attached", () => {
    const card = formatGovernedResultCard({
      taskId: "13102026CDEF",
      attempt: 1,
      executionStatus: "EXECUTION_FINISHED",
      technicalValidation: "PASS",
      businessValidation: "PASS",
      preview: "| A | B |\n| 1 | 2 |",
      previewImage: "expected_result_excel.png",
      artifact: "s3://bucket/result.xlsx",
      keyFindings: "Sản lượng tăng 15%",
    });
    assert.equal(
      card.includes("đã đính kèm"),
      false,
      "the card must not claim the image is attached: no governed outbound path can attach a file",
    );
    assert.match(
      card,
      /KHÔNG đính kèm/u,
      "the card must say the preview is not attached to this message",
    );
    assert.match(card, /expected_result_excel\.png/);
  });

  it("F-301: the renderer still produces a real PNG on the host", () => {
    const root = tempRoot("f301");
    try {
      const rendered = renderExpectedResultPreview({
        target: "excel",
        title: "Kết quả dự kiến",
        columns: ["SKU", "Qty"],
        rows: [["A1", 100]],
        outputDirectory: root,
      });
      assert.ok(existsSync(rendered), "the preview PNG must really be written");
      const bytes = readFileSync(rendered);
      assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [...PNG_SIGNATURE],
        "the preview must be a real PNG",
      );
      assert.ok(bytes.length > 1000, "the preview must carry real pixels");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
