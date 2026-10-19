// M12/T2.2-R1 A-2 — one stack registry, and a stack-scope denial that names the
// right thing (`R1-A04-05`).
//
// Two registries existed. `policy.mjs` exported a FOUR-member `STACK_IDS`
// (`data_plant, semantic, intelligence, decision`, no `infrastructure`) while
// `guard.mjs` held a module-level FIVE-member copy in a different order — and
// then overwrote that copy with the four-member export as soon as the policy
// module loaded, so the guard's own correct default was dead code and the
// effective runtime registry lost `infrastructure`. Every topology contract
// (`execution-brief`, `ledger-event`, `ledger-snapshot`,
// `trusted-result-envelope`, `delegation-envelope`) declares FIVE, and
// `AGENT_STACK_POLICY` grants `infrastructure` to `main` and `o1`.
//
// The consequence was a lying denial: the delegation-authority stack check
// refused a present, valid, correctly scoped `infrastructure` delegation with
// `AUTH_DELEGATION_NOT_FOUND` — it reported "this delegation cannot be found"
// for a delegation it had just read.
//
// These tests pin the registry against the CONTRACT (the schema file on disk),
// not against another literal, because a second literal is exactly how the two
// drifted apart. Where a claim is behavioural it drives the real guard over a
// real ledger pair and asserts the durable effect too, the convention
// `tests/m12-t2.2-a1-stack-authority.test.mjs` establishes.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  AGENT_SPAWN_POLICY,
  AGENT_STACK_POLICY,
  STACK_IDS,
  TOOL_POLICY,
} from "../integrations/openclaw/lib/policy.mjs";
// The execution-capability matrix, read to prove the registry widening grants
// nothing: membership of a protocol registry is not a tool grant.
import { ZINK_TOOLS_ACCESS_MATRIX } from "../integrations/openclaw/lib/authority.mjs";

const GUARD_SOURCE = fs.readFileSync(
  new URL("../integrations/openclaw/topology/lib/guard.mjs", import.meta.url),
  "utf8",
);

const CONTRACT_DIR = new URL(
  "../integrations/openclaw/topology/contracts/",
  import.meta.url,
);

const EXPECTED_REGISTRY = [
  "infrastructure",
  "data_plant",
  "semantic",
  "intelligence",
  "decision",
];

/**
 * Collect every stack-protocol enum a contract declares (`stack_id` in the
 * brief/ledger/envelope schemas, `target_stack` in the delegation envelope).
 * The registry is asserted against these, so the schema and the runtime list
 * can no longer drift silently in either direction.
 */
function stackEnumsIn(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) stackEnumsIn(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === "stack_id" || key === "target_stack") &&
        Array.isArray(child?.enum)
      ) {
        out.push({ key, enum: [...child.enum] });
        continue;
      }
      stackEnumsIn(child, out);
    }
  }
  return out;
}

function contractStackEnums(file) {
  const schema = JSON.parse(
    fs.readFileSync(new URL(file, CONTRACT_DIR), "utf8"),
  );
  return stackEnumsIn(schema);
}

// ===========================================================================
// (a) One registry, pinned against the contract rather than another literal
// ===========================================================================

test("A-2 registry: STACK_IDS is exactly the five-member registry the topology contracts declare", () => {
  for (const file of [
    "execution-brief.schema.json",
    "ledger-event.schema.json",
    "ledger-snapshot.schema.json",
    "trusted-result-envelope.schema.json",
    "delegation-envelope.schema.json",
  ]) {
    const enums = contractStackEnums(file);
    assert.ok(
      enums.length > 0,
      `${file} must declare at least one stack-protocol enum`,
    );
    for (const { key, enum: members } of enums) {
      assert.deepEqual(
        [...STACK_IDS],
        members,
        `${file} /${key}: the runtime registry and the contract enum must be the same list in the same order`,
      );
    }
  }
  // Stated separately so a regression reports the contract, not just a length.
  assert.deepEqual([...STACK_IDS], EXPECTED_REGISTRY);
  assert.ok(
    STACK_IDS.includes("infrastructure"),
    "infrastructure is a protocol stack; a four-member registry is R1-A04-05",
  );
  assert.equal(Object.isFrozen(STACK_IDS), true);
});

