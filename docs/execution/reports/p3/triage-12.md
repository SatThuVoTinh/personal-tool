# Phase 3 triage — bucket 12 (loop 1)

- Agent: `triage-12` (phase 3, loop 1). Read-only on source; only this file written.
- Dispatch tree: HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, branch `codex/m11-t1-audit-remediation`, tree already dirty (`docs/execution/context.md:5,19,21`). Shell/git-status was permission-denied to this lane, so verification is by reading the checked-out working-tree files at their cited line numbers (all locators re-opened). No source, findings.md or context.md edits made.
- Register candidate in this bucket: `F-DB-002`. Also verifying the `F-463` existing-row annotation (`/mnt`/`/opt`/`/srv`/`/root` residual merged into F-463 vs a new row), per dispatch.

---

## F-DB-002 — n8n backup excludes the encryption key required to decrypt backed-up credentials

**Verdict: CONFIRMED-AS-LATENT.**

### Evidence re-verification (all locators, current working tree)

- `infrastructure/docker/scripts/backup.ps1:113-117` — the n8n home tar is built with an explicit `--exclude=config`:
  `tar -C /home/node/.n8n --exclude=config -czf /backup/n8n-home.tar.gz .` (line 116). CONFIRMED at HEAD.
- `infrastructure/docker/scripts/backup.ps1:138-160` — the manifest enumerates only files under `$backupRoot` (`Get-ChildItem -LiteralPath $backupRoot -File -Recurse`), i.e. the two `postgres/*.dump` and `n8n-home.tar.gz`, plus `secret_inspection`. It records no encryption-key value and no reference/pointer to the key's recovery location. CONFIRMED.
- `infrastructure/docker/compose/compose.core.yml:80` — `N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY:-unconfigured}` is supplied from the external env file. CONFIRMED. `n8n-data` volume (`:87-88`, `:224-225`) holds `/home/node/.n8n`.
- `README.md:444-448` — instructs the operator to copy `.env.example` to `infrastructure/docker/env/.env` and set `N8N_ENCRYPTION_KEY` ("Khóa mã hóa cho n8n"). So the real key lives only in the gitignored host `.env`. `.env.example:4` ships only a placeholder; `.gitignore:2-7` excludes `.env`/`.env.*` while keeping `.env.example`. CONFIRMED.
- `docs/runbooks/knowledge-platform.md:51-65` — publishes `backup.ps1` as the operator backup command and states at `:65` "Restore automation is not implemented in the current runtime contract." No runbook text warns that the archive requires the matching key, and no restore/key-retention procedure exists. CONFIRMED.
- Tests: `tests/m5-docker-contract.test.mjs:241` asserts `backup.ps1` keeps `--exclude=config`; `:155-158` (via `credential-sentinels.ps1:51`) asserts the runtime requires a non-sentinel `N8N_ENCRYPTION_KEY` at startup. Neither binds a backup archive to a recovery-key reference or a restore drill. CONFIRMED. (Corroborated by `docs/execution/reports/p2/xcheck-tests-all.md:266-268`.)

### Can an operator retain key material outside repo/README? — YES, and that is correct posture

The key is expected to live in the host `.env` (gitignored), independent of both the repo and the backup archive. `backup-inspection.ps1:29-30` classifies the n8n `config` path as a plaintext secret carrier and `m5-docker-contract:241` pins its exclusion. Therefore excluding `config` from the archive is an intentional secret-exclusion guarantee, not the defect — putting the key (or `config`) into the backup would *weaken* the security boundary AGENTS §10 protects. This alone refutes any reading that the fix is "include the key in the archive."

### Is the unrecoverability conditional/unverified, or a confirmed data-integrity defect?

Split precisely:

