// M12/T9-R4 lane L3 (fix-tools) — F-448 (legacy R9-L07a-3) and F-555 (legacy
// R10-T06-7).
//
// The skill adapter used to forward raw error text into the governed envelope:
// the proposal-persistence catch interpolated `${error?.message}` into the
// thrown sentence, and the outer catch returned `message: error.message`
// verbatim. A Node fs error embeds the absolute path it tried to open, so
// operator-filesystem topology reached the model-facing sink. The sibling
// knowledge adapter already returns fixed sentences (F-145 rule); this adapter
// now does the same: fixed sentence + code out, raw detail only to a trusted
// sink.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SkillAdapter } from "../zink-tools/adapters/skill-store/skill-adapter.mjs";

const LEAKED_PATH = path.join(
  os.homedir(),
  "operator-home",
  "zink",
  "state.json",
);

function assertNoPathCharacters(text, label) {
  assert.ok(!text.includes("/"), `${label}: no forward slash — got: ${text}`);
  assert.ok(
    !/[A-Za-z]:\\/.test(text),
    `${label}: no drive-letter path — got: ${text}`,
  );
  assert.ok(
    !text.includes(LEAKED_PATH),
    `${label}: leaked absolute path — got: ${text}`,
  );
  assert.ok(
    !text.includes("operator-home"),
    `${label}: leaked path fragment — got: ${text}`,
  );
  assert.ok(!text.includes("\\"), `${label}: no backslash — got: ${text}`);
}

test("F-555: a thrown fs-style error returns a fixed sentence plus the code, raw text only to the trusted sink", async () => {
  const sink = [];
  const adapter = new SkillAdapter(undefined, {
    embedFn: async () => [new Array(1024).fill(0.1)],
    dbExecutor: async () => {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, open '${LEAKED_PATH}'`),
        { code: "ENOENT" },
      );
    },
    onAdapterFailure: (record) => sink.push(record),
  });

  const envelope = await adapter.querySkillStore({
    action: "search",
    query: "x",
  });
  assert.equal(envelope.governed_status, "CONTROLLED_FAILURE");
  // R10-T06-1: the code survives.
  assert.equal(envelope.error, "ENOENT");
  // F-555/F-448: the sentence is fixed; no path characters reach the envelope.
  assertNoPathCharacters(envelope.message, "envelope.message");
  assert.match(
    envelope.message,
    /^\[ENOENT\] The Skill Store request could not be completed\.$/u,
  );
  // The raw detail went to the trusted sink instead.
  assert.equal(sink.length, 1);
  assert.equal(sink[0].code, "ENOENT");
  assert.ok(
    sink[0].error instanceof Error && sink[0].error.message.includes("ENOENT"),
    "the trusted sink receives the raw error",
  );
});

test("F-448: proposal-persistence failure throws the fixed canonical sentence, not the fs message", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "l3-f448-"));
  // Fault injection: proposalStorageDir lives UNDER a regular file, so the
  // atomic write helper fails with an fs error whose message carries the
  // absolute path. Scratch-only; no live state is touched.
  const blocker = path.join(scratch, "blocker-file");
  fs.writeFileSync(blocker, "not a directory");
  const proposalStorageDir = path.join(blocker, "proposals");
  const sink = [];
  const adapter = new SkillAdapter(undefined, {
    proposalStorageDir,
    onAdapterFailure: (record) => sink.push(record),
  });

  await t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      adapter.querySkillStore({
        action: "propose",
        namespace: ["office"],
        capability: "failure-envelope-skill",
        version: "1.0.0",
        content: "# Fixed Sentence\n\nGoverned content.",
        reason: "F-448 fixed-sentence probe",
        requesting_agent: "excel",
      }),
    (error) => {
      assert.equal(error.code, "SKILL_PROPOSAL_PERSIST_FAILED");
      assertNoPathCharacters(error.message, "SkillAdapterError.message");
      assert.match(
        error.message,
        /^\[SKILL_PROPOSAL_PERSIST_FAILED\] The skill proposal could not be persisted\.$/u,
      );
      return true;
    },
  );
  assert.equal(
    sink.length,
    1,
    "raw detail must reach the trusted sink exactly once",
  );
  assert.equal(sink[0].code, "SKILL_PROPOSAL_PERSIST_FAILED");
});

test("F-555 gate: zero `message: error.message` occurrences under zink-tools/adapters/**", () => {
  const root = new URL("../zink-tools/adapters/", import.meta.url);
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) {
        const src = fs.readFileSync(full, "utf8");
        const lines = src.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("message: error.message")) {
            hits.push(`${full.pathname}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(root);
  assert.deepEqual(
    hits,
    [],
    "the row's gate predicate must stay at zero hits under zink-tools/adapters",
  );
});