test("A-2 registry: STACK_IDS is the union of every stack AGENT_STACK_POLICY can grant", () => {
  const granted = [...new Set(Object.values(AGENT_STACK_POLICY).flat())].sort();
  assert.deepEqual(
    [...STACK_IDS].sort(),
    granted,
    `a stack the authority table can grant must be enumerable, got ${JSON.stringify(
      {
        registry: [...STACK_IDS],
        granted,
      },
    )}`,
  );
  // And nothing enumerable that no agent can ever be named for.
  for (const stack of STACK_IDS) {
    assert.ok(
      granted.includes(stack),
      `${stack} is in the registry but granted to no agent — a third divergent list`,
    );
  }
});

// ===========================================================================
// (b) One source: the guard must hold no copy of its own
// ===========================================================================

test("A-2 pin: guard.mjs holds no module-level stack registry and reads the one from policy.mjs", () => {
  // The pre-change shape was `let STACK_IDS = [ "semantic", … ];`, a copy the
  // policy load at :139 then overwrote. Everything before the dependency loader
  // is the module's own projection, so that window must carry no stack-name
  // literal at all.
  const loadAt = GUARD_SOURCE.indexOf("async function ensureDependencies");
  assert.ok(loadAt !== -1, "the policy loader must still exist");
  const moduleWindow = GUARD_SOURCE.slice(0, loadAt);

  assert.doesNotMatch(
    moduleWindow,
    /let STACK_IDS = \[\s*"/u,
    'STACK_IDS may only be initialised empty; `let STACK_IDS = ["…"]` is the divergent module-level copy returning',
  );
  assert.match(
    moduleWindow,
    /let STACK_IDS = \[\];/u,
    "the guard's un-loaded-policy stack state must be the empty fail-closed list",
  );
  for (const stack of EXPECTED_REGISTRY) {
    assert.doesNotMatch(
      moduleWindow,
      new RegExp(`"${stack}"`, "u"),
      `no module-level stack-name literal may survive in guard.mjs ("${stack}")`,
    );
  }
  assert.match(
    GUARD_SOURCE,
    /STACK_IDS = policy\.STACK_IDS \?\? \[\];/u,
    "the registry must still come from the policy module, empty when that module is absent",
  );
});

// ===========================================================================
// (c) Fail closed without a loaded policy
// ===========================================================================

test("A-2 pin: without a loaded policy module the guard grants no stack (source-shape pin, stated as such)", () => {
  // SOURCE-SHAPE PIN, not a behavioural drive. `ensureDependencies` resolves
  // the policy module package-relative AND cwd-relative
  // (`guard.mjs:110-113`), so under `node --test` run from the repository root
  // the cwd candidate always resolves and there is no non-invasive way to make
  // the load fail from inside a test; simulating an absent policy would mean
  // editing the loader or the module resolution, which is outside this item.
  //
  // The pinned shape is the load-bearing property: the pre-policy state is the
  // empty list, so `STACK_IDS.includes(x)` is false for every stack and the
  // delegation scope check denies instead of granting from a fabricated list.
  // This is the convention already documented for the built-in tool authority
  // at `guard.mjs:58-61` and `:159-165`.
  assert.match(GUARD_SOURCE, /let STACK_IDS = \[\];/u);
  assert.match(GUARD_SOURCE, /STACK_IDS = policy\.STACK_IDS \?\? \[\];/u);
  // And the empty state really is a denial: the registry gates an inclusion
  // assert, so nothing is a member of an empty list.
  assert.match(
    GUARD_SOURCE,
    /typeof delStackId === "string" && STACK_IDS\.includes\(delStackId\)/u,
    "the registry gates an inclusion assert, so an empty registry denies",
  );
});

// ===========================================================================
// (d) The denial must stop lying
// ===========================================================================

const TASK_ID = "d".repeat(64);
const DEL_ID = "00000000-0000-4000-8000-0000000000a2";
const SESSION = "sess-a2-excel";
const RUN = "run-a2-excel";

function callableManifestFor(agentId) {
  return {
    expected_governance_hash: "0".repeat(64),
    observed_governance_hash: "0".repeat(64),
    allowed_tools: TOOL_POLICY[agentId] ?? [],
  };
}

function spawnManifestFor() {
  return {
    expected_governance_hash: "0".repeat(64),
    observed_governance_hash: "0".repeat(64),
    allowed_tools: ["sessions_spawn", "sessions_yield"],
  };
}

/**
 * Open a ledger whose live delegation carries an explicit `stack_id`, and drive
 * one real governed `zink_excel` call at it.
 *
 * What is real here: the guard, its policy dependency load, the ledger read
 * path, and the whole gate sequence up to and past the delegation-scope check
 * at `guard.mjs:1722-1730` — the assert under test.
 *
 * What is hand-authored: the delegation record. The honest reducer derives a
 * delegation's `stack_id` from its node (`workflow.mjs:1808-1810`) and that
 * node's stack must belong to its agent, so today no agent that owns
 * `infrastructure` (`main`, `o1`) can also be the caller of a callable tool at
 * this assert: `ZINK_TOOLS_ACCESS_MATRIX` gives both no directly executable
 * capability, which is asserted separately below. This fixture therefore stands
 * for the ledger shapes the check itself must classify — a
 * legacy/tampered/absent-`stack_id` record, and the `infrastructure` delegations
 * the owner's org chart puts in front of this same guard as soon as an
 * infrastructure-owning agent has a callable tool. The defect being fixed is the
 * misclassification, and it is exercised at exactly the line that misclassifies.
 */
async function delegationCall(options = {}) {
  const {
    delegationOverrides = {},
    dropDelegation = false,
    params = {},
    context = { agentId: "excel", sessionKey: SESSION, runId: RUN },
  } = options;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2-delegation-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const snapshot = JSON.parse(fs.readFileSync(paths.snapshot, "utf8"));
    const delegation = dropDelegation
      ? null
      : {
          delegation_id: DEL_ID,
          task_id: TASK_ID,
          agent_id: "excel",
          child_session_key: SESSION,
          native_run_id: RUN,
          run_state: "RUNNING",
          brief_revision: 1,
          allowed_tools: ["zink_excel"],
          stack_id: "infrastructure",
          ...delegationOverrides,
        };
    snapshot.tasks[TASK_ID] = {
      task_id: TASK_ID,
      workflow_status: "EXECUTING",
      brief_state: "ACTIVE",
      brief_revision: 1,
      root_agent_id: "main",
      root_session_key: "sess-a2-root",
      root_run_id: "run-a2-root",
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "52345678901234567",
      nodes: [
        { node_id: "n-excel", agent_id: "excel", stack_id: "data_plant" },
      ],
      delegations: delegation ? { [DEL_ID]: delegation } : {},
    };
    fs.writeFileSync(paths.snapshot, `${JSON.stringify(snapshot)}\n`);
    const eventsBefore = fs.readFileSync(paths.events, "utf8");
    const guard = createGovernanceGuard({
      paths,
      manifestFor: callableManifestFor,
    });
    let code = null;
    try {
      await guard.beforeToolCall(
        {
          toolName: "zink_excel",
          params: {
            call_id: "00000000-0000-4000-8000-0000000000c1",
            tool_id: "zink_excel",
            specialist: context.agentId,
            constraints: { timeout_seconds: 30, max_memory_mb: 512 },
            input: {
              operation: "populate",
              file_path: "reports/budget.xlsx",
              data: { values: [1, 2, 3] },
            },
            provenance: {
              delegation_id: DEL_ID,
              task_id: TASK_ID,
              session_key: context.sessionKey,
            },
            ...params,
          },
        },
        context,
      );
    } catch (error) {
      code = error?.code ?? error?.message ?? "UNKNOWN";
    }
    return {
      code,
      eventsAppended: fs.readFileSync(paths.events, "utf8") !== eventsBefore,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("A-2: an infrastructure-scoped delegation is denied for its stack scope, never reported as a missing delegation", async () => {
  const result = await delegationCall();
  assert.notEqual(
    result.code,
    "AUTH_DELEGATION_NOT_FOUND",
    `the delegation exists, is well-formed and correctly scoped; R1-A04-05 reported it as "not found" because the registry was four-member. got ${JSON.stringify(
      result,
    )}`,
  );
  // The refusal is still a refusal, and it now comes from the honest next gate:
  // with the registry containing `infrastructure`, the delegation-scope check
  // admits the record and the call stops at the approval binding, because this
  // fixture records no approval. That ordering is the proof the stack check
  // itself no longer refuses.
  assert.equal(
    result.code,
    "AUTH_APPROVAL_REQUIRED",
    `the infrastructure delegation must reach the post-scope approval gate rather than being refused as missing, got ${JSON.stringify(
      result,
    )}`,
  );
  assert.equal(
    result.eventsAppended,
    false,
    "a refusal must leave the durable ledger untouched",
  );
});

test("A-2: an unregistered stack keeps failing the scope check, and genuine delegation-identity failures still say 'not found'", async () => {
  // The honesty requirement is one-directional. A stack no contract names must
  // still be refused, while the identity/shape failures in the same block must
  // keep reporting AUTH_DELEGATION_NOT_FOUND: the denial vocabulary is durable
  // ledger vocabulary and this item may not renumber it.
  const unknownStack = await delegationCall({
    delegationOverrides: { stack_id: "not_a_stack" },
  });
  assert.equal(
    unknownStack.code,
    "AUTH_SCOPE_MISMATCH",
    `an unregistered stack is a scope problem, got ${unknownStack.code}`,
  );

  const cases = [
    ["a delegation id that is not a UUID", { delegation_id: "not-an-uuid" }],
    ["an agent outside the roster", { agent_id: "ghost" }],
    ["an empty task id", { task_id: "" }],
    ["no native run id", { native_run_id: "" }],
    ["a run state outside the closed set", { run_state: "MAYBE" }],
    [
      "an allowed tool outside the callable registry",
      { allowed_tools: ["zink_ghost"] },
    ],
    ["an empty brief revision", { brief_revision: "" }],
  ];
  for (const [label, overrides] of cases) {
    const result = await delegationCall({ delegationOverrides: overrides });
    assert.equal(
      result.code,
      "AUTH_DELEGATION_NOT_FOUND",
      `${label} must keep reporting AUTH_DELEGATION_NOT_FOUND, got ${JSON.stringify(result)}`,
    );
    assert.equal(result.eventsAppended, false, `${label} must not write`);
  }

  // A session carrying no delegation at all is genuinely not found.
  const noDelegation = await delegationCall({ dropDelegation: true });
  assert.equal(
    noDelegation.code,
    "AUTH_DELEGATION_NOT_FOUND",
    "a session with no delegation must still report not-found",
  );
});

test("A-2 pin: the stack-scope assert uses the existing scope vocabulary and no new denial code exists", () => {
  const declAt = GUARD_SOURCE.indexOf("const delStackId =");
  assert.ok(declAt !== -1, "the delegation stack-scope check must still exist");
  const includesAt = GUARD_SOURCE.indexOf(
    "STACK_IDS.includes(delStackId)",
    declAt,
  );
  assert.ok(
    includesAt !== -1,
    "the scope check must still consult the registry",
  );
  // Exactly the assert statement, comments excluded.
  const block = GUARD_SOURCE.slice(
    GUARD_SOURCE.lastIndexOf("assert(", includesAt),
    GUARD_SOURCE.indexOf(");", includesAt) + 2,
  );
  assert.match(
    block,
    /assert\(\s*typeof delStackId === "string" && STACK_IDS\.includes\(delStackId\),\s*"AUTH_SCOPE_MISMATCH",?\s*\)/u,
    "the stack-membership refusal must report AUTH_SCOPE_MISMATCH, the code this guard already uses for a scope problem",
  );
  assert.doesNotMatch(
    block,
    /AUTH_DELEGATION_NOT_FOUND/u,
    "AUTH_DELEGATION_NOT_FOUND must not stay on the stack-membership assert",
  );
  // No denial code may be invented: this item's vocabulary is fixed.
  const vocabulary = new Set(
    [...GUARD_SOURCE.matchAll(/"(AUTH_[A-Z_]+)"/gu)].map((m) => m[1]),
  );
  assert.deepEqual(
    [...vocabulary].sort(),
    [
      "AUTH_APPROVAL_EXPIRED",
      "AUTH_APPROVAL_INVALID",
      "AUTH_APPROVAL_REPLAYED",
      "AUTH_APPROVAL_REQUIRED",
      "AUTH_DELEGATION_INACTIVE",
      "AUTH_DELEGATION_NOT_FOUND",
      "AUTH_DELEGATION_REVOKED",
      "AUTH_POLICY_DENIED",
      "AUTH_SCOPE_MISMATCH",
      "AUTH_UNAUTHORIZED_TARGET",
    ],
    "the denial vocabulary must be exactly the codes that already exist",
  );
});

// ===========================================================================
// The capability question: enumerable is not executable
// ===========================================================================

test("A-2 capability: infrastructure in the registry is an enumerable protocol ID, not an execution grant — admission still refuses it for every agent whose table omits it", async () => {
  // `docs/architecture/five-stack.md:9` — "T2 grants no infrastructure
  // execution capability". Adding the ID to the registry must not change a
  // single admission decision, so this asserts the refusals are still issued per
  // agent from AGENT_STACK_POLICY, off the real guard and a real ledger.
  assert.deepEqual(
    Object.entries(AGENT_STACK_POLICY)
      .filter(([, stacks]) => stacks.includes("infrastructure"))
      .map(([agent]) => agent)
      .sort(),
    ["main", "o1"],
    "only main and o1 may be named for infrastructure; the registry change must not alter that",
  );

  // Each probe authors from a context that CAN spawn the node's agent, so the
  // stack table is the only rule left that can refuse it.
  const contextFor = {
    o2: "main",
    excel: "o1",
    sql: "o1",
    python: "o1",
    "power-bi": "o2",
  };
  for (const [agent, contextAgent] of Object.entries(contextFor)) {
    assert.equal(
      (AGENT_STACK_POLICY[agent] ?? []).includes("infrastructure"),
      false,
      `fixture drift: ${agent} must not own infrastructure for this probe`,
    );
    const result = await admit(
      [nodeDef("n-in", agent, "infrastructure")],
      contextAgent,
    );
    assert.equal(
      result.code,
      "UNAUTHORIZED_TARGET",
      `${agent}/infrastructure must still be refused after the registry widening`,
    );
    assert.deepEqual(result.activated, []);
    assert.equal(
      result.briefWriteEvents,
      0,
      `${agent}/infrastructure must be refused before any durable write`,
    );
  }
});

test("A-2 capability: no agent that owns infrastructure has a directly executable callable tool", () => {
  // The second half of "enumerable is not executable". The delegation scope
  // check only runs for a caller with a directly executable callable; in
  // `ZINK_TOOLS_ACCESS_MATRIX` every row of an infrastructure owner resolves to
  // `delegate` (spawn topology, refused at step 7) or `L2`/`L0` (execute
  // denied), and neither owns a callable tool in `TOOL_POLICY`. No new
  // actionable stack can therefore reach the assert this item re-codes.
  for (const [agent, stacks] of Object.entries(AGENT_STACK_POLICY)) {
    if (!stacks.includes("infrastructure")) continue;
    const row = ZINK_TOOLS_ACCESS_MATRIX[agent] ?? {};
    for (const [toolId, level] of Object.entries(row)) {
      assert.notEqual(
        level,
        "L3",
        `${agent} owns infrastructure and holds a directly executable callable (${toolId}) — the registry change would then be an execution grant`,
      );
    }
    assert.deepEqual(
      TOOL_POLICY[agent] ?? [],
      [],
      `${agent} owns infrastructure; a callable tool grant here would widen its actionable stacks`,
    );
  }
});

test("A-2: an o1-owned infrastructure brief node is admitted to the durable ledger through the real brief path", async () => {
  // A-1 made this legal (AGENT_STACK_POLICY.o1 lists infrastructure and
  // admission validates per node). A-2 must keep it legal and make the
  // downstream scope check agree with it: the registry that check consults now
  // contains the stack the brief was allowed to name.
  //
  // As in the A-1 suite, the assertion is on the durable effect and not on the
  // eventual code: admission commits the node and then the same call continues
  // into the spawn path, which this bare fixture cannot complete. The
  // post-admission spawn code is identical for `o2/semantic` and any other legal
  // stack (both report the same non-stack refusal), so it is not what is pinned
  // here.
  const result = await admit([nodeDef("n-in", "o1", "infrastructure")], "main");
  assert.notEqual(
    result.code,
    "UNAUTHORIZED_TARGET",
    `a node whose agent owns its stack must not be refused by the stack rule, got ${JSON.stringify(result)}`,
  );
  assert.deepEqual(result.activated, ["o1/infrastructure"]);
  assert.equal(result.briefWriteEvents, 1);
});

// ===========================================================================
// Real-brief harness (same convention as the A-1 suite)
// ===========================================================================

function nodeDef(nodeId, agentId, stackId, dependencies = []) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: stackId,
    dependencies,
    required: true,
    inputs: `A-2 probe input for ${nodeId}`,
    constraints: "{}",
    validation_criteria: "agent-result-payload.schema.json",
  };
}

function briefText(taskId, origin, nodes) {
  return JSON.stringify({
    schema_version: "1.0.0",
    governance_version: "m8-t2-r9",
    task_id: taskId,
    brief_revision: 1,
    brief_state: "ACTIVE",
    workflow_status: "ACTIVE",
    origin: origin.origin,
    origin_principal_ref: origin.origin_principal_ref,
    origin_message_id: origin.origin_message_id,
    inputs: "A-2 stack registry fixture brief",
    input_refs: [],
    nodes,
    semantic_contract_status: "MISSING",
    dataset_validation_status: "MISSING",
    mandatory_decision_evidence: [],
  });
}

// Built as a string: a 17-digit snowflake-shaped id exceeds
// Number.MAX_SAFE_INTEGER, so counting it as a number would silently repeat a
// task identity (deriveTaskId hashes these origin binding fields), and each
// fixture needs its own.
let messageCounter = 0;

function nextMessageId() {
  return `524456789012345${String(++messageCounter).padStart(2, "0")}`;
}

function authoringLedger(rootAgentId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2-stack-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const payload = {
    ...origin,
    root_agent_id: rootAgentId,
    root_session_key: `agent:${rootAgentId}:sess-a2`,
    root_run_id: `run-a2-${rootAgentId}`,
  };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  const guard = createGovernanceGuard({ paths, manifestFor: spawnManifestFor });
  return { root, paths, guard, taskId, payload, origin };
}

/**
 * Run one initial-brief admission through the governed gate. The brief rides in
 * `assistantText` on a `sessions_spawn` against a task with no nodes, the only
 * production path into `admitInitialBrief`. Returns the refusal code plus the
 * ledger facts: a passing guard decision is not the assertion, the durable
 * write is.
 */
// ===========================================================================
// M12/T9 F-118 -- the canonical five-stack table must name the coordinator
// that can actually spawn that stack's specialists.
//
// The table was written by hand from a retired roster and had drifted into the
// inverse of the enforced spawn tree: it made O2 the Data Plant owner and O1
// the Semantic/Intelligence owner, while the code binds the ETL specialists
// under O1 and BI under O2. No lane read the markdown, so it could stay
// literally true about its own caveat while its rows were wrong.
// ===========================================================================

const FIVE_STACK_DOC = fs.readFileSync(
  new URL("../docs/architecture/five-stack.md", import.meta.url),
  "utf8",
);

const FIVE_STACK_ROWS = FIVE_STACK_DOC.split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
  .slice(1)
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

const STACK_DISPLAY = {
  infrastructure: "infrastructure",
  data_plant: "data plant",
  semantic: "semantic",
  intelligence: "intelligence",
  decision: "decision",
};

const SPECIALIST_DISPLAY = [
  ["excel", /\bExcel\b/iu],
  ["sql", /\bSQL\b/iu],
  ["python", /\bPython\b/iu],
  ["power-bi", /\bPower[\s-]?BI\b/iu],
];

const COORDINATOR_DISPLAY = [
  ["main", /\bMain\b/iu],
  ["o1", /\bO1\b/iu],
  ["o2", /\bO2\b/iu],
];

test("F-118: five-stack.md names the coordinator that can spawn each stack's specialists", () => {
  const seen = new Set();
  for (const cells of FIVE_STACK_ROWS) {
    const [stackCell, coordinatorCell, executorCell] = cells;
    const stack = Object.keys(STACK_DISPLAY).find((id) =>
      stackCell.toLowerCase().includes(STACK_DISPLAY[id]),
    );
    assert.ok(stack, `unknown stack row: ${stackCell}`);
    seen.add(stack);

    // The coordinator cell must name exactly the coordinators the enforced
    // stack policy binds to the stack (Main may be named in addition: it holds
    // every stack and is the only authority that moves work between them).
    const bound = Object.entries(AGENT_SPAWN_POLICY)
      .filter(
        ([agentId, children]) =>
          children.length > 0 &&
          agentId !== "main" &&
          (AGENT_STACK_POLICY[agentId] ?? []).includes(stack),
      )
      .map(([agentId]) => agentId)
      .sort();
    const named = COORDINATOR_DISPLAY.filter(([, pattern]) =>
      pattern.test(coordinatorCell),
    ).map(([agentId]) => agentId);
    const namedCoordinators = named
      .filter((agentId) => agentId !== "main")
      .sort();
    assert.deepEqual(
      namedCoordinators,
      bound,
      `${stack}: the coordinator column must name the coordinator(s) the enforced stack policy binds to it`,
    );

    // The executor cell lists specialists, never a coordinator: "O2 designated
    // support" is how the inverted table hid a coordinator in a specialist slot.
    for (const [agentId, pattern] of COORDINATOR_DISPLAY) {
      assert.equal(
        pattern.test(executorCell),
        false,
        `${stack}: the executor column must not name a coordinator (${agentId})`,
      );
    }

    const listed = SPECIALIST_DISPLAY.filter(([, pattern]) =>
      pattern.test(executorCell),
    ).map(([agentId]) => agentId);

    for (const agentId of listed) {
      assert.ok(
        (AGENT_STACK_POLICY[agentId] ?? []).includes(stack),
        `${stack}: ${agentId} is not admitted on that stack`,
      );
      assert.ok(
        named.some((coordinatorId) =>
          (AGENT_SPAWN_POLICY[coordinatorId] ?? []).includes(agentId),
        ),
        `${stack}: no coordinator named in the row can spawn ${agentId}`,
      );
    }

    // Completeness: every specialist the bound coordinator can dispatch onto
    // this stack must be listed, so a row cannot quietly narrow a stack.
    for (const coordinatorId of bound) {
      for (const agentId of AGENT_SPAWN_POLICY[coordinatorId] ?? []) {
        if (!(AGENT_STACK_POLICY[agentId] ?? []).includes(stack)) continue;
        assert.ok(
          listed.includes(agentId),
          `${stack}: ${agentId} is admitted and ${coordinatorId} can spawn it, so the row must list it`,
        );
      }
    }
  }
  for (const stack of Object.keys(STACK_DISPLAY)) {
    assert.ok(seen.has(stack), `five-stack.md lost the ${stack} row`);
  }
});

async function admit(nodes, rootAgentId) {
  const fixture = authoringLedger(rootAgentId);
  try {
    const eventsBefore = fs.readFileSync(fixture.paths.events, "utf8");
    let code = null;
    try {
      await fixture.guard.beforeToolCall(
        {
          toolName: "sessions_spawn",
          toolCallId: "call-a2-1",
          turn: 1,
          batchToolNames: ["sessions_spawn"],
          assistantText: briefText(fixture.taskId, fixture.origin, nodes),
          params: {
            agentId: nodes[0].agent_id,
            runtime: "subagent",
            mode: "run",
            thread: false,
            context: "isolated",
            sandbox: "require",
            cleanup: "keep",
            task: JSON.stringify({}),
          },
        },
        {
          agentId: rootAgentId,
          sessionKey: fixture.payload.root_session_key,
          runId: fixture.payload.root_run_id,
        },
      );
    } catch (error) {
      code = error?.code ?? error?.message ?? "UNKNOWN";
    }
    const snapshot = readSnapshot(fixture.paths);
    return {
      code,
      activated: snapshot.tasks[fixture.taskId].nodes.map((node) =>
        [node.agent_id, node.stack_id].join("/"),
      ),
      eventsAppended:
        fs.readFileSync(fixture.paths.events, "utf8") !== eventsBefore,
      briefWriteEvents: fs
        .readFileSync(fixture.paths.events, "utf8")
        .split("\n")
        .filter((line) => line.includes("WORKFLOW_BRIEF_ACTIVATED")).length,
    };
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}
