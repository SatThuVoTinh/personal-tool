// M12/T9 F-124 (legacy R1-A09-04): the announce approval card published
// model-authored prose, twice, unsanitised and silently truncated.
//
// The body is ledger-derived now (`renderGovernedApprovalBody`), but the
// buttons message still published `bodyContent.slice(0, 2000)` - a cut with no
// marker - and the body arrived twice per task: once as the thread's own
// message and once again with the buttons.
//
// Acceptance criteria: "every approval body is ledger-derived, single, and
// mention-safe."
//
// The library's own renderer is untouched: the seam marks the cut it makes,
// publishes the body once, and makes the body mention-safe before it is
// published.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { renderGovernedApprovalBody } from "../integrations/openclaw/lib/discord-formatter.mjs";
import {
  renderGovernedExpectedResult,
  renderGovernedPlanSteps,
  renderGovernedResultBody,
} from "../integrations/openclaw/lib/discord-formatter.mjs";
import { openGovernedForumThread } from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import {
  boundApprovalBody,
  buildApprovalActionLine,
  buildApprovalButtonsMessage,
  buildFirstSpawnApprovalCard,
  sanitizeApprovalBody,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "integrations",
    "openclaw",
    "plugins",
    "zink-governance",
    "index.mjs",
  ),
  "utf8",
);

/** The body of one function, by brace matching. */
function functionBody(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start > -1, `${marker} must exist`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${marker}: unbalanced body`);
}

function card(overrides = {}) {
  return buildFirstSpawnApprovalCard({
    taskId: "task-f124",
    taskCode: "ABC123DEF456",
    briefRevision: 1,
    targetAgentId: "sql",
    spawnInputs: "run the approved report query",
    spawnNodeId: "node-1",
    planNodes: [],
    previewImage: null,
    ...overrides,
  });
}

test("F-124: a body over the Discord ceiling is cut with the library's marker", () => {
  // The marker the seam uses must be the marker the renderer uses: a drift
  // between the two would mark one cut and not the other.
  const libraryBody = renderGovernedApprovalBody({
    title: "T",
    taskId: "task-f124",
    planSteps: ["x".repeat(3000)],
    expectedResult: "",
    commandToken: "ABC123DEF456",
  });
  const footerIndex = libraryBody.indexOf("\n---");
  assert.ok(footerIndex > -1, "the rendered body must carry its footer");
  const head = libraryBody.slice(0, footerIndex);
  const marker = head.slice(head.lastIndexOf("\n") + 1);
  assert.ok(marker.length > 0, "the renderer must mark its own cut");

  const truncated = boundApprovalBody("A".repeat(5000));
  assert.ok(
    truncated.endsWith(marker),
    `the seam must mark its cut with the renderer's marker: ${JSON.stringify(truncated.slice(-60))}`,
  );
  assert.ok(
    truncated.length <= 2000,
    "the marked body must fit Discord's ceiling",
  );
  const message = buildApprovalButtonsMessage("A".repeat(5000), []);
  assert.equal(message.content, truncated);
  assert.ok(message.content.length <= 2000);
});

test("F-124: a body inside the ceiling is published unchanged", () => {
  const body = "short body";
  assert.equal(boundApprovalBody(body), body);
  assert.equal(buildApprovalButtonsMessage(body, []).content, body);
});

