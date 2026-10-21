// M12/T9 F-049 — a third party's Discord identity must be stored as a HASH.
//
// The owner's ruling (2026-10-21) is "lưu dạng mã băm": store it as a hash.
// The register's own evidence named the two places a third party's account id
// reached durable, long-lived state: the ingress sanitizer, which tokenised
// ONLY the owner, and the ledger contract's payload fields, which carried the
// other party's identity verbatim.
//
// These lanes prove, at the REAL seams (the plugin's ingress sanitizer and the
// plugin's ledger write seam):
//
//   1. no prompt transcript carries a third party's Discord id in the clear;
//   2. no durable event file carries a third party's Discord id in the clear;
//   3. the same third party resolves to the SAME hashed reference across two
//      events, so the system still recognises the identity when it sees it
//      again;
//   4. the OWNER's own identity handling is unchanged: the owner's account id
//      still becomes `[OWNER_PRINCIPAL]` in a prompt, and the owner's ledger
//      principal reference is still the one the identity secret derives.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ledgerPaths } from "../integrations/openclaw/topology/lib/ledger.mjs";
import { sanitizeNativePrompt } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import { derivePrincipalRef } from "../integrations/openclaw/topology/lib/canonical.mjs";
import plugin, {
  mintUserPrincipalRef,
  recordWorkflowEvent,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const IDENTITY_KEY = "1".repeat(64);
const OWNER_ID = "123456789012345678";
const THIRD_PARTY_ID = "222222222222222222";
const PRINCIPAL_TOKEN = /\[PRINCIPAL:([a-f0-9]{64})\]/gu;

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

/** A ledger root with the identity secret already published. */
function ledgerWithIdentity(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zink-f049-${tag}-`));
  const paths = ledgerPaths(root);
  mkdirSync(path.dirname(paths.identityKey), { recursive: true });
  writeFileSync(paths.identityKey, `${IDENTITY_KEY}\n`, "utf8");
  return { root, paths };
}

/** The plugin, registered against this ledger root. */
function registerPlugin(paths) {
  plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER_ID },
    on: () => {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

/** One task, opened and given an approval card, so a verdict can be written. */
function openTaskWithCard(paths, taskId, threadId) {
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: taskId,
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "123456789012345679",
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: taskId,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: taskId,
    channel: "approvals",
    thread_id: threadId,
  });
}

test("F-049: the prompt transcript carries no third-party Discord id", async () => {
  const { root, paths } = ledgerWithIdentity("ingress");
  try {
    registerPlugin(paths);
    const sanitized = await sanitizeNativePrompt(
      nativeConfig(paths.root),
      `cc <@${THIRD_PARTY_ID}> owner=${OWNER_ID}`,
    );
    assert.equal(
      sanitized.includes(THIRD_PARTY_ID),
      false,
      "a third party's account id must not survive the ingress sanitizer",
    );
    assert.match(
      sanitized,
      /\[PRINCIPAL:[a-f0-9]{64}\]/u,
      "the third party must survive as a hashed reference",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049: no durable event carries a third-party Discord id in the clear", () => {
  const { root, paths } = ledgerWithIdentity("events");
  try {
    openTaskWithCard(paths, "21102026CDEF", "900000000000000001");
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: "21102026CDEF",
      actor: "user",
      channel: "approvals",
      decision: "REJECT",
      reason: `cc <@${THIRD_PARTY_ID}> trước khi làm`,
      thread_id: "900000000000000001",
    });
    const journal = readFileSync(paths.events, "utf8");
    assert.equal(
      journal.includes(THIRD_PARTY_ID),
      false,
      "a third party's account id must not reach the durable journal",
    );
    assert.match(
      journal,
      /\[PRINCIPAL:[a-f0-9]{64}\]/u,
      "the third party must be stored as a hashed reference",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049: the same third party resolves to the same hashed reference", () => {
  const { root, paths } = ledgerWithIdentity("stable");
  try {
    openTaskWithCard(paths, "21102026CDEF", "900000000000000001");
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: "21102026CDEF",
      actor: "user",
      channel: "approvals",
      decision: "REJECT",
      reason: `cc <@${THIRD_PARTY_ID}> lần một`,
      thread_id: "900000000000000001",
    });
    openTaskWithCard(paths, "21102026KMNP", "900000000000000002");
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: "21102026KMNP",
      actor: "user",
      channel: "approvals",
      decision: "REJECT",
      reason: `cc <@${THIRD_PARTY_ID}> lần hai`,
      thread_id: "900000000000000002",
    });
    const journal = readFileSync(paths.events, "utf8");
    const references = [...journal.matchAll(PRINCIPAL_TOKEN)].map(
      (match) => match[1],
    );
    assert.equal(
      references.length,
      2,
      "each verdict must carry exactly one hashed reference",
    );
    assert.equal(
      references[0],
      references[1],
      "the same third party must resolve to the same hashed reference",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-049: the plugin's ledger write seam keeps its renamed import", () => {
  // The plugin's ONE ledger write seam is a module-level wrapper named
  // `recordWorkflowEvent`, so the import it wraps is renamed. A second
  // binding of that name would fail to LOAD the plugin - and a plugin that
  // does not load is not a governance boundary.
  const source = readFileSync(
    path.join(
      path.resolve(import.meta.dirname, ".."),
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    ),
    "utf8",
  );
  assert.ok(
    source.includes("recordWorkflowEvent as writeWorkflowEvent"),
    "the ledger import must stay renamed: the plugin defines its own write seam",
  );
});

test("F-049: the owner's own identity handling is unchanged", async () => {
  const { root, paths } = ledgerWithIdentity("owner");
  try {
    registerPlugin(paths);
    const sanitized = await sanitizeNativePrompt(
      nativeConfig(paths.root),
      `owner=${OWNER_ID}`,
    );
    assert.match(
      sanitized,
      /\[OWNER_PRINCIPAL\]/u,
      "the owner's account id must still become the owner's own principal token",
    );
    assert.equal(
      /\[PRINCIPAL:[a-f0-9]{64}\]/u.test(sanitized),
      false,
      "the owner must never become a hashed third party",
    );
    assert.equal(
      mintUserPrincipalRef(paths, OWNER_ID),
      derivePrincipalRef(IDENTITY_KEY, OWNER_ID),
      "the owner's ledger principal reference must still be the one the identity secret derives",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
