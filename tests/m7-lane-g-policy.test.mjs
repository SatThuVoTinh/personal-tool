import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import { AGENT_STACK_POLICY } from "../integrations/openclaw/lib/authority.mjs";
import {
  AGENT_SPAWN_POLICY,
  TOOL_POLICY,
  BUILT_IN_TOOL_POLICY,
  TOPOLOGY_POLICY,
} from "../integrations/openclaw/lib/policy.mjs";
import { BUDGETS } from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { resolveContractFilePath } from "../integrations/openclaw/topology/lib/schema.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) =>
  JSON.parse(readFileSync(path.join(REPO, rel), "utf8"));

function openedPayload(overrides = {}) {
  const base = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "52345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-g",
    root_run_id: "run-g",
    ...overrides,
  };
  return { ...base, task_id: deriveTaskId(base) };
}

function nodeFixture(agent_id, stack_id, node_id = "n1") {
  return {
    node_id,
    agent_id,
    stack_id,
    dependencies: [],
    required: true,
    input_digest: "a".repeat(64),
    constraints_digest: "b".repeat(64),
    validation_digest: "c".repeat(64),
  };
}

describe("Lane G — policy & lifecycle contract reconciliation", () => {
  it("M7-037/M7-038: brief activation consumes the canonical stack policy", () => {
    const payload = openedPayload({
      origin_message_id: "62345678901234567",
    });
    let snap = applyWorkflowEvent(
      { tasks: {}, sequence: 0 },
      "WORKFLOW_OPENED",
      payload,
    );
    // Canonical-valid assignment the old duplicate map rejected.
    const accepted = applyWorkflowEvent(snap, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: payload.task_id,
      brief_revision: 1,
      semantic_contract_status: "VALID",
      nodes: [nodeFixture("excel", "semantic")],
    });
    assert.deepEqual(
      accepted.tasks[payload.task_id].nodes.map((n) => n.stack_id),
      ["semantic"],
    );
    // Every canonical agent x stack activates; mismatches reject.
    for (const [agent, stacks] of Object.entries(AGENT_STACK_POLICY)) {
      for (const stack of stacks) {
        const p = openedPayload({
          origin_message_id: `7${Math.floor(Math.random() * 9)}234567890123456`,
          root_session_key: `agent:main:sess-${agent}-${stack}`,
          root_run_id: `run-${agent}-${stack}`,
        });
        const s = applyWorkflowEvent(
          { tasks: {}, sequence: 0 },
          "WORKFLOW_OPENED",
          p,
        );
        const next = applyWorkflowEvent(s, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id: p.task_id,
          brief_revision: 1,
          semantic_contract_status: "VALID",
          nodes: [nodeFixture(agent, stack)],
        });
        assert.equal(next.tasks[p.task_id].nodes.length, 1);
      }
    }
    // A pairing the canonical table does not admit is refused. M12/T9 F-060
    // (the owner's restatement of 2026-10-21) moved the `semantic` stack to
    // @O1 - the meaning layer is DATA work - so the pairing this case used
    // ("o1 on semantic") is admitted now, and the claim is carried by a
    // pairing the table refuses under both the old and the new one.
    assert.throws(
      () =>
        applyWorkflowEvent(snap, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id: payload.task_id,
          brief_revision: 1,
          semantic_contract_status: "VALID",
          nodes: [nodeFixture("o2", "data_plant")],
        }),
      { code: "UNAUTHORIZED_TARGET" },
    );
  });

  it("policy identities are derived from the canonical source, not copied", async () => {
    // Spawn topology: the guard and the live spawn path must read
    // AGENT_SPAWN_POLICY. Two inline copies previously meant a policy change
    // moved the runtime config and the manifest while leaving enforcement alone.
    const { AGENT_SPAWN_POLICY } =
      await import("../integrations/openclaw/lib/policy.mjs");
    const guardSource = readFileSync(
      new URL(
        "../integrations/openclaw/topology/lib/guard.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const pluginSource = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    for (const [label, source] of [
      ["guard", guardSource],
      ["plugin", pluginSource],
    ]) {
      assert.ok(
        source.includes("AGENT_SPAWN_POLICY"),
        `${label} must read the canonical spawn policy`,
      );
    }
    assert.deepEqual(AGENT_SPAWN_POLICY.main, ["o1", "o2"]);

    // Mention grammar: AGENT_MENTION_PATTERNS is generated from AGENT_ALIASES,
    // so an alias that ingress resolution accepts must also be routable, and an
    // alias it refuses must not be. A hand-transcribed copy let the two disagree
    // (`etl`/`analytics` in one, `tong quan`/`dieu-phoi-1` in the other).
    const { AGENT_MENTION_PATTERNS } =
      await import("../integrations/openclaw/lib/policy.mjs");
    const { AGENT_ALIASES, resolveMentionedAgents } =
      await import("../integrations/openclaw/lib/authority.mjs");
    assert.deepEqual(
      Object.keys(AGENT_MENTION_PATTERNS).sort(),
      [...new Set(Object.values(AGENT_ALIASES))].sort(),
      "the pattern map must cover exactly the agents the alias table names",
    );
    for (const alias of Object.keys(AGENT_ALIASES)) {
      const agentId = AGENT_ALIASES[alias];
      const matched = Object.entries(AGENT_MENTION_PATTERNS).filter(
        ([, patterns]) =>
          patterns.some((pattern) =>
            new RegExp(pattern, "u").test(`@${alias} x`),
          ),
      );
      assert.deepEqual(
        matched.map(([id]) => id),
        [agentId],
        `alias ${JSON.stringify(alias)} must route to exactly ${agentId}`,
      );
    }
    // An alias ingress resolution refuses must not be routable either.
    for (const absent of ["etl", "analytics", "py", "zink-excel"]) {
      assert.equal(AGENT_ALIASES[absent], undefined);
      for (const patterns of Object.values(AGENT_MENTION_PATTERNS)) {
        for (const pattern of patterns) {
          assert.equal(
            new RegExp(pattern, "u").test(`@${absent} x`),
            false,
            `${absent} is not a canonical alias and must not be routable`,
          );
        }
      }
    }
    // Every generated pattern must compile under the `u` flag. An escaped hyphen
    // inside a character class is an invalid escape and previously made the whole
    // pattern set unusable.
    for (const [agentId, patterns] of Object.entries(AGENT_MENTION_PATTERNS)) {
      for (const pattern of patterns) {
        assert.doesNotThrow(
          () => new RegExp(pattern, "u"),
          `${agentId} pattern must compile`,
        );
      }
    }
    assert.deepEqual(
      resolveMentionedAgents("@tong quan chạy"),
      ["main"],
      "sanity: the canonical resolver is the authority",
    );
  });

  it("the approval contract is authority on BOTH live approval paths", async () => {
    // The published contract used to match neither producer and was never
    // passed to validateContract, so it was decorative. It is now a oneOf over
    // the two shapes that actually exist, and it is enforced.
    const { validateContract } =
      await import("../integrations/openclaw/topology/lib/schema.mjs");
    const { canonicalHash } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const content = "# skill";
    const contentDigest = canonicalHash("zink-skill-content-v1", content);
    // Shape 1: the skill publication packet the live propose path builds.
    // A skill approval is a governance transaction with its own proposal
    // identity; it carries no workflow task id at all.
    const skillPacket = {
      schema_version: "1.0.0",
      governance_version: "m8-t2.2-r4",
      subject_type: "SKILL_CANDIDATE_APPROVAL",
      approval_id: "prop-1",
      proposal_id: "prop-1",
      brief_revision: 1,
      exact_target: "skills/excel/filter@1.0.0",
      exact_operation: "SKILL_CANDIDATE_APPROVAL",
      material_parameters: {
        namespace: "excel",
        capability: "filter",
        version: "1.0.0",
        content_sha256: contentDigest,
      },
      impact: "i",
      recovery_proposal: "r",
      issued_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      approval_scope_digest: canonicalHash(
        "zink-approval-scope-v1",
        `${"skills/excel/filter@1.0.0"}|SKILL_CANDIDATE_APPROVAL|${contentDigest}`,
      ),
      publication_status: "pending_owner_post",
      proposal: { proposal_id: "prop-1" },
    };
    // Shape 2: the governed invocation approval the guard consumes.
    const invocationApproval = {
      owner_principal_ref: "b".repeat(64),
      task_id: "c".repeat(64),
      brief_revision: 1,
      tool_id: "zink_excel",
      operation: "populate",
      exact_target: "reports/a.xlsx",
      approval_scope_digest: "d".repeat(64),
      expires_at: new Date().toISOString(),
    };
    for (const [label, record] of [
      ["skill packet", skillPacket],
      ["invocation approval", invocationApproval],
    ]) {
      assert.doesNotThrow(
        () => validateContract("approval-request", record),
        `${label} must satisfy the canonical contract`,
      );
    }
    // The contract is real: a record that violates it is refused.
    for (const [label, record] of [
      ["a non-hex task id", { ...invocationApproval, task_id: "task-test-01" }],
      [
        "a non-hex owner principal",
        { ...invocationApproval, owner_principal_ref: "owner-12345" },
      ],
      [
        "a missing required field",
        { ...invocationApproval, approval_scope_digest: undefined },
      ],
      [
        "a skill packet carrying a workflow task id",
        { ...skillPacket, task_id: "task-skill-prop-1" },
      ],
    ]) {
      assert.throws(
        () => validateContract("approval-request", record),
        (err) => {
          assert.equal(
            typeof err?.code === "string" && err.code.length > 0,
            true,
            `${label} must be refused with a code`,
          );
          return true;
        },
        `${label} must be refused`,
      );
    }
    // Both live paths enforce it, rather than one of them relying on it.
    const pluginSource = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const guardSource = readFileSync(
      new URL(
        "../integrations/openclaw/topology/lib/guard.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.ok(
      pluginSource.includes('validateContract("approval-request"'),
      "the live skill-approval packet must be validated",
    );
    assert.ok(
      guardSource.includes('validateContract("approval-request"'),
      "the governed invocation approval must be validated",
    );
  });

  it("a runtime past the pin is named, not reported as a missing file", async () => {
    // The pinned bundle names only exist for the pinned release. When a host has
    // moved past it, every artifact check fails with a raw ENOENT about a hashed
    // filename, which hides the only fact the operator needs. The version guard
    // therefore runs FIRST, against a named constant.
    const {
      inspectNativePatch,
      NATIVE_PINNED_RUNTIME_VERSION,
      NATIVE_RUNTIME_PINS,
      NATIVE_SUPPORTED_RUNTIME_VERSIONS,
    } = await import("../integrations/openclaw/topology/lib/native-patch.mjs");
    assert.match(NATIVE_PINNED_RUNTIME_VERSION, /^\d{4}\.\d+\.\d+/u);
    // The pin is keyed BY RELEASE, so a bundle hash is never ambiguous about
    // which runtime it belongs to. That structure is the fix: a single global
    // hash table is what made an upgraded host look like a missing file.
    assert.deepEqual(
      NATIVE_SUPPORTED_RUNTIME_VERSIONS,
      Object.keys(NATIVE_RUNTIME_PINS),
    );
    for (const [version, pin] of Object.entries(NATIVE_RUNTIME_PINS)) {
      assert.match(
        version,
        /^\d{4}\.\d+\.\d+/u,
        "a pin key must be an OpenClaw release",
      );
      assert.match(pin.runIdSourceSha256, /^[a-f0-9]{64}$/u);
      assert.match(pin.runIdSource, /^dist\/[A-Za-z0-9._-]+\.js$/u);
      const roles = new Set();
      for (const [file, entry] of Object.entries(pin.sources)) {
        assert.match(file, /^[A-Za-z0-9._-]+\.js$/u, `${version}: ${file}`);
        assert.match(entry.sha256, /^[a-f0-9]{64}$/u, `${version}: ${file}`);
        assert.ok(
          entry.role === "selection" ||
            entry.role === "announce" ||
            entry.role === "discord-preflight",
          `${version}: ${file} must declare a known role`,
        );
        // Every release pins selection + announce, or it silently loses run
        // admission or announce governance. M10/T2-R5 additionally pins the
        // Discord preflight bundle on the deployed lineage (2026.6.34) so
        // structured inbound metadata reaches admission; the separate
        // Windows lineage keeps its two-file pin.
        roles.add(entry.role);
      }
      const required =
        version === "2026.6.34"
          ? ["announce", "discord-preflight", "selection"]
          : ["announce", "selection"];
      assert.deepEqual(
        [...roles].sort(),
        required,
        `${version} must pin its required bundles`,
      );
    }
    const root = mkdtempSync(path.join(os.tmpdir(), "lane-pin-"));
    try {
      // A root with no manifest at all is still a governance code.
      assert.throws(
        () => inspectNativePatch(root),
        (err) => {
          assert.equal(err.message, "NATIVE_MANIFEST_UNREADABLE");
          return true;
        },
      );
      // A host on a DIFFERENT release is reported as a version mismatch that
      // names both versions, never as an absent artifact.
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "openclaw", version: "2099.1.1" }),
        "utf8",
      );
      mkdirSync(path.join(root, "dist"), { recursive: true });
      assert.throws(
        () => inspectNativePatch(root),
        (err) => {
          assert.equal(err.code, "NATIVE_VERSION_MISMATCH");
          // The error names EVERY verified release, so the operator learns what
          // is supported rather than only what was originally pinned.
          assert.deepEqual(err.expected, NATIVE_SUPPORTED_RUNTIME_VERSIONS);
          assert.equal(err.actual, "2099.1.1");
          assert.match(err.message, /unverified release is never patched/u);
          assert.doesNotMatch(err.message, /ENOENT/u);
          return true;
        },
      );
      // With the version matching but a pinned artifact absent, the failure is
      // still a governance code and it names the artifact.
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "openclaw",
          version: NATIVE_PINNED_RUNTIME_VERSION,
        }),
        "utf8",
      );
      assert.throws(
        () => inspectNativePatch(root),
        (err) => {
          assert.equal(err.code, "NATIVE_SOURCE_DRIFT");
          assert.equal(typeof err.artifact, "string");
          assert.match(err.message, /NATIVE_SOURCE_DRIFT/u);
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a native backup taken while patching is restorable", async () => {
    // `restoreNativePatch` refuses any manifest whose `runtime_version` does not
    // resolve a pin. The manifest used to be declared separately in the two apply
    // paths and the fresh-patch copy omitted `runtime_version`, so every backup
    // taken during an actual patch was unrestorable while the re-take path looked
    // fine. The builder is now shared, and this asserts the output satisfies the
    // restore predicate for every supported release.
    const {
      nativeBackupManifest,
      NATIVE_RUNTIME_PINS,
      NATIVE_SUPPORTED_RUNTIME_VERSIONS,
    } = await import("../integrations/openclaw/topology/lib/native-patch.mjs");
    const { GOVERNANCE_VERSION } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    // The manifest must be declared in exactly ONE place. The defect was two
    // declarations with divergent fields, so a second literal is the regression.
    const moduleSource = readFileSync(
      path.join(REPO, "integrations/openclaw/topology/lib/native-patch.mjs"),
      "utf8",
    );
    // M12/T9 F-185: the manifest's version is no longer a frozen literal - it
    // is stamped from the one authoritative governance-revision source
    // (`GOVERNANCE_VERSION` in `topology/lib/canonical.mjs`), so the literal
    // this test used to pin is gone. The claim the test exists to make is
    // UNCHANGED: the manifest must be declared exactly once, in the shared
    // builder. It is now pinned against the authoritative constant, so a
    // SECOND declaration of the version is still the regression it catches.
    const manifestLiterals = moduleSource.match(
      /version: GOVERNANCE_VERSION/gu,
    );
    assert.equal(
      manifestLiterals.length,
      1,
      "the backup manifest must be declared exactly once, in the shared builder",
    );
    // The manifest is now built once by `ensureNativeBackup`, which the fresh,
    // re-take and partly-patched converge paths all share. Three call sites, one
    // declaration: a second literal is the regression this test exists to catch.
    assert.equal(
      moduleSource.match(
        /ensureNativeBackup\(backupRoot, roots, inspection, version\)/gu,
      ).length,
      // M12/T9: four now - the declaration plus THREE paths (predecessor
      // upgrade, re-take and converge). The predecessor branch rewrote the
      // live runtime without taking the backup the caller handed it (F-146),
      // so it now shares the one builder like every other path. The
      // regression this test guards against is a SECOND DECLARATION, which
      // the two assertions above still pin.
      4,
      "predecessor upgrade, fresh patch, re-take and converge must all share the one backup builder",
    );
    assert.equal(
      moduleSource.match(/const next = nativeBackupManifest\(roots\);/gu)
        .length,
      1,
      "the shared builder must be the only place a manifest is constructed",
    );
    const root = mkdtempSync(path.join(os.tmpdir(), "zink-native-manifest-"));
    try {
      for (const version of NATIVE_SUPPORTED_RUNTIME_VERSIONS) {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ name: "openclaw", version }),
          "utf8",
        );
        const manifest = nativeBackupManifest(root);
        assert.equal(
          manifest.version,
          GOVERNANCE_VERSION,
          `${version}: manifest version`,
        );
        assert.equal(
          manifest.runtime_version,
          version,
          `${version}: the manifest must record the release it was taken from`,
        );
        // The exact predicate `restoreNativePatch` applies before touching a file.
        assert.ok(
          NATIVE_RUNTIME_PINS[manifest.runtime_version],
          `${version}: restore would reject this manifest as invalid`,
        );
        assert.equal(
          path.resolve(root),
          manifest.runtime_root,
          `${version}: restore resolves the root and must match`,
        );
        assert.match(manifest.bridge_digest, /^[a-f0-9]{64}$/u);
      }
      // An unreadable manifest must NOT yield a manifest that claims a version.
      rmSync(path.join(root, "package.json"));
      assert.equal(
        nativeBackupManifest(root).runtime_version,
        null,
        "an unreadable package.json must not be papered over with a version",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the ledger agent vocabulary admits ad-hoc identities by shape", () => {
    // Live-ledger migration 2026-09-29: the operational ledger journals claims
    // and results by an ad-hoc worker identity outside the seven governed
    // agents. A closed agent enum in the event contract made that legitimate
    // history unreadable without preventing anything — execution authority
    // lives in the guard's spawn topology and the reducer's run ownership, not
    // in this vocabulary. The vocabulary is therefore open-world with a shape
    // rule, so history stays readable while malformed identities still fail.
    const root = mkdtempSync(path.join(os.tmpdir(), "zink-agent-shape-"));
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      // A deterministic snowflake, not Date.now()+random: the id must always
      // satisfy the contract's snowflake rule, and a variable-length random
      // suffix made this test fail intermittently.
      let snowflake = 96000000000000001n;
      const openTask = () => {
        const messageId = String(snowflake++);
        const taskId = deriveTaskId({
          origin: "discord",
          origin_principal_ref: "b".repeat(64),
          origin_message_id: messageId,
        });
        recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
          origin: "discord",
          origin_principal_ref: "b".repeat(64),
          origin_message_id: messageId,
          task_id: taskId,
          root_agent_id: "main",
          root_session_key: "shape-session",
          root_run_id: "shape-run",
        });
        recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
          task_id: taskId,
          brief_revision: 1,
          semantic_contract_status: "VALID",
          nodes: [
            {
              node_id: "node-o1",
              agent_id: "o1",
              stack_id: "data_plant",
              dependencies: [],
              required: true,
              input_digest: "c".repeat(64),
              constraints_digest: "c".repeat(64),
              validation_digest: "c".repeat(64),
            },
          ],
        });
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
        });
        return taskId;
      };
      // The ad-hoc shape observed in the operational ledger validates and
      // replays end to end.
      const adHoc = openTask();
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: adHoc,
        agent_id: "local-laptop-worker",
      });
      assert.equal(
        readSnapshot(paths).tasks[adHoc].claimed_by,
        "local-laptop-worker",
      );
      for (const line of readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)) {
        validateContract("ledger-event", JSON.parse(line));
      }
      // Every governed identity still validates.
      for (const agent of [
        "main",
        "o1",
        "o2",
        "excel",
        "power-bi",
        "sql",
        "python",
      ]) {
        const taskId = openTask();
        recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
          task_id: taskId,
          agent_id: agent,
        });
        assert.equal(readSnapshot(paths).tasks[taskId].claimed_by, agent);
      }
      // Malformed identities are still refused: the shape rule bites.
      for (const bad of [
        "",
        "UPPER",
        "-leading",
        "has space",
        "a".repeat(65),
      ]) {
        const taskId = openTask();
        assert.throws(
          () =>
            recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
              task_id: taskId,
              agent_id: bad,
            }),
          (err) => {
            assert.equal(typeof err?.code === "string", true);
            return true;
          },
          `agent_id ${JSON.stringify(bad)} must be refused`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("M7-039: policy artifacts project the canonical sources", () => {
    const manifest = readJson(
      "integrations/openclaw/topology/policy/role-capability-manifest.json",
    );
    assert.ok(!manifest._deprecated);
    for (const role of manifest.roles) {
      assert.deepEqual(
        [...role.allowAgents].sort(),
        [...(AGENT_SPAWN_POLICY[role.id] ?? [])].sort(),
        `${role.id} spawn topology`,
      );
      assert.deepEqual(
        [...role.capabilities].sort(),
        [...(TOOL_POLICY[role.id] ?? [])].sort(),
        `${role.id} callable capabilities`,
      );
      assert.deepEqual(
        [...role.tools].sort(),
        [...(BUILT_IN_TOOL_POLICY[role.id] ?? [])].sort(),
        `${role.id} builtin tools`,
      );
    }
    const workflowPolicy = readJson(
      "integrations/openclaw/topology/policy/workflow-policy.json",
    );
    assert.equal(
      workflowPolicy.budgets.maxBriefRevisionsPerTask,
      BUDGETS.maxBriefRevisionsPerTask,
    );
    assert.equal(
      workflowPolicy.budgets.maxStackTransitionsPerTask,
      BUDGETS.maxStackTransitionsPerTask,
    );
    assert.equal(
      workflowPolicy.budgets.maxTotalDelegatedRunsPerTask,
      BUDGETS.maxTotalDelegatedRunsPerTask,
    );
    assert.equal(
      workflowPolicy.runtime.maxSpawnDepth,
      TOPOLOGY_POLICY.maxSpawnDepth,
    );
    assert.equal(
      workflowPolicy.runtime.maxConcurrent,
      TOPOLOGY_POLICY.maxConcurrent,
    );
    const transitions = readJson(
      "integrations/openclaw/topology/policy/state-transitions.json",
    );
    // The file is explicitly NOT runtime authority: it is a human-readable
    // projection that must therefore never contradict the reducer it mirrors.
    assert.ok(
      typeof transitions._note === "string" &&
        transitions._note.includes("NOT runtime authority"),
    );
    assert.ok(
      Array.isArray(transitions._canonical_sources) &&
        transitions._canonical_sources.length > 0,
    );
    // It must cover every state the snapshot contract declares, and must permit
    // the transitions the reducer actually performs. A projection that omits
    // states is a trap for the next reader.
    const snapshot = JSON.parse(
      readFileSync(
        new URL(
          "../integrations/openclaw/topology/contracts/ledger-snapshot.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const declared = Object.values(
      snapshot.properties.tasks.patternProperties,
    )[0]
      .oneOf.map((candidate) => candidate.properties?.workflow_status?.enum)
      .find(Boolean);
    assert.deepEqual(
      Object.keys(transitions.workflow_status).sort(),
      [...declared].sort(),
      "the projection must cover exactly the states the contract declares",
    );
    // M8-056: reconciling a documented transient failure stamps the old attempt
    // FAILED. The projection used to omit this edge entirely.
    assert.deepEqual(transitions.run_state.UNKNOWN, ["FAILED"]);
    assert.deepEqual(
      Object.keys(transitions.run_state).sort(),
      [
        "CANCELLED",
        "COMPLETE",
        "FAILED",
        "RUNNING",
        "SPAWN_UNKNOWN",
        "UNKNOWN",
      ],
      "the run projection must cover exactly the run states the reducer produces",
    );
  });

  it("M7-063: no machine-specific paths in governance resolution", () => {
    for (const rel of [
      "integrations/openclaw/topology/lib/schema.mjs",
      "integrations/openclaw/topology/lib/guard.mjs",
    ]) {
      const src = readFileSync(path.join(REPO, rel), "utf8");
      assert.ok(!src.includes("/mnt/c/Users/HOANG VINH"), `${rel} WSL path`);
      assert.ok(!src.includes("C:/Users/HOANG VINH"), `${rel} Windows path`);
    }
    const resolved = resolveContractFilePath("zink-sql");
    assert.ok(resolved && resolved.includes("zink-tools"));
  });

  it("M7-044: native-end timestamp aligns contract and implementation", () => {
    const taskId = "d".repeat(64);
    const base = {
      tasks: {
        [taskId]: {
          workflow_status: "ACTIVE",
          brief_state: "ACTIVE",
          brief_revision: 1,
          delegations: {
            d1: {
              delegation_id: "d1",
              native_run_id: "nr1",
              child_session_key: "cs1",
              parent_session_key: "ps1",
              run_state: "RUNNING",
              brief_revision: 1,
            },
          },
        },
      },
      sequence: 0,
    };
    const event = {
      task_id: taskId,
      native_run_id: "nr1",
      child_session_key: "cs1",
      parent_session_key: "ps1",
      outcome: "error",
    };
    const stamped = applyWorkflowEvent(
      base,
      "WORKFLOW_NATIVE_ENDED",
      { ...event, recorded_at: "2026-09-01T00:00:00.000Z" },
      "2026-09-28T00:00:00.000Z",
    );
    assert.equal(
      stamped.tasks[taskId].delegations.d1.recovery_needed_at,
      "2026-09-01T00:00:00.000Z",
    );
    const defaulted = applyWorkflowEvent(
      base,
      "WORKFLOW_NATIVE_ENDED",
      { ...event },
      "2026-09-28T00:00:00.000Z",
    );
    assert.equal(
      defaulted.tasks[taskId].delegations.d1.recovery_needed_at,
      "2026-09-28T00:00:00.000Z",
    );
    assert.throws(
      () =>
        applyWorkflowEvent(base, "WORKFLOW_NATIVE_ENDED", {
          ...event,
          recorded_at: "not-a-time",
        }),
      { code: "SCHEMA_INVALID" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(base, "WORKFLOW_NATIVE_ENDED", {
          ...event,
          recorded_at: "1970-01-01T00:00:00.000Z",
          extra: true,
        }),
      { code: "SCHEMA_INVALID" },
    );
  });
});