test("F-124: the approval body is mention-safe", () => {
  const built = card({
    spawnInputs: "ping @everyone and <@123456789012345678> now",
    planNodes: [
      {
        node_id: "node-1",
        agent_id: "sql",
        inputs: "select @here from dual",
        constraints: "role <@&987654321098765432>",
        validation_criteria: "no mention",
      },
    ],
  });
  assert.doesNotMatch(built.bodyContent, /@everyone/u);
  assert.doesNotMatch(built.bodyContent, /@here/u);
  assert.doesNotMatch(built.bodyContent, /<@[!&]?\d+>/u);
  assert.doesNotMatch(built.bodyContent, /<#\d+>/u);
  // The plan itself is still there: only the mention tokens are gone.
  assert.match(built.bodyContent, /select/u);
  assert.equal(sanitizeApprovalBody("@everyone"), "");
});

test("F-124: the body is published exactly once", () => {
  const body = functionBody(
    SOURCE,
    "async function postFirstSpawnApprovalCard",
  );
  // The thread carries the body.
  assert.match(body, /postGovernedThread\(\{[\s\S]*?bodyContent/u);
  // The buttons message does NOT carry it again.
  const buttonCalls =
    body.match(/buildApprovalButtonsMessage\([^)]*\)/gu) ?? [];
  assert.equal(buttonCalls.length, 1, "exactly one buttons message");
  assert.doesNotMatch(
    buttonCalls[0],
    /bodyContent/u,
    "the buttons message must not publish the body a second time",
  );
  const threadCalls = body.match(/postGovernedThread\(\{[^}]*\}/gu) ?? [];
  assert.equal(threadCalls.length, 1, "exactly one thread post");
  assert.match(
    threadCalls[0],
    /bodyContent/u,
    "the thread is the one post that carries the body",
  );
});

test("F-124: the buttons message carries a short ledger-derived pointer", () => {
  const line = buildApprovalActionLine("task-f124");
  assert.ok(line.length < 200, "the pointer must be short");
  assert.doesNotMatch(line, /@everyone/u);
  assert.doesNotMatch(line, /<@[!&]?\d+>/u);
  assert.match(line, /task/u);
});

// M12/T9 F-463 (legacy R9-L05-1): the governed plan fields reached the approval
// and result bodies through `clipField`, which only trims and slices, so a path,
// a session key, a bearer-style token or a 64-hex digest in ledger text landed on
// a Discord-visible card. Only mentions were stripped, and only at the approval
// seam; the result body and the forum's opening message stripped nothing.
const SENTINEL_PATH = "C:\\Users\\owner\\vault\\private\\note.md";
const SENTINEL_SESSION = "sess-abcdefgh12345678";
const SENTINEL_TOKEN = "Bearer abc.def-ghi_jkl";
const SENTINEL_DIGEST = "a".repeat(64);

function assertNoIdentifiers(text, where) {
  assert.ok(!text.includes("C:\\Users"), `${where}: a path survived`);
  assert.ok(
    !text.includes(SENTINEL_SESSION),
    `${where}: a session key survived`,
  );
  assert.ok(!text.includes("abc.def"), `${where}: a token survived`);
  assert.ok(
    !text.includes(SENTINEL_DIGEST),
    `${where}: a 64-hex digest survived`,
  );
}

test("F-463: every free-text plan field is redacted before it joins a body", () => {
  const nodes = [
    {
      node_id: "node-1",
      agent_id: "sql",
      inputs: `read ${SENTINEL_PATH}`,
      constraints: `keep ${SENTINEL_SESSION} alive`,
      validation_criteria: `digest is ${SENTINEL_DIGEST}`,
    },
  ];
  const steps = renderGovernedPlanSteps(nodes).join("\n");
  assertNoIdentifiers(steps, "plan steps");
  // The field's own words survive: this is redaction, not deletion of the step.
  assert.match(steps, /read/u);
  assert.match(steps, /keep/u);
  assert.match(steps, /digest is/u);

  const expected = renderGovernedExpectedResult({
    nodes,
    outcome: `send ${SENTINEL_TOKEN} to ${SENTINEL_PATH}`,
  });
  assertNoIdentifiers(expected, "expected result");
});

test("F-463: the result body and the forum opening message are mention-safe", async () => {
  const body = renderGovernedResultBody({
    taskId: "task-f463",
    software: "@everyone",
    outcomeStatus: "COMPLETE",
    resultDigest: null,
    planSteps: renderGovernedPlanSteps([
      {
        node_id: "node-1",
        agent_id: "sql",
        inputs: "@here <@123456789012345678>",
      },
    ]),
  });
  assert.doesNotMatch(body, /@everyone|@here/u);
  assert.doesNotMatch(body, /<@[!&]?\d+>/u);

  const posted = [];
  const result = await openGovernedForumThread({
    surface: "results",
    channelId: "1",
    token: "token",
    title: "@everyone [KẾT QUẢ]",
    bodyContent: `${body}\n<#987654321098765432>`,
    selections: {},
    resolver: { resolve: async () => ({ ok: true, tagIds: [] }) },
    fetchImpl: async (_url, init) => {
      posted.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({ id: "thread-1" }),
      };
    },
    deadlineMs: 1000,
  });
  assert.equal(result.posted, true);
  assert.doesNotMatch(posted[0].message.content, /@everyone|@here/u);
  assert.doesNotMatch(posted[0].message.content, /<#[0-9]+>/u);
  assert.doesNotMatch(posted[0].name, /@everyone/u);
});
