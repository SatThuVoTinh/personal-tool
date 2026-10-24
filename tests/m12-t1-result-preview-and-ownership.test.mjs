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
import { evaluateSpecialistProvenance } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

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
