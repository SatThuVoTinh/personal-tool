# Phase 7 Cross-Module Recheck Report — Infrastructure <-> OpenClaw

- **Boundary:** Infrastructure <-> OpenClaw
- **Focus:** Setup, templates, runtime config, deployment/preflight/rollback gates
- **Mode:** Recheck (Phase 7)
- **Target Finding IDs:** `F-OC-008`
- **Reference Reports:** `docs/execution/reports/p2/xcheck-infra-oc.md`, `docs/execution/reports/p6/scan-oc-6.md`, `docs/execution/findings.md:2243-2256`

---

## 1. Finding Recheck: F-OC-008

### F-OC-008 — Post-rename directory-fsync failure leaves untracked hotfix artifact mixture blocking gateway startup

- **Category:** F6 — Reliability & Performance
- **Severity:** High
- **Verdict:** **NOT FIXED**

#### Evidence of Current State

Inspection of `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs` confirms that no patch or remediation was applied; the vulnerable code patterns described in `docs/execution/findings.md:2251-2253` and `docs/execution/reports/p6/scan-oc-6.md:15-95` remain identical in the codebase:

1. **`writeAtomically` (`integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:290-316`)**:
   - `renameSync(temporaryPath, filePath)` at line 300 replaces the live file with new content.
   - `syncDirectory(path.dirname(filePath))` at line 301 is executed immediately after `renameSync`.
   - If `syncDirectory` fails (e.g., throwing `EIO`), control transfers to the `catch` block (lines 302-315).
   - The `catch` block unlinks `temporaryPath` (lines 310-314), but `temporaryPath` was already renamed at line 300. The already-renamed destination `filePath` is neither reverted nor unlinked, leaving the modified artifact on disk.

2. **`writeTransaction` (`integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:416-446`)**:
   - `writeAtomically` is called at line 425:
     ```javascript
     writeAtomically(record.filePath, record.desired, record.fileMode);
     changed.push(record);
     ```
   - `changed.push(record)` at line 426 is only reached if `writeAtomically` completes without throwing.
   - When `syncDirectory` throws within `writeAtomically`, the target is already patched on disk, but `record` is never added to `changed`.
   - The subsequent rollback block (lines 429-436) iterates strictly over `[...changed].reverse()`. It therefore never reverts the artifact that failed during directory fsync.

3. **`classifyState` (`integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:379-395`)**:
   - Only three specific states are accepted: all-patched (`patched`), all-original (`original`), and first-artifact-only patched (`r18-predecessor`).
   - If a failure occurs during the application of subsequent artifacts (e.g., artifact 2 of 4), the resulting artifact set (e.g., `[original, patched, original, original]`) is deemed an unsupported partial state and throws `Error("OpenClaw hotfix artifacts are in an unsupported partial state")`.

4. **Gateway Startup Preflight Block (`integrations/openclaw/lib/policy.mjs:1989`)**:
   - The generated systemd user service for the OpenClaw gateway executes `ExecStartPre` invoking `--ensure`:
     `ExecStartPre=/usr/bin/node .../openclaw-gemini-stream-hotfix.mjs --ensure`
   - When `--ensure` executes against an unsupported partial state, `hotfixBootAction` throws, failing `ExecStartPre` and preventing the OpenClaw gateway service from starting.

---

## 2. Cross-Boundary Impact & Isolation Verification (Infrastructure <-> OpenClaw)

