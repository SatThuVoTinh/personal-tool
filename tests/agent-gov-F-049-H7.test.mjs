// M12/T9 F-049/H7 — the policy for an UNKNOWN Discord identity.
//
// The owner's answer (2026-10-21, `H7`): "(b) record it and flag it". F-049
// already decided HOW a third party's identity is stored — a hash, never the
// raw id — and the referential scheme is implemented. What was still missing
// is the policy for an identity the system cannot account for: it was
// recorded, but nothing MARKED it as unknown and nothing told the owner.
//
// "The roster" is this repository's own: the seven governed bot identities plus
// the owner. An identity outside both is UNKNOWN.
//
// These lanes assert the OWNED properties:
//   1. an unknown identity in a durable event is recorded HASHED and MARKED as
//      unknown, in a durable record of its own;
//   2. the owner's own identity is untouched — never marked, never refused;
//   3. a roster identity is not unknown, so a mention of a governed bot never
//      raises a flag;
//   4. the flag reaches the owner through the EXISTING governed incident path,
//      so no new outbound path is introduced.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ledgerPaths } from "../integrations/openclaw/topology/lib/ledger.mjs";
import { derivePrincipalRef } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import plugin, {
  readUnknownPrincipalRecord,
  recordWorkflowEvent,
  setUnknownPrincipalObserver,
  unknownPrincipalRecordPath,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

// The plugin's default export is the runtime entrypoint; the lanes below drive
// the exported seams directly, so the default import only proves the module
// still loads as the host loads it.
assert.equal(typeof plugin.register, "function");

const IDENTITY_KEY = "1".repeat(64);
const OWNER_ID = "123456789012345678";
const THIRD_PARTY_ID = "222222222222222222";
const PRINCIPAL_TOKEN = /\[PRINCIPAL:([a-f0-9]{64})\]/gu;
const PLUGIN_PATH = path.join(
  path.resolve(import.meta.dirname, ".."),
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);

/** A ledger root with the identity secret already published. */
function ledgerWithIdentity(tag) {
  const root = path.join(
    os.tmpdir(),
    `zink-f049-h7-${tag}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  const paths = ledgerPaths(root);
  mkdirSync(path.dirname(paths.identityKey), { recursive: true });
  writeFileSync(paths.identityKey, `${IDENTITY_KEY}\n`, "utf8");
  return { root, paths };
}

/** One task, opened by the owner, so the task's origin principal IS the owner. */
function openTask(paths, taskId = "21102026CDEF") {
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: taskId,
    origin: "discord",
    origin_principal_ref: derivePrincipalRef(IDENTITY_KEY, OWNER_ID),
    origin_message_id: "123456789012345679",
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  // The approval card the owner's verdict answers.
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: taskId,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: taskId,
    channel: "approvals",
    thread_id: "900000000000000001",
  });
}

/** The owner's verdict, whose `reason` is one of the payload's PROSE fields. */
function recordVerdict(paths, taskId, reason) {
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "REJECT",
    reason,
    thread_id: "900000000000000001",
  });
}

/** Every durable marking record the ledger holds. */
function markingRecords(paths) {
  const directory = path.join(paths.root, "unknown-principals");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) =>
      JSON.parse(readFileSync(path.join(directory, name), "utf8")),
    );
}

test("F-049/H7: an unknown identity is recorded hashed AND marked as unknown", () => {
  const { root, paths } = ledgerWithIdentity("unknown");
  try {
    openTask(paths);
    recordVerdict(
      paths,
      "21102026CDEF",
      `cc <@${THIRD_PARTY_ID}> trước khi làm`,
    );

    // 1. RECORDED, hashed: the durable journal carries the reference and never
    //    the raw id (F-049's own property, unchanged).
    const journal = readFileSync(paths.events, "utf8");
    assert.equal(
      journal.includes(THIRD_PARTY_ID),
      false,
      "a third party's account id must not reach the durable journal",
    );
    const references = [...journal.matchAll(PRINCIPAL_TOKEN)].map(
      (match) => match[1],
    );
    assert.equal(references.length, 1, "the event must carry one reference");
    const principalRef = references[0];

    // 2. MARKED: a durable, explicit fact of its own. The reader does not have
    //    to infer that the identity was unknown.
    const recordPath = unknownPrincipalRecordPath(paths, principalRef);
    assert.ok(recordPath, "the marking must have a durable path");
    assert.ok(existsSync(recordPath), "the marking must be durable");
    const record = readUnknownPrincipalRecord(paths, principalRef);
    assert.ok(record, "the marking must be readable");
    assert.equal(record.principal_ref, principalRef);
    assert.equal(
      record.known_to_the_roster,
      false,
      "the marking must state that the identity is not in the roster",
    );
    assert.equal(
      record.owner_action_required,
      true,
      "the marking must state that the owner has to look at it",
    );
    assert.equal(
      record.category,
      "UNKNOWN_PRINCIPAL",
      "the marking must be categorised, not free prose",
    );
    assert.ok(
      Array.isArray(record.occurrences) && record.occurrences.length === 1,
      "the marking must record WHERE the unknown identity appeared",
    );
    assert.equal(record.occurrences[0].task_id, "21102026CDEF");
    assert.equal(
      record.occurrences[0].event_type,
      "WORKFLOW_USER_APPROVAL_DECIDED",
    );
    // The raw id is nowhere in the durable marking.
    assert.equal(
      readFileSync(recordPath, "utf8").includes(THIRD_PARTY_ID),
      false,
      "the durable marking must never carry the raw id",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049/H7: the owner's own identity is untouched", () => {
  const { root, paths } = ledgerWithIdentity("owner");
  try {
    openTask(paths);
    recordVerdict(paths, "21102026CDEF", `anh ${OWNER_ID} xem giúp`);

    // The owner's identity is hashed in the journal (F-049's scheme) but it is
    // NOT unknown: the task's own origin principal IS the owner.
    const journal = readFileSync(paths.events, "utf8");
    assert.equal(
      journal.includes(OWNER_ID),
      false,
      "the owner's id must not reach the durable journal in the clear",
    );
    assert.match(journal, PRINCIPAL_TOKEN, "the owner is still hashed");
    assert.deepEqual(
      markingRecords(paths),
      [],
      "the owner's own identity must never be marked unknown",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049/H7: a roster identity is not unknown", () => {
  const { root, paths } = ledgerWithIdentity("roster");
  try {
    openTask(paths);
    const rosterId = Object.values(DISCORD_BOT_IDS)[0];
    recordVerdict(paths, "21102026CDEF", `nhờ <@${rosterId}> làm tiếp`);

    const journal = readFileSync(paths.events, "utf8");
    assert.equal(
      journal.includes(rosterId),
      false,
      "a roster identity is hashed like any other identity",
    );
    assert.deepEqual(
      markingRecords(paths),
      [],
      "a roster identity must never be marked unknown",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049/H7: the marked identity is surfaced through the existing incident path", () => {
  const { root, paths } = ledgerWithIdentity("surface");
  try {
    const surfaced = [];
    setUnknownPrincipalObserver((record) => {
      surfaced.push(record);
    });
    try {
      openTask(paths);
      recordVerdict(paths, "21102026CDEF", `cc <@${THIRD_PARTY_ID}>`);
    } finally {
      setUnknownPrincipalObserver(null);
    }
    assert.equal(surfaced.length, 1, "the marking must reach the surface seam");
    assert.equal(
      surfaced[0].principal_ref,
      derivePrincipalRef(IDENTITY_KEY, THIRD_PARTY_ID),
      "the surface must carry the hashed reference, never the raw id",
    );
    assert.equal(
      JSON.stringify(surfaced[0]).includes(THIRD_PARTY_ID),
      false,
      "the surface must never carry the raw id",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049/H7: the surface is the EXISTING governed incident path", () => {
  const source = readFileSync(PLUGIN_PATH, "utf8");
  const start = source.indexOf("function surfaceUnknownPrincipal(");
  assert.ok(start > 0, "the unknown-principal surface must exist");
  const body = source.slice(
    start,
    source.indexOf("function credentialUnavailable("),
  );
  assert.match(
    body,
    /surfaceGovernanceIncident\(/u,
    "the unknown identity must be surfaced through the EXISTING governed incident path",
  );
  assert.doesNotMatch(
    body,
    /\bfetch\(|postGovernedThread\(|discord\.com/gu,
    "the unknown identity must not open a NEW outbound path",
  );
});
