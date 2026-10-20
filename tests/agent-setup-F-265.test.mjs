// F-265 (R7-D13-02) - the backup manifest asserts `secrets_included = $false`
// as a constant over an archive the script never inspects.
//
// The acceptance criterion: the field is renamed to what is actually known
// (e.g. `plaintext_secrets_excluded`) and computed by inspecting the archive.
//
// The archive holds a full `pg_dump` of the automation database, whose
// credential table IS in the dump, plus a tar of the n8n home directory that
// excludes only `config`. So the claim cannot be "no secrets"; it can only be
// the narrower one the inspection can prove: no plaintext secret carrier is
// present. The claim is computed from two inspections of the archives the
// script has just produced - the tar listing and `pg_restore --list` for every
// dump - and the credential-bearing objects the dumps carry are disclosed
// beside it instead of being claimed away.
//
// The behavioural half runs the real inspection helper under PowerShell with
// synthetic archive listings, so the claim is checked against the decision
// the shipped helper actually makes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const BACKUP_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "backup.ps1",
);
const INSPECTION_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "backup-inspection.ps1",
);

function backupSource() {
  return readFileSync(path.join(root, BACKUP_PATH), "utf8");
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

function inspect(entries, objects) {
  const shell = powerShell();
  if (!shell) return null;
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-265-"));
  const harness = path.join(workspace, "harness.ps1");
  const helper = path.join(root, INSPECTION_PATH).replace(/'/g, "''");
  const body = [
    "$ErrorActionPreference = 'Stop'",
    `. '${helper}'`,
    `$entries = @(${entries.map((entry) => `'${entry}'`).join(", ")})`,
    `$objects = [ordered]@{ ${Object.entries(objects)
      .map(
        ([database, names]) =>
          `'${database}' = @(${names.map((name) => `'${name}'`).join(", ")})`,
      )
      .join("; ")} }`,
    "$inspection = Get-BackupSecretInspection -HomeArchiveEntries $entries -ArchiveObjectsByDatabase $objects",
    "[Console]::Out.WriteLine(($inspection | ConvertTo-Json -Depth 10 -Compress))",
    "",
  ].join("\n");
  writeFileSync(harness, body);
  const result = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `the inspection helper failed: ${result.stderr || result.stdout}`,
    );
  }
  const line = (result.stdout ?? "")
    .split(/\r?\n/u)
    .filter((entry) => entry.trim().length > 0)
    .pop();
  return JSON.parse(line);
}

test("F-265: the manifest no longer carries the unhedged constant", () => {
  const source = backupSource();
  assert.doesNotMatch(
    source,
    /secrets_included/,
    "the field that claims the archive holds no secrets at all must be gone",
  );
  assert.doesNotMatch(
    source,
    /secrets_included = \$false/,
    "a constant is not a computed claim",
  );
});

test("F-265: the manifest claim is computed from an inspection of the archives", () => {
  const source = backupSource();
  assert.match(
    source,
    /plaintext_secrets_excluded = \$secretInspection\.plaintext_secrets_excluded/,
    "the manifest field must be assigned from the inspection result",
  );
  assert.match(
    source,
    /secret_inspection = \$secretInspection/,
    "the manifest must record the inspection that produced the claim",
  );
  assert.match(
    source,
    /pg_restore --list|pg_restore", "--list/,
    "the database archives must be inspected",
  );
  assert.match(source, /tar -tzf/, "the home archive must be inspected");
  assert.match(
    source,
    /Get-BackupSecretInspection/,
    "the claim must come from the shared inspection helper",
  );
});

test("F-265: the operator output reports the computed claim, not a fixed one", () => {
  const source = backupSource();
  assert.match(
    source,
    /Plaintext secrets excluded: \$\(\$secretInspection\.plaintext_secrets_excluded\)/,
    "the console line must print the computed value",
  );
  assert.doesNotMatch(
    source,
    /without plaintext secrets\./,
    "the console line must not assert the claim in prose",
  );
});

test("F-265: an archive without a plaintext carrier is reported as clean", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the inspection helper");
    return;
  }
  const inspection = inspect(["./", "./nodes/1.json", "./workflows/2.json"], {
    n8n: ["credentials", "workflow"],
    postgres: ["sources", "segments"],
  });
  assert.equal(inspection.plaintext_secrets_excluded, true);
  assert.deepEqual(inspection.plaintext_secret_carrier_paths, []);
  assert.deepEqual(inspection.credential_bearing_objects, ["n8n.credentials"]);
  assert.equal(inspection.n8n_home_entries_inspected, 3);
});

test("F-265: the n8n config carrier turns the claim false", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the inspection helper");
    return;
  }
  const inspection = inspect(["./", "./config", "./nodes/1.json"], {
    n8n: ["credentials"],
  });
  assert.equal(inspection.plaintext_secrets_excluded, false);
  assert.deepEqual(inspection.plaintext_secret_carrier_paths, ["config"]);
});

test("F-265: a plaintext secret file by name turns the claim false", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the inspection helper");
    return;
  }
  const inspection = inspect(["./", "./.env", "./config/credentials.json"], {
    n8n: [],
  });
  assert.equal(inspection.plaintext_secrets_excluded, false);
  assert.deepEqual(inspection.plaintext_secret_carrier_paths, [
    ".env",
    "config/credentials.json",
  ]);
});

test("F-265: a plaintext-named database object turns the claim false", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the inspection helper");
    return;
  }
  const inspection = inspect(["./"], {
    n8n: ["public.plaintext_secrets"],
  });
  assert.equal(inspection.plaintext_secrets_excluded, false);
  assert.deepEqual(inspection.plaintext_secret_carrier_paths, [
    "n8n.public.plaintext_secrets",
  ]);
});
test("F-265: the dump inventory is read from the pg_restore table of contents", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the inspection helper");
    return;
  }
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-265-toc-"));
  const harness = path.join(workspace, "harness.ps1");
  const helper = path.join(root, INSPECTION_PATH).replace(/'/g, "''");
  writeFileSync(
    harness,
    [
      "$ErrorActionPreference = 'Stop'",
      `. '${helper}'`,
      "$listing = @(",
      "  ';',",
      "  '; Table: public.credentials',",
      "  '215; 1259 16385 TABLE public credentials postgres',",
      "  '3456; 0 16385 TABLE DATA public credentials postgres',",
      "  '216; 1259 16387 SEQUENCE public credentials_id_seq postgres'",
      ")",
      "$names = Get-BackupArchiveObjectNames -ListingLines $listing",
      "[Console]::Out.WriteLine(($names | ConvertTo-Json -Compress))",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = (result.stdout ?? "")
    .split(/\r?\n/u)
    .filter((entry) => entry.trim().length > 0)
    .pop();
  assert.deepEqual(JSON.parse(line), [
    "public.credentials",
    "public.credentials_id_seq",
  ]);
});