### 2.1 Runtime, Process, and Network Isolation
- **Infrastructure Services**: Defined in `infrastructure/docker/compose/compose.core.yml:9-183` (PostgreSQL, n8n, Nginx, and Knowledge) on the project `platform` bridge network.
- **OpenClaw Gateway**: Runs as a user-level host systemd service (`integrations/openclaw/lib/policy.mjs:1979-1989`) binding loopback with token authentication (`integrations/openclaw/lib/policy.mjs:1349-1355`).
- **Boundary Independence**:
  - The Infrastructure Docker Compose stack does not define, mount, or execute the OpenClaw gateway service or its setup templates.
  - Infrastructure startup scripts (`infrastructure/docker/scripts/start.ps1:83-91`) wait on PostgreSQL and start Knowledge/Nginx/n8n without any coupling to OpenClaw's systemd unit or hotfix templates.
  - The unpatched state of `F-OC-008` is entirely confined to OpenClaw's host runtime setup and does not block or impair Infrastructure stack deployment or operation.

### 2.2 Error Semantics & Preflight Gates
- An `EIO` or fsync failure during OpenClaw hotfix execution stops only the OpenClaw gateway service (`openclaw-gateway.service`) via systemd's `ExecStartPre` failure.
- No error is propagated across the boundary into Infrastructure containers, logs, or exit codes.
- Preflight gates remain cleanly partitioned: Infrastructure checks container health via Docker healthchecks (`compose.core.yml:19-24,123-177`), while OpenClaw verifies itself via `integrations/openclaw/verify.mjs:677-751`.

### 2.3 Shared Configuration, Ports, Volumes, and Credentials
- **No Shared Volumes**: Docker volumes (`postgres-data`, `n8n-data`) remain isolated from OpenClaw's local directory state (`~/.openclaw` or workspace paths).
- **No Direct Mutation**: OpenClaw does not touch or mutate Infrastructure state stores, nor does Infrastructure mutate OpenClaw's hotfix targets.
- **Ports & Loopback**: Communication across the boundary occurs solely over HTTP loopback through Nginx (`http://127.0.0.1:8080/knowledge`, `integrations/openclaw/plugins/zink-governance/index.mjs:4572-4584`). OpenClaw gateway downtime does not impair Nginx proxying or Knowledge availability.

### 2.4 Backup and State Ownership
- Infrastructure backup (`infrastructure/docker/scripts/backup.ps1:89-160`) covers PostgreSQL databases and n8n home directory.
- OpenClaw backup (`integrations/openclaw/topology/lib/runtime-backup.mjs:340-460`) is an independent host-level tool covering OpenClaw configs and workspaces.
- Neither backup mechanism couples to the other, preserving module independence.

---

## 3. Blast Radius & Standalone Operation

### Standalone Operation
- **Infrastructure**: **FUNCTIONAL / STANDALONE PASS**. All Infrastructure Docker Compose services deploy, run, and pass health checks independently of OpenClaw.
- **OpenClaw**: **FUNCTIONAL WITH LATENT DEFECT**. OpenClaw operates under normal conditions, but remains susceptible to `F-OC-008`: any I/O failure on directory fsync during hotfix template application leaves an untracked partial runtime that blocks gateway startup.

### Blast Radius of Eventual Fix
When remediation for `F-OC-008` is implemented:
- **Primary Fix Boundary**: `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs` (transaction logging before sync, atomic destination rollback or swap, and safe recovery in `writeTransaction`).
- **Affected Surface**: The 4 managed OpenClaw vendor runtime artifacts and the systemd `ExecStartPre --ensure` gate.
- **Infrastructure Blast Radius**: **ZERO**. The fix must not touch Infrastructure Compose declarations, container networks, volume mounts, or Nginx configurations.

---

## 4. Recheck Summary

| Finding ID | Severity | Status | Cross-Module Boundary Impact | Standalone Impact |
|---|---|---|---|---|
| `F-OC-008` | High | **NOT FIXED** | None (clean isolation between host systemd unit and Docker Compose stack) | OpenClaw gateway startup blocks if directory fsync fails during hotfix write; Infrastructure completely unaffected |

- **Total findings rechecked:** 1
- **Fixed:** 0
- **Partial:** 0
- **Not Fixed:** 1 (`F-OC-008`)
- **Blockers:** None across the Infrastructure <-> OpenClaw boundary.
