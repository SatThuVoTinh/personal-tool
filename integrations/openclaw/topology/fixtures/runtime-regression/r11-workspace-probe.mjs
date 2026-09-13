// Reconstruct the authorized predecessor from immutable Git source, never runtime data.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import {
  agentInstructions as currentInstructions,
  assertWorkspaceMatchesTemplate,
  materializeWorkspace,
} from "../../../lib/policy.mjs";

const commit = "008885ce6b84ef307f0654443628b3523f54e3d0";
const root = mkdtempSync(path.join(os.tmpdir(), "zink-r11-source-"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  for (const file of ["lib/policy.mjs", "topology/lib/canonical.mjs"]) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync("git", ["show", `${commit}:integrations/openclaw/${file}`]),
    );
  }
  const { agentInstructions } = await import(
    pathToFileURL(path.join(root, "lib/policy.mjs"))
  );
  const workspaces = Object.fromEntries(
    ["main", "o1", "o2", "excel", "power-bi", "sql", "python"].map((id) => [
      id,
      digest(agentInstructions(id)),
    ]),
  );
  for (const id of Object.keys(workspaces)) {
    const workspace = path.join(root, "workspaces", id);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, ".gitkeep"), "");
    const instructionsPath = path.join(workspace, "AGENTS.md");
    const previous = agentInstructions(id);
    writeFileSync(instructionsPath, previous);
    assert.throws(
      () =>
        assertWorkspaceMatchesTemplate(
          workspace,
          currentInstructions(id),
          true,
          id,
        ),
      /drift/,
    );
    assertWorkspaceMatchesTemplate(
      workspace,
      currentInstructions(id),
      false,
      id,
    );
    writeFileSync(instructionsPath, `${previous}\nmodified`);
    assert.throws(
      () => materializeWorkspace(workspace, currentInstructions(id), id),
      /drift/,
    );
    writeFileSync(instructionsPath, previous);
    materializeWorkspace(workspace, currentInstructions(id), id);
    assertWorkspaceMatchesTemplate(workspace, currentInstructions(id), true);
    materializeWorkspace(workspace, currentInstructions(id), id);
  }
  const entrypoint = digest(
    execFileSync("git", [
      "show",
      `${commit}:integrations/openclaw/plugins/zink-governance/index.mjs`,
    ]),
  );
  process.stdout.write(
    `${JSON.stringify({ commit, workspaces, entrypoint, runtime_mutation: false }, null, 2)}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
