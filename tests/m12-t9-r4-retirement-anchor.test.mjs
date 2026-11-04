// M12/T9 F-411 (legacy R9-L06-10): promotion anchored its rename with a
// parent-directory sync while the retirement path acknowledged its own rename
// without one, and the shared helper swallowed every failure — including POSIX
// EIO — so even the anchored path could not report a lost anchor.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  fsyncDirectoryBestEffort,
  retireSkillUnlocked,
} from "../zink-skill-store/src/catalog.mjs";

const NAMESPACE = ["office"];
const CAPABILITY = "anchor-skill";
const VERSION = "1.0.0";

async function writeActiveSkill(skillsRoot) {
  const versionDirectory = path.join(
    skillsRoot,
    ...NAMESPACE,
    CAPABILITY,
    VERSION,
  );
  await mkdir(versionDirectory, { recursive: true });
  const content = "# Anchor\n\nfixture body\n";
  const manifest = {
    schema_version: 1,
    identity: {
      namespace: NAMESPACE,
      capability: CAPABILITY,
      version: VERSION,
    },
    content: {
      path: "SKILL.md",
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    },
    provenance: { source_type: "research", references: [] },
    lifecycle: [
      { status: "CANDIDATE", at: "2026-10-01T00:00:00Z", actor: "excel" },
      {
        status: "ACTIVE",
        at: "2026-10-01T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M11/T1-R1",
      },
    ],
  };
  await writeFile(path.join(versionDirectory, "SKILL.md"), content, "utf8");
  await writeFile(
    path.join(versionDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return versionDirectory;
}

describe("M12/T9 F-411 - the retirement rename is anchored and cannot lie", () => {
  it("a non-platform directory-sync failure is surfaced, not swallowed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "r4-anchor-"));
    try {
      await assert.rejects(
        () => fsyncDirectoryBestEffort(path.join(root, "absent-directory")),
        { code: "ENOENT" },
        "an anchor that could not be taken must reach the caller",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a sync fault during retirement is reported after the write", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "r4-anchor-retire-"));
    try {
      const versionDirectory = await writeActiveSkill(root);
      await assert.rejects(
        () =>
          retireSkillUnlocked({
            skillsRoot: root,
            namespace: NAMESPACE,
            capability: CAPABILITY,
            version: VERSION,
            decisionRef: "PLAN:M12/T9-R4",
            directorySync: async () => {
              const error = new Error("simulated anchor loss");
              error.code = "EIO";
              throw error;
            },
          }),
        { code: "SKILL_PUBLISH_FAILED" },
        "an unanchored retirement must not be acknowledged silently",
      );
      const manifest = JSON.parse(
        await readFile(path.join(versionDirectory, "manifest.json"), "utf8"),
      );
      assert.equal(
        manifest.lifecycle.at(-1).status,
        "DEPRECATED",
        "the reported fault is a lost anchor after the write, not a refused write",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the default retirement still anchors and succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "r4-anchor-default-"));
    try {
      await writeActiveSkill(root);
      const retired = await retireSkillUnlocked({
        skillsRoot: root,
        namespace: NAMESPACE,
        capability: CAPABILITY,
        version: VERSION,
        decisionRef: "PLAN:M12/T9-R4",
      });
      assert.equal(retired.status, "DEPRECATED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
