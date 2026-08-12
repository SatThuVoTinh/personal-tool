import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const scriptsDirectory = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
);

function readScript(name) {
  return readFileSync(path.join(scriptsDirectory, name), "utf8");
}

test("M2/T5 declares cumulative logical profile semantics", () => {
  const contents = readScript("start.ps1");

  assert.match(
    contents,
    /\[ValidateSet\("core", "platform", "observability", "all"\)\]/,
  );
  assert.match(contents, /core = @\("object-storage", "postgres", "redis"\)/);
  assert.match(
    contents,
    /platform = @\("object-storage", "postgres", "redis", "nginx", "n8n"\)/,
  );
  assert.match(contents, /observability = @\([\s\S]*"dozzle"/);
  assert.match(contents, /run --rm --no-deps -T postgres-bootstrap/);
  assert.doesNotMatch(contents, /\bpull @services\b/);
  assert.doesNotMatch(contents, /profiles:/);
});

test("M2/T5 backup uses portable logical exports and excludes n8n config", () => {
  const contents = readScript("backup.ps1");

  assert.match(contents, /pg_dump[\s\S]*--format=custom/);
  assert.match(contents, /--entrypoint pg_dump/);
  assert.doesNotMatch(contents, /docker cp/);
  assert.doesNotMatch(contents, /m2-backup-.*\.dump/);
  assert.match(contents, /mirror", "--overwrite", "aistor\/\$bucket/);
  assert.match(contents, /object-storage-index\.json/);
  assert.match(contents, /tagResult\.tagset/);
  assert.match(contents, /function Get-BackupRelativePath/);
  assert.match(contents, /function Get-ImageDigest/);
  assert.match(contents, /docker image inspect --format/);
  assert.doesNotMatch(contents, /GetRelativePath/);
  assert.match(contents, /--exclude=config/);
  assert.match(contents, /Stop n8n before backup/);
  assert.match(contents, /backup_format_version/);
  assert.match(contents, /secrets_included = \$false/);
  assert.doesNotMatch(contents, /PGDATA/);
});

test("M2/T5 restore is restricted to the isolated acceptance project", () => {
  const contents = readScript("restore.ps1");

  assert.match(contents, /acceptanceProjectName = "personal-tool-acceptance"/);
  assert.match(contents, /Automated restore is restricted to project/);
  assert.match(
    contents,
    /checksum validation failed before any restore operation/,
  );
  assert.match(contents, /pg_restore/);
  assert.match(contents, /--entrypoint pg_restore/);
  assert.match(contents, /--jobs=2/);
  assert.match(contents, /"--command", "ANALYZE;"/);
  assert.doesNotMatch(contents, /docker cp/);
  assert.match(contents, /DROP DATABASE IF EXISTS/);
  assert.match(contents, /CREATE DATABASE/);
  assert.match(contents, /mirror", "--overwrite", "--remove"/);
  assert.match(contents, /tag", "set"/);
  assert.match(contents, /find \/home\/node\/\.n8n/);
});

test("M2/T5 acceptance isolates artifacts and destroys only acceptance volumes", () => {
  const contents = readScript("acceptance.ps1");

  assert.match(contents, /acceptanceProjectName = "personal-tool-acceptance"/);
  assert.match(contents, /Copy-Item -LiteralPath \$EnvironmentFile/);
  assert.match(contents, /Copy-Item -LiteralPath \$sourceLicenseFile/);
  assert.match(
    contents,
    /observabilityScript -EnvironmentFile \$acceptanceEnvironmentFile/,
  );
  assert.match(contents, /down --volumes --remove-orphans/);
  assert.match(contents, /Acceptance project and volume cleanup failed/);
  assert.match(contents, /Assert-Manifest/);
  assert.match(contents, /Assert-SyntheticCredential/);
  assert.match(contents, /Redis acceptance marker was unexpectedly restored/);
  assert.match(
    contents,
    /Remove-Item -LiteralPath \$acceptanceRoot -Recurse -Force/,
  );
  assert.doesNotMatch(contents, /docker compose restart/);
});
