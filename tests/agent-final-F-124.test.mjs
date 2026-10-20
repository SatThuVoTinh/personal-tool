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
