// M12/T9 - F-028 (R1-A04-03): the Skill Store scoping is namespace-blind.
//
// MEASURED AT HEAD (the red state this file proves):
//
//   const adapter = new SkillAdapter(skillsRoot, { skillsRoot });
//   await adapter.querySkillStore({
//     action: "apply",
//     namespace: "research",          // the namespace the caller gated on
//     skill_id: "excel/excel-apply",  // a skill from ANOTHER stack
//   });
//
// returned governed_status SUCCESS and served the excel skill's approved
// bytes. `loadVerifiedRecord(skillsDir, targetSkillId)` took no namespace at
// all, so the served skill was decided by the caller's `skill_id` alone; the
// gated `namespace` was echoed back in the response and never compared with
// the record that was actually served.
//
// The fix binds the served record to the gated namespace. This module does
// NOT own the per-agent apply scope - that is the OpenClaw governance
// layer's `lib/policy.mjs` - and it must not: Zink Tools is a thin
// adapter-contract boundary. What it owns is the binding between the
// namespace the caller gated on and the skill the caller is served.
//
// The scope strings themselves ("approved_research_domain" and its siblings
// in `SKILL_STORE_ACCESS_MATRIX`) are still decorative at HEAD: the policy
// branch in `integrations/openclaw/lib/policy.mjs:469-473` returns
// `{allowed: true, level: "L3"}` for ANY namespace. That half of F-028 lives
// in a file this band assigns to another agent, and it is reported, not
// fixed here.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = (rel) => pathToFileURL(path.join(REPO, rel)).href;

const { promoteApprovedSkillWithLock } = await import(
  url("zink-skill-store/src/catalog.mjs")
);
const { SkillAdapter } = await import(
  url("zink-tools/adapters/skill-store/skill-adapter.mjs")
);

/** A canonical two-skill store: one skill per stack. */
async function twoStackStore() {
  const skillsRoot = await mkdtemp(path.join(tmpdir(), "f028-"));
  await promoteApprovedSkillWithLock({
    skillsRoot,
    namespace: ["excel"],
    capability: "excel-apply",
    version: "1.0.0",
    content: "# EXCEL\npopulate the workbook\n",
    decisionRef: "PLAN:M12/T9-R1",
  });
  await promoteApprovedSkillWithLock({
    skillsRoot,
    namespace: ["research"],
    capability: "research-apply",
    version: "1.0.0",
    content: "# RESEARCH\nsummarise the corpus\n",
    decisionRef: "PLAN:M12/T9-R1",
  });
  return skillsRoot;
}

const adapterFor = (skillsRoot) => new SkillAdapter(skillsRoot, { skillsRoot });

test("F-028: read is refused when the served skill is outside the gated namespace", async () => {
  const skillsRoot = await twoStackStore();
  try {
    const adapter = adapterFor(skillsRoot);
    await assert.rejects(
      () =>
        adapter.querySkillStore({
          action: "read",
          namespace: "research",
          skill_id: "excel/excel-apply",
        }),
      (error) => {
        assert.equal(error.code, "SKILL_NAMESPACE_MISMATCH");
        assert.match(error.message, /excel\/excel-apply/u);
        return true;
      },
      "a read gated on one namespace must not serve another namespace's skill",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: apply is refused when the served skill is outside the gated namespace", async () => {
  const skillsRoot = await twoStackStore();
  try {
    const adapter = adapterFor(skillsRoot);
    await assert.rejects(
      () =>
        adapter.querySkillStore({
          action: "apply",
          namespace: "research",
          skill_id: "excel/excel-apply",
        }),
      (error) => {
        assert.equal(error.code, "SKILL_NAMESPACE_MISMATCH");
        return true;
      },
      "apply hands an agent a procedure to execute; it must come from the gated namespace",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: validate is refused when the served skill is outside the gated namespace", async () => {
  const skillsRoot = await twoStackStore();
  try {
    const adapter = adapterFor(skillsRoot);
    await assert.rejects(
      () =>
        adapter.querySkillStore({
          action: "validate",
          namespace: "research",
          skill_id: "excel/excel-apply",
        }),
      (error) => error.code === "SKILL_NAMESPACE_MISMATCH",
      "validate shares the read path and must share its binding",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: the matching namespace is still served", async () => {
  const skillsRoot = await twoStackStore();
  try {
    const adapter = adapterFor(skillsRoot);
    const read = await adapter.querySkillStore({
      action: "read",
      namespace: "research",
      skill_id: "research/research-apply",
    });
    assert.equal(read.governed_status, "SUCCESS");
    assert.match(read.skill_content.content, /summarise the corpus/u);

    const applied = await adapter.querySkillStore({
      action: "apply",
      namespace: "excel",
      skill_id: "excel/excel-apply",
    });
    assert.equal(applied.governed_status, "SUCCESS");
    assert.match(applied.skill_content.content, /populate the workbook/u);
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: a request that narrows nothing is not constrained", async () => {
  const skillsRoot = await twoStackStore();
  try {
    const adapter = adapterFor(skillsRoot);
    // No namespace at all: the caller gated on nothing, so there is nothing
    // to bind.
    const bare = await adapter.querySkillStore({
      action: "read",
      skill_id: "excel/excel-apply",
    });
    assert.equal(bare.governed_status, "SUCCESS");
    // An explicit "all": the caller asked for every namespace.
    const all = await adapter.querySkillStore({
      action: "apply",
      namespace: "all",
      skill_id: "excel/excel-apply",
    });
    assert.equal(all.governed_status, "SUCCESS");
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: the binding compares the CANONICAL namespace, so an alias is not a way past it", async () => {
  const skillsRoot = await mkdtemp(path.join(tmpdir(), "f028-alias-"));
  try {
    await promoteApprovedSkillWithLock({
      skillsRoot,
      namespace: ["power-bi"],
      capability: "bi-report",
      version: "1.0.0",
      content: "# BI\nrefresh the model\n",
      decisionRef: "PLAN:M12/T9-R1",
    });
    const adapter = adapterFor(skillsRoot);
    // "bi" is the shared alias of "power-bi": the same namespace, so the
    // skill is served.
    const aliased = await adapter.querySkillStore({
      action: "read",
      namespace: "bi",
      skill_id: "power-bi/bi-report",
    });
    assert.equal(aliased.governed_status, "SUCCESS");
    // A different namespace is still refused, alias or not.
    await assert.rejects(
      () =>
        adapter.querySkillStore({
          action: "read",
          namespace: "research",
          skill_id: "power-bi/bi-report",
        }),
      (error) => error.code === "SKILL_NAMESPACE_MISMATCH",
    );
  } finally {
    await rm(skillsRoot, { recursive: true, force: true });
  }
});

test("F-028: the binding is a control in the adapter, not a comment", () => {
  // A source assertion that names the control, so removing it is visible.
  const source = readFileSync(
    path.join(REPO, "zink-tools/adapters/skill-store/skill-adapter.mjs"),
    "utf8",
  );
  const bindingCalls = source.match(
    /assertNamespaceBinding\(storedSkill\.namespace, namespace, skill_id\);/gu,
  );
  assert.equal(
    bindingCalls?.length ?? 0,
    2,
    "both the read/validate path and the apply path must bind the served skill",
  );
});
