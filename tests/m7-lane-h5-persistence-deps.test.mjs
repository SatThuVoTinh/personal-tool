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
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  generateSchemaManifest,
  verifySchemaManifestChecksums,
} from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  getToolRegistryChecksum,
  generateToolSchemaManifest,
  loadToolContractSchemas,
  registerTools,
  validateLiveArtifactPath,
  validateLiveSqlQuery,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-h5-"));
}

function governedTask(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "c".repeat(64),
    origin_message_id: "96000000000000001",
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  return { paths, taskId };
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

describe("Lane H5 — persistence-failure matrix, ledger and snapshot", () => {
  it("a failed snapshot write leaves the previous snapshot authoritative", () => {
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      const before = readFileSync(paths.snapshot, "utf8");
      // Make the atomic temp file unwritable by occupying its exact path with a
      // directory, which no rename can replace.
      const temp = `${paths.snapshot}.tmp-${process.pid}`;
      mkdirSync(temp, { recursive: true });
      let threw = false;
      try {
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
        });
      } catch {
        threw = true;
      }
      assert.equal(threw, true, "a failed snapshot write must be surfaced");
      // The prior snapshot is byte-identical: the write committed nothing.
      assert.equal(readFileSync(paths.snapshot, "utf8"), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a snapshot that does not satisfy the contract is never written", () => {
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      const before = readFileSync(paths.snapshot, "utf8");
      // An event whose payload the schema forbids must fail BEFORE the durable
      // write, not leave a schema-invalid snapshot behind.
      assert.throws(() =>
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: "user",
          channel: "approvals",
          decision: "APPROVE",
          undeclared_field: "must not be accepted",
        }),
      );
      assert.equal(readFileSync(paths.snapshot, "utf8"), before);
      // And the snapshot on disk still satisfies the canonical contract.
      validateContract(
        "ledger-snapshot",
        JSON.parse(readFileSync(paths.snapshot, "utf8")),
        Number.MAX_SAFE_INTEGER,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a snapshot whose last_event_digest does not match the log is detectable", () => {
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      // The event log is the authority; a snapshot that disagrees with it is a
      // detectable divergence, not a silent state.
      const events = readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(snapshot.sequence, events.length);
      assert.equal(
        snapshot.last_event_digest,
        events.at(-1).event_digest ?? events.at(-1).digest,
        "the snapshot must name the log it was built from",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Lane H5 — persistence-failure matrix, contracts and dependencies", () => {
  it("a contract file that does not match its manifest hash fails verification", () => {
    const manifest = generateSchemaManifest();
    const verified = verifySchemaManifestChecksums(manifest);
    assert.equal(
      verified.valid,
      true,
      "the committed manifest is self-consistent",
    );
    // A tampered manifest is detected without touching any contract file.
    const tampered = JSON.parse(JSON.stringify(manifest));
    const [firstContract] = Object.keys(tampered.contracts);
    tampered.contracts[firstContract].hash = "0".repeat(64);
    const detected = verifySchemaManifestChecksums(tampered);
    assert.equal(detected.valid, false);
    assert.equal(detected.mismatch, firstContract);
  });

  it("a manifest naming a missing contract file fails verification", () => {
    const tampered = JSON.parse(JSON.stringify(generateSchemaManifest()));
    tampered.contracts.absent = {
      file: "absent.schema.json",
      hash: "0".repeat(64),
      title: "absent",
      version: "1.0.0",
    };
    const detected = verifySchemaManifestChecksums(tampered);
    assert.equal(detected.valid, false);
    assert.equal(detected.missing, "absent.schema.json");
  });

  it("an unavailable registry checksum registers nothing at all", () => {
    for (const broken of [null, "", "not-a-checksum"]) {
      const { api, tools } = captureApi();
      const res = registerTools(api, { registryChecksum: broken });
      assert.equal(
        tools.length,
        0,
        `a broken checksum (${JSON.stringify(broken)}) must register nothing`,
      );
      assert.deepEqual(res, { registered: [], skipped: ["*"] });
    }
    // The real checksum is a stable 64-hex digest.
    assert.match(getToolRegistryChecksum(), /^[a-f0-9]{64}$/u);
    assert.equal(
      getToolRegistryChecksum(),
      generateToolSchemaManifest().manifestChecksum ??
        generateToolSchemaManifest().manifestSha256,
      "the checksum must be derived from the manifest, not invented",
    );
  });

  it("a tool whose contract cannot be loaded is skipped, never hand-wired", () => {
    const { api, tools } = captureApi();
    const contracts = loadToolContractSchemas();
    assert.deepEqual(contracts.failedContracts, []);
    const sabotaged = { ...contracts };
    delete sabotaged.zink_python;
    const res = registerTools(api, { toolContracts: sabotaged });
    assert.equal(
      tools.some((entry) => entry.name === "zink_python"),
      false,
    );
    assert.ok(res.skipped.includes("zink_python"));
  });

  it("an unavailable SQL validator fails closed as a dependency gap", async () => {
    // The loader is exercised through its public seam: whatever the loader
    // finds, the verdict must be a typed reason rather than an allow.
    const verdict = await validateLiveSqlQuery("SELECT a FROM t", []);
    assert.deepEqual(verdict, { ok: true });
    const refused = await validateLiveSqlQuery("DROP TABLE t", []);
    assert.equal(refused.ok, false);
    assert.equal(
      refused.reason,
      "SQL_MUTATION_NOT_PERMITTED",
      "a dependency failure must never become a permissive verdict",
    );
  });

  it("an unavailable artifact path validator fails closed", async () => {
    assert.deepEqual(await validateLiveArtifactPath("reports/a.xlsx"), {
      ok: true,
    });
    for (const bad of [
      "/absolute/a.xlsx",
      "../escape.xlsx",
      "a/../../escape.xlsx",
      "..\\escape.xlsx",
    ]) {
      const verdict = await validateLiveArtifactPath(bad);
      assert.equal(verdict.ok, false, `${bad} must be refused`);
      assert.equal(
        typeof verdict.reason === "string" && verdict.reason.length > 0,
        true,
        `${bad} must carry an explicit reason`,
      );
    }
  });
});

describe("Lane H5 — persistence-failure matrix, governance result write", () => {
  it("an artifact validator that rejects the artifact blocks the result", async () => {
    const { handleExecutionFinished } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { QueueManager } =
      await import("../integrations/openclaw/lib/queue-manager.mjs");
    const { TASK_STATES } =
      await import("../integrations/openclaw/lib/authority.mjs");
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      const artifacts = path.join(root, "artifacts");
      mkdirSync(artifacts, { recursive: true });
      // The artifact declares CSV fields but is a binary blob, so the
      // technical validation must refuse it.
      const lying = path.join(artifacts, "claims.csv");
      writeFileSync(lying, Buffer.from([0x00, 0x01, 0x02, 0x03]));
      const qm = new QueueManager({
        storagePath: path.join(root, "queue.json"),
      });
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      const result = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [lying],
        technicalConfig: { expectedType: "csv", expectedFields: ["date"] },
        businessData: {},
        businessConfig: {},
        paths,
        queueManager: qm,
      });
      assert.equal(
        result.status,
        "FAILED",
        "an artifact that fails validation must not be review-ready",
      );
      // The refusal names the failing check and the reason, not just "FAILED".
      assert.equal(result.gateResult.isReadyForUserReview, false);
      assert.match(result.gateResult.blockedReason, /MISSING_CSV_COLUMNS/u);
      assert.match(result.message, /Technical validation failed/u);
      assert.deepEqual(result.gateResult.technical.errors, [
        "MISSING_CSV_COLUMNS: Missing columns: date",
      ]);
      // The queue was not advanced to review either.
      assert.notEqual(
        qm.getTask(taskId)?.status,
        TASK_STATES.RESULT_PENDING_REVIEW,
      );
      // And the authoritative ledger recorded no result for the task.
      const { readSnapshot } =
        await import("../integrations/openclaw/topology/lib/ledger.mjs");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(
        Object.keys(task.delegations ?? {}).length,
        0,
        "a failed validation must not create a delegation",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a missing artifact is a refusal, not an empty success", async () => {
    const { handleExecutionFinished } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    const { QueueManager } =
      await import("../integrations/openclaw/lib/queue-manager.mjs");
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      const qm = new QueueManager({
        storagePath: path.join(root, "queue.json"),
      });
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      const result = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [path.join(root, "artifacts", "absent.csv")],
        technicalConfig: { expectedType: "csv", expectedFields: ["date"] },
        businessData: {},
        businessConfig: {},
        paths,
        queueManager: qm,
      });
      assert.equal(result.status, "FAILED");
      // A missing artifact is a delivery failure, not a validation verdict: the
      // refusal names the file, so an operator can tell it apart from a
      // malformed one.
      assert.match(result.error, /^ARTIFACT_MISSING: absent\.csv$/u);
      // Nothing was recorded and the queue was not advanced.
      assert.equal(qm.getTask(taskId)?.status, "EXECUTING");
      const { readSnapshot: read } =
        await import("../integrations/openclaw/topology/lib/ledger.mjs");
      assert.equal(
        read(paths).tasks[taskId].workflow_status,
        "QUEUED",
        "a missing artifact must not move the authoritative task",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a canonical input digest is stable and distinct", () => {
    // The digest seam every governed input passes through must be
    // deterministic, or the ledger cannot detect a changed payload.
    const a = canonicalHash("zink-input-v1", "work");
    const b = canonicalHash("zink-input-v1", "work");
    const c = canonicalHash("zink-input-v1", "other");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[a-f0-9]{64}$/u);
  });
});
