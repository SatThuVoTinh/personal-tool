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

test("M3/T5 keeps deployment identity out of candidate parity", () => {
  assert.match(common, /function Get-T5Candidate/);
  assert.match(common, /candidate_fingerprint/);
  assert.match(common, /function Get-T5DeploymentFingerprint/);
  assert.match(common, /persistence = \$Persistence/);
  assert.match(common, /candidate_source_digest/);
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
    8,
  );
  assert.match(
    start,
    /KNOWLEDGE_VAULT_ROOT is required for the knowledge profile/,
  );
  assert.match(start, /KNOWLEDGE_VAULT_ROOT must contain 01\. Knowledge/);
  assert.match(stop, /ValidateSet\("all", "knowledge"\)/);
  assert.match(stop, /stop knowledge nginx redis postgres object-storage/);
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
  assert.match(common, /errno\.EROFS/);
  assert.match(common, /HostConfig\.PortBindings/);
  assert.match(isolated, /InjectFailureAfterStart/);
  assert.match(isolated, /port", "nginx", "8080"/);
  assert.match(
    isolated,
    /Isolated Nginx did not publish an ephemeral loopback endpoint/,
  );
  assert.match(isolated, /Remove-T5TemporaryResources \$runId/);
  assert.doesNotMatch(isolated, /\("build", "knowledge"\)/);
});

test("M3/T5 persists local evidence and guards a live rebuild", () => {
  assert.match(common, /temp\\knowledge-t5\\evidence/);
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
  assert.match(live, /schema migration ledger is missing, corrupt, or unknown/);
  assert.match(live, /backups\\knowledge-t5/);
  assert.match(common, /function Get-T5CgroupSnapshot/);
  assert.match(common, /function Get-T5ResourceWindow/);
  assert.match(common, /oom_count_before/);
  assert.match(common, /oom_kill_delta/);
  assert.match(isolated, /INTERRUPTED:FAILED:ACTIVE/);
  assert.match(live, /Assert-LiveSearch \$request -RequireExpectedSource/);
  assert.match(live, /restart", "knowledge/);
  assert.match(live, /accepted-candidate\.json/);
  assert.match(remote, /git merge-base --is-ancestor/);
  assert.match(remote, /Candidate-affecting source digest changed/);
  assert.match(remote, /Get-SuccessfulWorkflowRun "CI"/);
  assert.match(remote, /Get-SuccessfulWorkflowRun "Security"/);
  assert.match(remote, /--json databaseId,headSha,status,url/);
  assert.match(remote, /gh run view \$runs\[0\]\.databaseId/);
  assert.doesNotMatch(remote, /workflowDatabaseId/);
  assert.doesNotMatch(live, /down --volumes/);
});