- CONFIRMED, code/doc-proven, unconditional: the backup contract produces **no recovery binding for the key** — the manifest carries neither the key nor a verifiable pointer to where the matching key is kept, and no runbook/restore procedure tells the operator that the archive cannot decrypt restored n8n credentials without the separately-held key. A backup taken today is self-insufficient for credential recovery and is not labelled as such. This is a real, present defect in the backup/recovery surface.
- CONDITIONAL and UNVERIFIED: the *data loss* (restored n8n credentials unusable, workflows blocked after recovery) fires only if the operator loses the external key configuration (e.g. whole-host loss without a separate `.env`/key backup). The repository does not establish the operator's key-retention arrangement, and the proposed wrong-key restore drill was **not executed** (`findings.md:2327`; `scan-db-2.md:30`; `xcheck-db-all.md:45,48`; `xcheck-infra-skill-tools.md:29`). `scan-infra-2.md:33` declined to file any data-loss claim for exactly this reason; `scan-db-2.md:26` filed the coverage gap anyway.

Because the mechanism is code-proven but the loss consequence is contingent and un-fired, this is `LATENT` in the register's own §0.3 sense, not plain OPEN, and not REFUTED/OVERSTATED. Both P2 lanes independently described it as "archive omission confirmed; unrecoverability conditional on loss of external key configuration." Verdict `CONFIRMED-AS-LATENT` records the surviving, verified half (missing recovery reference) without asserting a demonstrated data loss.

### DUPLICATE-OF F-558 check — NO

F-558 (`findings.md:1773-1784`) is the empty/unreadable backup-inventory coercion producing a false `plaintext_secrets_excluded` certification. Its mechanism is inspection-default-as-observation; F-DB-002 is a non-empty, valid archive that simply does not carry/point to the decryption key. `scan-db-2.md:24,36`, `xcheck-db-all.md:51,80`, `xcheck-infra-skill-tools.md:27` and `xcheck-tests-all.md:255,269` all reached the same independence conclusion. Not a duplicate; not a symptom of F-558.

### WRONG-SITE check — NO

The defect location is the infrastructure backup surface (`backup.ps1` manifest region + `docs/runbooks`), and its consumer is the n8n runtime at the `integrations/openclaw`/n8n hosting boundary (n8n is not a fourth module; AGENTS §9). Correctly sited.

### Finding fields

