import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const dockerfile = read("apps", "knowledge", "Dockerfile");
const coreCompose = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.core.yml",
);
const knowledgeCompose = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.knowledge.yml",
);
const acceptanceCompose = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.m3-t5.acceptance.yml",
);
const acceptanceNginx = read(
  "infrastructure",
  "nginx",
  "conf.d",
  "t5-acceptance.conf",
);
const build = read("infrastructure", "docker", "scripts", "build.ps1");
const start = read("infrastructure", "docker", "scripts", "start.ps1");
const stop = read("infrastructure", "docker", "scripts", "stop.ps1");
const common = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-common.ps1",
);
const isolated = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5.ps1",
);
const live = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-live.ps1",
);
const remote = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-remote.ps1",
);

test("M3/T5 pins a clean HEAD-provenanced Knowledge image", () => {
  assert.match(dockerfile, /ARG KNOWLEDGE_IMAGE_REVISION=unverified/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(coreCompose, /KNOWLEDGE_IMAGE_REVISION/);
  assert.match(build, /git status --porcelain/);
  assert.match(build, /git rev-parse HEAD/);
  assert.match(build, /pull --ignore-buildable/);
  assert.match(build, /build --pull knowledge/);
  assert.match(build, /org\.opencontainers\.image\.revision/);
  assert.match(
    common,
    /Knowledge image provenance does not match the clean repository HEAD/,
  );
});

test("M4/T5 freezes portable Git path and blob candidate identities", () => {
  assert.match(common, /function Get-T5Candidate/);
  assert.match(common, /candidate_fingerprint/);
  assert.match(common, /function Get-T5DeploymentFingerprint/);
  assert.match(common, /persistence = \$Persistence/);
  assert.match(common, /function Get-T5CandidatePathManifest/);
  assert.match(common, /git ls-tree -r --name-only/);
  assert.match(common, /candidate_path_set_sha256/);
  assert.match(common, /candidate_manifest_sha256/);
  assert.match(common, /git_blob_oid/);
  assert.match(common, /ForEach-Object \{ \$_\.Replace/);
  assert.match(common, /T5Utf8ByteComparer/);
  assert.match(common, /function Test-T5CandidateAffectingPath/);
  assert.match(common, /\\\.npmrc/);
  assert.match(common, /\$pathBytes\.Add\(0\)/);
  assert.match(common, /\$manifestBytes\.Add\(0\)/);
  assert.match(live, /Get-T5MatchingRealVaultEvidence/);
  assert.match(live, /before database mutation/);
  assert.doesNotMatch(common, /ConvertFrom-Json -AsHashtable/);
});

test("M3/T5 declares a read-only operational Vault mount", () => {
  const document = parseDocument(knowledgeCompose, { merge: true });
  assert.deepEqual(document.errors, []);
  const mount = document.toJS().services.knowledge.volumes[0];
  assert.equal(mount.target, "/vault");
  assert.equal(mount.read_only, true);
  assert.match(knowledgeCompose, /KNOWLEDGE_VAULT_ROOT is required/);
  assert.match(
    knowledgeCompose,
    /com\.personal-tool\.persistence: operational/,
  );
  assert.equal(
    (
      knowledgeCompose.match(/com\.personal-tool\.persistence: operational/g) ??
      []
    ).length,
    5,
  );
  assert.match(
    start,
    /KNOWLEDGE_VAULT_ROOT is required for the knowledge profile/,
  );
  assert.match(start, /KNOWLEDGE_VAULT_ROOT must contain 01\. Knowledge/);
  assert.match(stop, /ValidateSet\("knowledge", "automation", "all"\)/);
  assert.match(stop, /stop @services/);
  assert.doesNotMatch(stop, /down --volumes/);
});

test("M3/T5 isolates cleanup by labels and proves kernel read-only behavior", () => {
  assert.match(acceptanceCompose, /com\.personal-tool\.acceptance-run/);
  assert.match(acceptanceCompose, /com\.personal-tool\.persistence: temporary/);
  assert.match(acceptanceCompose, /ports: !override\s+- "127\.0\.0\.1::8080"/);
  assert.match(common, /function Remove-T5TemporaryResources/);
  assert.match(common, /label=com\.personal-tool\.acceptance-run=\$RunId/);
  assert.match(common, /label=com\.personal-tool\.persistence=temporary/);
  assert.match(common, /function Assert-T5ReadOnlyMount/);
  assert.match(common, /function Assert-T5RuntimeIsolation/);
  assert.doesNotMatch(common, /Networks\.PSObject\.Properties\.Count/);
  assert.match(
    common,
    /@\(\$knowledge\.NetworkSettings\.Networks\.PSObject\.Properties\)\.Count/,
  );
  assert.match(common, /ReadonlyRootfs/);
  assert.match(common, /CapDrop/);
  assert.match(common, /NoNewPrivs/);
  assert.match(acceptanceCompose, /internal: true/);
  assert.match(
    acceptanceCompose,
    /KNOWLEDGE_OLLAMA_URL: http:\/\/nginx:8080\/ollama/,
  );
  assert.match(acceptanceNginx, /location = \/ollama\/api\/tags/);
  assert.match(acceptanceNginx, /location = \/ollama\/api\/embed/);
  assert.doesNotMatch(acceptanceNginx, /location \/ollama\//);
  assert.match(common, /non-allowlisted Ollama API/);
  assert.match(common, /errno\.EROFS/);
  assert.match(common, /HostConfig\.PortBindings/);
  assert.match(common, /NetworkSettings\.Ports/);
  assert.match(common, /ExpectedNginxHostPort = "8080"/);
  assert.match(isolated, /InjectFailureAfterStart/);
  assert.match(isolated, /port", "nginx", "8080"/);
  assert.match(
    isolated,
    /Assert-T5NetworkBoundary \$knowledgeId \$nginxId \$publishedPort/,
  );
  assert.match(
    isolated,
    /Isolated Nginx did not publish an ephemeral loopback endpoint/,
  );
  assert.match(isolated, /Remove-T5TemporaryResources \$runId/);
  assert.doesNotMatch(isolated, /\("build", "knowledge"\)/);
});

test("M4/T5 binds backup, recovery, and live mutation to one ownership interval", () => {
  assert.match(common, /ZinkKnowledge\\evidence\\m4-t5/);
  assert.match(common, /Initialize-T5PrivateEvidenceDirectory/);
  assert.match(common, /function Get-T5VaultTreeHash/);
  assert.match(common, /function Assert-T5NoUnsafeNestedReparsePoint/);
  assert.match(common, /IsCloudPlaceholder/);
  assert.match(
    common,
    /Nested link-like or unknown reparse point is not allowed/,
  );
  assert.match(common, /function Assert-T5ExpectedSourcePath/);
  assert.match(common, /\[\\x00-\\x1f\\x7f\]/);
  assert.doesNotMatch(common, /A-Za-z0-9\._ -/);
  assert.match(common, /firstCanonical\.topic/);
  assert.match(common, /firstCanonical\.tag/);
  assert.doesNotMatch(common, /unsupported primary topic/);
  assert.match(common, /function Write-T5Evidence/);
  assert.match(live, /ConfirmPersistentIndex/);
  assert.match(live, /No matching isolated RealVault PASS evidence exists/);
  assert.match(live, /pg_namespace/);
  assert.match(live, /migration ledger is missing, corrupt, or unknown/);
  assert.match(live, /LOCALAPPDATA/);
  assert.match(live, /ZinkKnowledge\\recovery\\m4/);
  assert.match(live, /--snapshot=\$\(\$Snapshot\.snapshot_id\)/);
  assert.match(live, /pg_restore --list/);
  assert.match(live, /--no-owner --no-acl/);
  assert.match(live, /Disposable recovery restore failed/);
  assert.match(live, /Live-database restore guard/);
  assert.match(live, /metadata digest differs/);
  assert.match(live, /sequence\/identity state differs/);
  assert.match(isolated, /t\.typtype::text/);
  assert.match(live, /t\.typtype::text/);
  assert.match(
    live,
    /arbitrary_knowledge_content_may_contain_secrets = \$true/,
  );
  assert.match(live, /known_credential_store_in_scope = \$false/);
  assert.match(live, /Assert-BackupGuardSelfTests/);
  assert.match(live, /Truncated recovery archive was accepted/);
  assert.match(live, /Final recovery archive collision/);
  assert.match(live, /Backup destination reparse guard/);
  assert.doesNotMatch(live, /compose .*run --rm.*pg_dump/);
  assert.match(common, /function Get-T5CgroupSnapshot/);
  assert.match(common, /function Get-T5ResourceWindow/);
  assert.match(common, /oom_count_before/);
  assert.match(common, /oom_kill_delta/);
  assert.match(isolated, /INTERRUPTED:FAILED:ACTIVE/);
  assert.match(live, /Assert-LiveSearch \$request/);
  assert.match(live, /restart", "knowledge/);
  assert.match(
    live,
    /accepted-candidate-\$\(\$candidate\.repository_sha\)\.json/,
  );
  assert.match(live, /Accepted candidate evidence is immutable/);
  assert.match(live, /status = "REMOTE-PENDING"/);
  assert.match(remote, /git merge-base --is-ancestor/);
  assert.match(
    remote,
    /Remote candidate path completeness or Git-blob manifest changed/,
  );
  assert.match(remote, /Get-SuccessfulWorkflowRun "CI"/);
  assert.match(remote, /Get-SuccessfulWorkflowRun "Security"/);
  assert.match(remote, /--json databaseId,headSha,status,url/);
  assert.match(remote, /gh run view \$runs\[0\]\.databaseId/);
  assert.doesNotMatch(remote, /workflowDatabaseId/);
  assert.doesNotMatch(live, /down --volumes/);
});

test("M4/T5 application exports backup before migration on the pinned lock", () => {
  const database = read("apps", "knowledge", "app", "database.py");
  const runner = read("apps", "knowledge", "app", "index_runner.py");
  const main = read("apps", "knowledge", "app", "main.py");
  assert.match(database, /pg_export_snapshot/);
  assert.match(
    database,
    /await self\._acceptance_backup_barrier\(connection\)/,
  );
  assert.match(database, /await self\._apply_migrations\(connection\)/);
  assert.match(database, /self\._startup_owner_connection = connection/);
  assert.match(runner, /adopt_startup_reservation/);
  assert.match(runner, /self\._acceptance_preclaimed/);
  assert.match(main, /database\.take_startup_owner_connection/);
  assert.match(main, /coordinator\.adopt_startup_reservation/);
});

test("M4/T5 cleanup cannot be skipped and acceptance marker is last", () => {
  assert.match(isolated, /finalizationError/);
  assert.match(isolated, /Remove-T5TemporaryResources/);
  assert.match(live, /finalizationError/);
  assert.ok(
    live.lastIndexOf('Write-T5Evidence "live"') <
      live.lastIndexOf("Write-T5AtomicJson $acceptedCandidatePath"),
  );
  assert.ok(
    live.lastIndexOf("docker rm -f $restoreContainer") <
      live.lastIndexOf("Write-T5AtomicJson $acceptedCandidatePath"),
  );
});

test("M4/T5 log leak inspection accepts normal container stderr safely", () => {
  assert.match(isolated, /\$ErrorActionPreference = "Continue"/);
  assert.match(isolated, /\$runtimeLogRecords = @\(& docker logs/);
  assert.match(isolated, /\$runtimeLogExitCode = \$LASTEXITCODE/);
  assert.match(isolated, /Unable to read Knowledge runtime logs/);
  assert.match(
    isolated,
    /IndexOf\("TOP_SECRET_VAULT_SENTINEL_M4_T5", \[StringComparison\]::Ordinal\) -ge 0/,
  );
  assert.doesNotMatch(isolated, /\.Contains\([^\r\n]+\[StringComparison\]/);
});
