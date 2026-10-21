//
// SKIP-FAMILY: powershell-helpers
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// F-292 (R7-C4-05) - the acceptance driver resolves the repository through
// git calls with no working-directory argument, so its attestation can
// describe a different tree than the files it packaged.
//
// Every consumed file is resolved from the script's own location, but the
// cleanliness check, the head revision and the blob object ids are read from
// whichever repository the invocation directory happens to be inside. A run
// started from another worktree therefore labels the candidate with that
// tree's revision, and the self-check cannot notice, because the label comes
// from the same unqualified call.
//
// The acceptance criterion: all repository probes are invoked with an
// explicit directory argument bound to the script's own root, and the
// evidence records that root; a run started from a foreign tree fails with a
// message naming both revisions.
//
// The lane below checks the two halves: every git probe in the three files
// carries an explicit `-C`, and the decision that turns a foreign tree into
// a failure is exercised against fixtures.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const SCRIPT_DIRECTORY = path.join("infrastructure", "docker", "scripts");
const PROBE_FILES = [
  "knowledge-t5-common.ps1",
  "knowledge-t5-live.ps1",
  "knowledge-t5-remote.ps1",
];

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function powerShell() {
  if (process.platform === "win32") {
    return existsSync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
      ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      : "powershell.exe";
  }
  return existsSync("/usr/bin/pwsh") ? "/usr/bin/pwsh" : null;
}

function identityError(scriptRoot, scriptSha, invocationRoot, invocationSha) {
  const shell = powerShell();
  if (!shell) return null;
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-292-"));
  const harness = path.join(workspace, "harness.ps1");
  const common = path
    .join(root, SCRIPT_DIRECTORY, "knowledge-t5-common.ps1")
    .replace(/'/g, "''");
  writeFileSync(
    harness,
    [
      "$ErrorActionPreference = 'Stop'",
      `. '${common}'`,
      `$message = New-T5RepositoryIdentityError -ScriptRoot '${scriptRoot}' -ScriptSha '${scriptSha}' -InvocationRoot '${invocationRoot}' -InvocationSha '${invocationSha}'`,
      "$payload = [ordered]@{ message = $message }",
      "[Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `the identity helper failed: ${result.stderr || result.stdout}`,
    );
  }
  const line = (result.stdout ?? "")
    .split(/\r?\n/u)
    .filter((entry) => entry.trim().length > 0)
    .pop();
  return JSON.parse(line).message;
}

test("F-292: every git probe names the directory it reads", () => {
  for (const file of PROBE_FILES) {
    const source = read(path.join(SCRIPT_DIRECTORY, file));
    const probes = [...source.matchAll(/(?<![A-Za-z0-9_.-])git\s+([^\s`]+)/g)];

    for (const probe of probes) {
      assert.equal(
        probe[1],
        "-C",
        `${file}: the git probe '${probe[0].trim()}' must name its directory with -C`,
      );
    }
  }
});

test("F-292: the script's own root is the directory the probes read", () => {
  const common = read(path.join(SCRIPT_DIRECTORY, "knowledge-t5-common.ps1"));
  const bound = [...common.matchAll(/git\s+-C\s+(\$[A-Za-z0-9:]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(
    bound.includes("$script:T5RepositoryRoot"),
    "the repository probes must read the script's own root",
  );
  assert.ok(
    bound.includes("$invocationDirectory"),
    "the foreign-tree probe must read the invocation directory explicitly",
  );
});

test("F-292: the evidence records the tree it packaged", () => {
  for (const file of ["knowledge-t5.ps1", "knowledge-t5-live.ps1"]) {
    const source = read(path.join(SCRIPT_DIRECTORY, file));
    assert.match(
      source,
      /\$evidence\.repository_root = \$script:T5RepositoryRoot/,
      `${file} must record the tree it packaged in its evidence`,
    );
  }
});

test("F-292: a foreign tree fails with a message naming both revisions", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the identity helper");
    return;
  }
  const scriptSha = "a".repeat(40);
  const invocationSha = "b".repeat(40);
  const message = identityError(
    "C:/repo",
    scriptSha,
    "C:/repo/scratch/stale",
    invocationSha,
  );
  assert.ok(message, "a foreign tree must fail the run");
  assert.match(
    message,
    new RegExp(scriptSha),
    "the message must name the script tree's revision",
  );
  assert.match(
    message,
    new RegExp(invocationSha),
    "the message must name the invocation tree's revision",
  );
  assert.match(message, /C:\/repo\/scratch\/stale/);
  assert.match(message, /C:\/repo\b/);
});

test("F-292: the script's own tree at the same revision is accepted", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the identity helper");
    return;
  }
  const sha = "c".repeat(40);
  assert.equal(
    identityError("C:/repo", sha, "C:/repo", sha),
    null,
    "the script's own tree must be accepted",
  );
  assert.equal(
    identityError("C:/repo", sha, "C:\\repo\\", sha),
    null,
    "the same tree written with the other separator must be accepted",
  );
});

test("F-292: the same tree at another revision is refused", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the identity helper");
    return;
  }
  const message = identityError(
    "C:/repo",
    "d".repeat(40),
    "C:/repo",
    "e".repeat(40),
  );
  assert.ok(message, "a tree at another revision must fail the run");
  assert.match(message, /d{40}/);
  assert.match(message, /e{40}/);
});