- type: `backup-restore` (context.md defines no taxonomy, so the dispatch fallback list applies; the register's §0.4 `Category: F5` is retained on the row — nature is data-loss-of-encrypted-credentials/recoverability, with F6 recovery-failure arguable).
- severity: **medium** (conditional/degraded — recoverability assurance gap; the loss outcome is not demonstrated). Root-cause of no other row. Not high: no proven exploit, no proven data loss, system still runs.
- category (row): F5 — Data Integrity & Result Correctness.
- status wording to apply: `LATENT — archive omission + missing recovery-key reference code-proven; credential-unrecoverability conditional on external key loss, restore drill not executed.`
- root_cause_of: none.
- depends_on: **F-558** — both edits land in `backup.ps1`'s manifest/inspection region (`:108,116,138-162`); F-558 reorders the inventory-refusal to sit ahead of `plaintext_secrets_excluded`, so F-DB-002's added key-reference field must be built on the post-F-558 manifest shape (parallel-write hazard on `backup.ps1`). F-DB-001 and F-INFRA-002 are independent and are **not** dependencies.
- red: **YES**. Reason (AGENTS §7): the register's acceptance criteria ("securely preserve or identify the matching key … a restore drill demonstrates credentials remain usable") change backup/recovery semantics and the operator recovery contract and force edits to the named gate `tests/m5-docker-contract.test.mjs`; any option that *stores* key material would also cross the secret-exclusion security boundary. Smallest sound alternative: add a non-secret recovery pointer (key fingerprint/ID + a "retain `N8N_ENCRYPTION_KEY` separately" reference) to `manifest.json` and an explicit operator key-retention/restore warning in `docs/runbooks/knowledge-platform.md`, keeping `--exclude=config` and never writing key bytes to backup output.
- fixer: **fix-infrastructure** (owns `infrastructure/**` and the database/backup definitions). Files the fix would touch: `infrastructure/docker/scripts/backup.ps1` (manifest region ~`:138-162`), `infrastructure/docker/scripts/backup-inspection.ps1` (optional non-secret key-ref field), `docs/runbooks/knowledge-platform.md` (restore/key-retention guidance), `README.md` (operator key-retention note), and `tests/m5-docker-contract.test.mjs` (gate assertion) — the last is a `tests/**` shared surface, so coordinate the test edit with `fix-tests` under one integration owner; both also touch F-558's site, so sequence after F-558.

### Blockers / limitations

- Shell and `git diff` were permission-denied to this lane; HEAD/dirty state is taken from `docs/execution/context.md:21`. All cited lines were re-read in the working tree and match.
- The proposed wrong-key restore drill and the operator-retention question are external-dependent (host `.env`, live n8n); they are `NOT RUN` and must stay `NOT RUN`, not converted to a pass (AGENTS §11). Data-loss impact therefore remains unverified — that is the basis for LATENT, not OPEN.

---

## Annotation check — F-463 `/mnt`/`/opt`/`/srv`/`/root` sanitizer residual (merged vs new row)

**Verdict: merge is CORRECT — keep under F-463, no separate row.**

- F-463 row is `Status: OPEN`, `Severity: High` (`findings.md:1110-1121`). Its `Related findings` line `:1121` records the loop-1 residual: F-463's original "clipField-only, no redaction" premise is stale because `renderGovernedPlanSteps` now calls `redactGovernedField`→`sanitizeDiscordText`, but `BANNED_PATTERNS` still covers only `/Users`,`/home`,`/tmp`,`/etc`,`/var`,`/app`, so `/mnt`,`/opt`,`/srv`,`/root` survive; "no separate row is filed for that residual."
- Re-verified at the working tree: `integrations/openclaw/lib/discord-formatter.mjs:23` — path alternative is `\/(?:Users|home|tmp|etc|var|app)\/`, i.e. the four roots are genuinely unmatched (CONFIRMED). `:663-665` `redactGovernedField = clipField(sanitizeDiscordText(...))` and `:690-695` route `inputs`/`constraints`/`validation_criteria` through it — the annotation's "premise partly stale" is accurate. `plugins/zink-governance/index.mjs:1902-1905` `sanitizeApprovalBody` now only strips mentions, consistent with the annotation.
- P1 `scan-oc-1.md:10-19` filed CAND-oc-1-01 and explicitly routed it: "F-463 … should receive this concrete unhandled path class during consolidation; this is a residual case of that finding rather than an unrelated root cause." P2 `xcheck-oc-discord-gov.md:8-16,38,53` independently: "Confirmed residual of existing F-463, not a separate mechanism … do not create an independent duplicate."
- Assessment: same root cause class (incomplete path-class redaction at the governed approval/result Discord body sink), same fix site (`discord-formatter.mjs:22-29` BANNED_PATTERNS), same security boundary and same fixer (`fix-openclaw-discord-adapters`). F-463's acceptance criteria already demand that every free-text plan field pass the BANNED-PATTERN redactor, which properly read requires the pattern to actually catch the path classes. This is a widening of one OPEN/High finding, not a new mechanism, so §0.2.6 (new bug → new row) does not apply. Merge is correct.
- Recommendation for the main agent when consolidating: keep it in F-463 but update F-463's `Evidence`/`Reproduction` so the surviving subcase is *reproduction-locked* — the redaction regression case must assert a `/mnt/`,`/opt/`,`/srv/`,`/root/` sentinel is stripped, so the residual cannot silently drop when the stale headline wording is edited. F-463 stays `red: YES` (security-boundary change, already so for the row); its fixer stays `fix-openclaw-discord-adapters` (asks per edit). No depends_on change.

---

## Counts (this bucket)

- CONFIRMED-AS-LATENT: 1 (F-DB-002) — medium, backup-restore, fix-infrastructure, red YES, depends_on F-558.
- Annotation confirmed correct (merge, no new row): 1 (F-463 residual).
- REFUTED / OVERSTATED / UNDERSTATED / DUPLICATE-OF / WRONG-SITE / BLOCKED in this bucket: 0.
- Blockers: shell/git diff permission-denied (evidence taken from context.md:21 + direct file reads); F-DB-002 restore drill and operator key-retention are external-dependent and remain NOT RUN.
