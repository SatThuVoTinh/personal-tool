// M12/T9 F-027 (legacy R1-A04-02) - the Knowledgebase DISCOVER tier (L1) must
// be enforced at the retrieval seam.
//
// MEASURED AT HEAD: the canonical policy denies the L1 tier on the `read`
// action, but the knowledge tool's own vocabulary is
// `search|retrieve|citation|metadata`, so the branch was unreachable and
// `evaluateToolAccess("main","zink_knowledge_search",{namespace:"finance"})`
// answered `allowed: true` for a namespace the matrix marks DISCOVER.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const plugin = await import(
  pathToFileURL(
    path.join(REPO_ROOT, "integrations/openclaw/plugins/zink-governance/index.mjs"),
  ).href,
);

test("F-027: an L1 (DISCOVER) namespace denies every content-bearing action", () => {
  const denied = plugin.evaluateToolAccess("main", "zink_knowledge_search", {
    namespace: "finance",
    query: "x",
  });
  assert.equal(
    denied.allowed,
    false,
    "main has DISCOVER (L1) on finance: a content read must be denied",
  );
  assert.equal(denied.reason, "DISCOVER_ONLY_ACCESS");
});

test("F-027: the denial holds for every content-bearing knowledge action", () => {
  for (const action of ["search", "retrieve", "citation", "metadata"]) {
    const verdict = plugin.evaluateToolAccess("main", "zink_knowledge_search", {
      namespace: "finance",
      query: "x",
      action,
    });
    assert.equal(
      verdict.allowed,
      false,
      `action=${action} must be denied at L1`,
    );
  }
});

test("F-027: an L2 (READ) namespace still allows the content action", () => {
  const verdict = plugin.evaluateToolAccess("main", "zink_knowledge_search", {
    namespace: "core",
    query: "x",
  });
  assert.equal(verdict.allowed, true, "core is READ (L2) for main");
});

test("F-027: the mutating actions keep their canonical denial", () => {
  for (const action of ["admin", "ingestion", "update", "delete"]) {
    const verdict = plugin.evaluateToolAccess("main", "zink_knowledge_search", {
      namespace: "core",
      query: "x",
      action,
    });
    assert.equal(
      verdict.allowed,
      false,
      `action=${action} must stay denied`,
    );
    assert.equal(verdict.reason, "KB_ACTION_DENIED");
  }
});

test("F-027: the canonical action translation is total and explicit", () => {
  assert.equal(plugin.canonicalKnowledgeAction("search"), "read");
  assert.equal(plugin.canonicalKnowledgeAction("retrieve"), "read");
  assert.equal(plugin.canonicalKnowledgeAction("citation"), "read");
  assert.equal(plugin.canonicalKnowledgeAction("metadata"), "read");
  assert.equal(plugin.canonicalKnowledgeAction("SEARCH"), "read");
  assert.equal(plugin.canonicalKnowledgeAction(undefined), "read");
  assert.equal(plugin.canonicalKnowledgeAction("admin"), "admin");
  assert.equal(plugin.canonicalKnowledgeAction("delete"), "delete");
});

