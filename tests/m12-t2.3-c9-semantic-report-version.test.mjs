import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EXPECTED_DIMENSIONS,
  syncSkillsToVectorStore,
} from "../zink-skill-store/src/vector-sync.mjs";
import { SEMANTIC_CONTRACT_VERSION } from "../zink-tools/common/semantic-contract.mjs";

const embedFn = async (texts) =>
  texts.map(() => new Array(EXPECTED_DIMENSIONS).fill(0.01));

async function makeActiveSkill(root, capability, contentText) {
  const dir = path.join(root, "office", capability, "1.0.0");
  await mkdir(dir, { recursive: true });
  const sha = createHash("sha256").update(contentText, "utf8").digest("hex");
  await writeFile(path.join(dir, "SKILL.md"), contentText, "utf8");
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        identity: { namespace: ["office"], capability, version: "1.0.0" },
        content: { path: "SKILL.md", sha256: sha },
        provenance: { source_type: "research", references: [] },
        lifecycle: [
          { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
          {
            status: "ACTIVE",
            at: "2026-10-01T01:00:00Z",
            actor: "owner",
            decision_ref: "PLAN:M12/T2-R1",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function syncOne() {
  const root = await mkdtemp(path.join(os.tmpdir(), "m12-c9-"));
  try {
    await makeActiveSkill(root, "c9-skill", "# C9\n\nHeaded body.");
    const report = await syncSkillsToVectorStore({
      skillsRoot: root,
      embedFn,
      dbExecutor: async () => "",
    });
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("C-9: the sync report names the semantic contract version explicitly", async () => {
  const report = await syncOne();
  assert.equal(report.status, "READY");
  assert.equal(report.skills.length, 1);
  const [row] = report.skills;

  // The row key's trailing ":v1" is the row-key schema revision. It is NOT the
  // semantic contract version, which is `zink-semantic-v2`
  // (zink-tools/common/semantic-contract.mjs:5). Before this item the report
  // printed the key and nothing else, so a reader could only guess which "v" it
  // was looking at.
  assert.equal(row.semantic_record_key, "office:c9-skill:1.0.0:v1");
  assert.notEqual(SEMANTIC_CONTRACT_VERSION, "v1");
  assert.equal(row.semantic_contract_version, SEMANTIC_CONTRACT_VERSION);
});

test("C-9: the key bytes are unchanged, so no derived row is re-keyed", async () => {
  const report = await syncOne();
  const [row] = report.skills;
  // Adding a report field must not alter the stored identity: re-keying derived
  // pgvector rows is a migration and is out of this contract's scope.
  assert.equal(row.semantic_record_key, "office:c9-skill:1.0.0:v1");
  assert.equal(row.sync_status, "READY");
});
