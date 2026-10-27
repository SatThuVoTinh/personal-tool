# Phase 1 database scan — db-2

**Mode:** Audit  
**Scope:** Database definitions under `infrastructure/` and application use, focused on backup, restore, integrity, and recovery.  
**Status:** Complete; static inspection only. No tests or Docker commands were run.  
**Candidate counts:** Critical 0; High 0; Medium 2; Low 0. Existing duplicate/reference: F-558 (not counted as a new candidate).

## Investigation

Inspected the PostgreSQL and Knowledge Compose definitions, bootstrap and backup scripts, the live Knowledge recovery-point acceptance driver, its Knowledge database backup-barrier consumer, and the operator backup documentation. The standard `backup.ps1` covers the `n8n` and `postgres` databases; `postgres` is the configured Knowledge database. The runbook explicitly says ordinary restore automation is not implemented (`docs/runbooks/knowledge-platform.md:51-65`). The separate live Knowledge driver creates a schema-scoped archive and restores it into a disposable PostgreSQL container.

## Candidate findings

### CAND-db-2-01 — the live Knowledge restore gate can certify an archive with missing segment rows

- **Path:** `infrastructure/docker/scripts/knowledge-t5-live.ps1:288-289`; related checks at `:330-332`, `:362-364`, and `:396`.
- **Evidence:** The required-object test accepts either a `TABLE` or `TABLE DATA` TOC line for each required name. Thus a valid archive containing the `knowledge.segments` table definition but no `TABLE DATA knowledge segments` entry satisfies the `segments` requirement at `:288-289`. The later metadata digest is built from `$criticalTables` at `:330-332`, which omits `segments`; the restored digest comparison at `:362-364` therefore does not compare any segment rows. The driver can consequently write `restore_verified = $true` at `:396` without having verified the recovery-critical segment contents.
- **Concrete fault injection:** Populate `knowledge.segments`, then produce a valid custom archive with the `knowledge` schema while excluding only `knowledge.segments` table data (for example, a scratch `pg_dump` invocation with `--exclude-table-data=knowledge.segments`). Its TOC retains the table definition but has no segment data entry. Feeding that archive through the verifier's checks passes the required-object predicate, catalog and migration checks, and metadata digest comparison while the restored `segments` table is empty. This was reasoned from the checks; the fault injection was not run.
- **Impact:** A recovery archive missing indexed segments can be reported as restore-verified, so this gate does not establish that Knowledge retrieval state survived restoration.
- **Class:** 2 — backup/restore/data-loss.
- **Severity:** Medium.
- **Other modules touched:** Zink Knowledgebase state is affected; the defect location and verification omission are in the in-scope infrastructure recovery driver.
- **Confidence:** Medium.
- **Duplicate check:** Distinct from open F-558 (`docs/execution/findings.md:1773-1784`), which concerns empty/unreadable backup inventories and false secret-inspection claims in `backup.ps1`; this candidate concerns a non-empty, structurally valid recovery archive whose `segments` data is not compared.

### CAND-db-2-02 — the n8n backup omits the encryption key needed to use its backed-up credentials

- **Path:** `infrastructure/docker/scripts/backup.ps1:113-127`; runtime key binding: `infrastructure/docker/compose/compose.core.yml:80`; key requirement: `README.md:448`.
- **Evidence:** The backup archives n8n's database and `/home/node/.n8n` but explicitly excludes the `config` file (`backup.ps1:113-127`); the same script's manifest enumerates only files under the backup root (`:138-158`). The running n8n service gets `N8N_ENCRYPTION_KEY` from external environment configuration (`compose.core.yml:80`), and the README identifies it as n8n's encryption key (`README.md:448`). No key is included in the archive or the inspected backup/runbook flow. Consequently the archive alone cannot restore usable encrypted n8n credentials if the original key configuration is lost.
- **Concrete reproduction:** Create the documented backup, restore its database and home archive into an n8n instance configured with a different encryption key, and attempt to use a credential object from the restored database; n8n cannot decrypt that credential. This was not executed.
- **Impact:** Loss of the original environment file/key alongside the host leaves backed-up n8n credentials unusable, which can block workflows after recovery.
- **Class:** 2 — backup/restore/data-loss.
- **Severity:** Medium.
- **Other modules touched:** n8n automation workflows; the missing key coverage is in the in-scope infrastructure backup.
- **Confidence:** Medium.
- **Duplicate check:** Distinct from F-558 (`docs/execution/findings.md:1773-1784`), which concerns empty/unreadable archive inventory being accepted and falsely reported as secret inspection success; this candidate concerns omitted external key material required to consume credential rows that the backup does include.

## Existing relevant finding

- F-558 remains the direct existing finding for standard backup inventory acceptance: `docs/execution/findings.md:1779-1783` cites non-zero dump size as the content check and the empty inventory coercion. It is not duplicated above because its reported mechanism differs from both candidates here.

## Out-of-scope pointers

None identified.
