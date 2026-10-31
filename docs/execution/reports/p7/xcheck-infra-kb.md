# Cross-Check Recheck Report — xcheck-infra-kb

**Boundary:** Infrastructure (compose/networks/hardening) ↔ Knowledgebase runtime
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed/verified IDs on this boundary:** `F-INFRA-001` (LATENT-static), `F-INFRA-004` (FIXED), `F-DB-001` (FIXED, live lane pending), `F-INFRA-003` (LATENT)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-INFRA-001` | `internal: true` on the platform network is present in BOTH carriers and matches the runtime profile wiring | **LATENT — static config consistent on both sides; live egress probe NOT RUN** | `compose.core.yml:228` and `networking/networks.yml:26` both declare internal; `agent-infra-F-INFRA-001-egress` 4/4 (`tests.md:11`); Docker lane NOT RUN (`tests.md:13`) |
| `F-INFRA-004` | All three acceptance drivers agree on the shipped migration set | **FIXED — consistent** | `001/002/004/005` accepted in `knowledge-t5.ps1:178,244`, `knowledge-t5-live.ps1:451,474`, `knowledge-t5-common.ps1:355`; `m3-t5-contract` 8/8 (`a9ddced`) |
| `F-DB-001` | Restore verification's segment expectations agree with the migration-set the drivers now accept | **FIXED — consistent** | `knowledge-t5-live.ps1:288-331` adds `segments` + PDF family exactly when `002_pdf_ingestion_foundation.sql` shipped — same predicate as the driver's migration set |
| `F-INFRA-003` | Hardening overlay exists and `start.ps1` conditionally appends it; live hardening still unproven | **LATENT — undispatched (owner RED memo)** | `compose.knowledge.hardening.yml:1-10`, `start.ps1:19,47-49` conditional append (from `16b973d`, previous loop); Docker lane NOT RUN |

## 2. Interaction Findings

- **Driver↔restore consistency:** the `002`-conditional extension is the single source both drivers and the restore verifier branch on; no mismatch remains between the accepted migration set and the checked table inventory.
- **Egress/hardening seam:** `internal: true` and the hardening overlay are independent controls; the acceptance egress suite pins the static network posture only. The live-container egress and the five hardening controls (`read_only`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit: 256`, `/tmp` tmpfs) both require the Docker lane — recorded NOT RUN.
- **Knowledgebase runtime:** no KB-side file depends on the network overlay; the Knowledge service still resolves its model URL through the Nginx allowlist route (`infrastructure/nginx/conf.d/default.conf:29-47`) — boundary unchanged.

## 3. Blockers

- `F-INFRA-001`/`F-INFRA-003` closure both require the Docker lane (host not provisioned) and, for F-INFRA-003 dispatch, the owner memo.
