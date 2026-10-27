# Phase 3 triage — bucket 01 (loop 1)

- **Agent:** triager 01 of 12. Mode: read-only adversarial verification. No source,
  `findings.md` or `context.md` write was made or is authorized.
- **Target:** dispatch working tree (HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`,
  branch `codex/m11-t1-audit-remediation`, dirty baseline `docs/execution/context.md:5,19,21`).
  Every locator was re-opened in the checked-out working tree, i.e. the object the run
  declared as the audit target.
- **Instructions:** root `AGENTS.md` read; `glob **/AGENTS.md` over the repository returns
  the root file only — no nested `AGENTS.md` exists, so no narrower directory rule applies.
  `docs/execution/findings.md` §0.1–§0.5 (format, mandatory workflow, status vocabulary,
  F1–F7 taxonomy) and `docs/execution/slices.md:49-67` (phase 3 role, fixer routing) read.
- **Checks run:** file-by-file re-read of every `Evidence:` locator; `git status --short`
  (allowed) for dirty attribution; `git diff --stat` and two scoped `git diff` reads
  (`apps/knowledge/app/database.py`, `zink-skill-store/src/migrations.mjs`). A combined
  multi-path `git diff` and a `git show --stat HEAD` were **denied by permissions**
  (`permission.rejected: shell`), so dirty attribution for the F-INFRA-001 locator set is
  by absence from `git status --short`, not by diff.
- **Counters:** rows triaged 2. Verdicts: CONFIRMED 1 (`F-INFRA-002`),
  CONFIRMED-AS-LATENT 1 (`F-INFRA-001`). REJECTED/REFUTED/OVERSTATED/UNDERSTATED/
  DUPLICATE-OF/WRONG-SITE 0. Severity granted: high 1, medium 1, root-cause 0.
  Blockers 3 (§4).
- **Probes:** neither row's live probe (Knowledge direct TCP/DNS egress; PostgreSQL
  `current_user`/`rolsuper`) was run, and none could be run from this read-only lane.
  Nothing in this report converts an unavailable gate into a pass (`AGENTS.md` §11).

---

## 1. F-INFRA-001 — deployed Knowledge container can bypass the model gateway through unrestricted bridge egress

- **Verdict:** **CONFIRMED-AS-LATENT** — the shipped configuration defect is proven; the
  runtime reachability half is host-dependent and unmeasured. Register §0.3 defines
  `LATENT` as code-proven but not yet live-fired, which is exactly this state. The row's
  `HYPOTHESIS` status should become `OPEN`/`LATENT` only on the lead's measurement, not mine.
- **type:** F2 — Security & Authorization (`findings.md` §0.4: "thoát sandbox, bypass";
  the defect is the enforced boundary being only one application-layer hop deep). Not
  `config-drift`: the drift framing belongs to `F-INFRA-003`, which names the *overlay
  selection* mechanism.
- **severity:** **medium** (keep as registered — `docs/execution/findings.md:2038`). Why
  not high: the bypass needs an outbound-capable code path inside the Knowledge process or
  a process compromise (`docs/execution/reports/p1/scan-infra-1.md:16`), and no exfiltration
  or data-loss primitive is evidenced. Why not low: the config deliberately documents the
  opposite. `compose.core.yml:157-159` and `default.conf:24-28` both carry F-288 comments
  asserting the deployed stack "carries the same egress boundary the acceptance overlay
  proves" / "the isolation evidence covers the shape that actually ships". At HEAD that
  claim is false, so the row's subject is a security control that is *claimed* in shipped
  comments and pinned green by a test that does not test it (§3).
- **root_cause_of:** none asserted. It is a **sibling**, not a duplicate, of `F-INFRA-003`
  (`findings.md:2293-2304`): both are instances of "isolation is declared in overlays the
  operational path never assembles", but the keys differ (network `internal` vs
  `read_only`/`cap_drop`/`security_opt`/`pids_limit`/tmpfs), and the fix sites differ.
  Recommend the lead record the shared mechanism as prose in both rows rather than merge them.
- **depends_on:** none for the defect. Practical coupling: `F-569` (`findings.md:1877-1888`)
  owns the fact that `compareSharedNetworks` (`scripts/repository-policy.mjs:1538-1558`)
  reconciles only the `driver` key across the three files that declare `platform`, so an
  `internal:`/egress-attribute change is invisible to `repo:check`. Fix `F-569` first or the
  new invariant will be unprotected by any gate.

### Refutation attempts and counter-evidence

1. **"A host firewall or daemon policy blocks egress, so there is no defect."** Cannot be
   established from this repository, and no in-repo control was found: a repo-wide grep of
   `infrastructure/` for `iptables|nftables|ufw|firewall|FirewallRule` returns **exactly one**
   hit, and it is `compose.m3-t5.acceptance.yml:54 internal: true` — the *acceptance* overlay,
   not the deployed path. The deployed network definition is non-internal in **both** places
   that declare it: `infrastructure/docker/compose/compose.core.yml:216-222` (`platform:` /
   `driver: bridge`, no `internal` key) and its canonical source
   `infrastructure/networking/networks.yml:23-25`, whose documented creation step at `:18` is
   `docker network create --driver bridge <project>_platform` — no `--internal`. So a host
   that pre-creates the network per the runbook also gets an egress-capable bridge. The
   *possibility* of external blocking survives; the absence of a boundary in shipped config
   does not.
2. **"Knowledge never needs raw egress, so the path is unused."** The stronger bypass is
   already reachable without any internet route: `compose.core.yml:164-165` gives the
   deployed container `host.docker.internal:host-gateway`, and `default.conf:34,42` prove the
   model service answers at `host.docker.internal:11434`. `Assert-T5ModelEgressAllowlist`
   (`knowledge-t5-common.ps1:583-584`) runs **inside the Knowledge container** and requires
   `http://nginx:8080/ollama/api/tags` to return 200, which it can only do if Nginx's
   `host.docker.internal:11434` upstream is reachable from this Compose network. The allowlist
   exists precisely to deny `api/pull` and request-controlled forwarding
   (`default.conf:24-28,37-43`, `knowledge-t5-common.ps1:585-588`); a direct socket from
   Knowledge to `host.docker.internal:11434` reaches that unfiltered API surface, and the
   deployed stack is the one that carries the mapping. Counter-evidence for the intended
   posture: the acceptance overlay `!reset []` its `extra_hosts`
   (`compose.m3-t5.acceptance.yml:33`) and the acceptance isolation check throws if the
   container has *any* extra host route (`knowledge-t5-common.ps1:596-599`). This is the
   single most concrete part of the row and the register does not yet name it.
3. **"It duplicates a live register row."** No. `F-520` (`:1474`) is the repository-policy
   parser dropping unparseable overlays; `F-569` (`:1877`) is the driver-key operand
   asymmetry; neither asserts or enforces runtime egress. A grep of `findings.md` for
   `egress|internal: true|bridge|host.docker.internal` returns only the F-INFRA-001 row,
   the F-569 evidence lines about the driver key, and unrelated Discord/governance hits.
   No CHANGELOG row closes a deployed-stack egress isolation claim.
4. **"The row's own locators are stale."** They are not. All re-opened exactly:
   `compose.core.yml:149-153` (env), `:157-160` (gateway URL), `:164-165` (`extra_hosts`),
   `:182-183` (`networks: platform`), `:216-222` (`platform: driver: bridge`);
   `default.conf:29-43,45-47`; `compose.m3-t5.acceptance.yml:52-58` (`internal: true`) plus
   the separate `t5-ollama-egress` network at `:59-63` and dual-homed Nginx at `:18-20`;
   `knowledge-t5-common.ps1:591-609` — TCP probe `1.1.1.1:443` at `:603`, UDP/DNS probe
   `8.8.8.8:53` at `:605`, internal-network assertion at `:602`, approved-postgres control at
   `:607`; `knowledge-t5-live.ps1:463-472` — that window calls only `Wait-LiveReady`,
   `Assert-T5ReadOnlyMount`, `Assert-T5NetworkBoundary`, `Assert-T5PrivilegeBoundary`,
   `Assert-T5ModelEgressAllowlist`. `Assert-T5NetworkBoundary` (`:550-568`) checks port
   publication only, never egress. Decisive: `Assert-T5RuntimeIsolation` has **two** matches
   repo-wide — the definition (`knowledge-t5-common.ps1:591`) and the single call from the
   isolated acceptance driver (`knowledge-t5.ps1:176`). The live/deployed driver
   (`knowledge-t5-live.ps1`) never calls it.
- **Evidence:** `infrastructure/docker/compose/compose.core.yml:182-183,216-222`;
  `infrastructure/networking/networks.yml:18,23-25`;
  `infrastructure/nginx/conf.d/default.conf:24-28,29-43,45-47`;
  `infrastructure/docker/compose/compose.m3-t5.acceptance.yml:18-20,33,52-63`;
  `infrastructure/docker/scripts/knowledge-t5-common.ps1:550-568,570-589,591-609,617-629`;
  `infrastructure/docker/scripts/knowledge-t5-live.ps1:463-472`;
  `infrastructure/docker/scripts/knowledge-t5.ps1:176`;
  `infrastructure/docker/compose/compose.m4-t5.live.yml:1-17` (no network/`extra_hosts`
  change); `tests/agent-owner-F-288.test.mjs:185-211`;
  `tests/m3-t1-contract.test.mjs:81-85,91-99`; `tests/m3-t5-contract.test.mjs:141-160`.
- **Reproduction:** the row's own probe remains the right one and stays `NOT RUN`
  (`docs/execution/findings.md:2042`): against the *deployed* composition (core +
  `compose.knowledge.yml`, as `knowledge-t5-live.ps1:21-23` assembles it), from the Knowledge
  container run the two existing probes verbatim (`1.1.1.1:443`, `8.8.8.8:53`) and add
  `host.docker.internal:11434/api/pull`. A success on any of the three is the live proof;
  refusal on all three is the refutation. This requires a disposable deployed-shape run —
  it must not be attempted against live state (`AGENTS.md` §10).
- **red:** **YES.** Per `AGENTS.md` §7 the fix changes **topology** and a **security
  boundary**: making the deployed Knowledge workload contained means an internal KB network
  plus an egress-capable network for the gateway only — the topology the acceptance overlay
  already demonstrates — and the p2 reports measured the cost: a blanket `internal: true` on
  the shared `platform` also cuts n8n egress and Nginx's host Ollama route
  (`docs/execution/reports/p2/xcheck-infra-kb.md:37`; `xcheck-infra-oc.md:19`), which
  additionally risks OpenClaw's router/Discord connectivity if done host-wide
  (`xcheck-infra-oc.md:13,19`). It also requires editing two shipped contract tests (§3),
  which §7 treats as a required-gate change, and §10 forbids weakening a control to pass.
- **fixer:** `fix-infrastructure` (`docs/execution/slices.md:67`, `infrastructure/**`).
  Files a fix would touch:
  `infrastructure/docker/compose/compose.core.yml` (service `networks` + the `networks:`
  block), `infrastructure/networking/networks.yml`,
  `infrastructure/docker/compose/compose.knowledge.yml`,
  `infrastructure/docker/scripts/knowledge-t5-live.ps1` (call the direct TCP/DNS probes on
  the deployed shape), `infrastructure/docker/scripts/knowledge-t5-common.ps1` (shape-agnostic
  egress probe), and the two pins `tests/m3-t1-contract.test.mjs:81-85` and
  `tests/agent-owner-F-288.test.mjs:185-211` (co-owned with `fix-tests`), plus
  `scripts/repository-policy.mjs`/`tests/repository-policy.test.mjs` if the shared-network
  reconciliation is extended (that is `F-569`'s site — coordinate, do not co-edit).
- **Widening the lead should consider (measured, not folded in):** the unfiltered
  `host.docker.internal:11434` path (refutation attempt 2) is in-repo and does not depend on
  unknown host firewall state, whereas the public-internet TCP/DNS half does. The row's
  title/`Root cause` currently lead with the weaker half.

## 2. F-INFRA-002 — Knowledge service uses the PostgreSQL cluster administrator for routine database access

- **Verdict:** **CONFIRMED** at the configuration and code-path level. The defect is a
  privilege-boundary defect whose premise is fully determined by shipped artifacts plus the
  digest-pinned image contract; no live measurement is needed to establish that the only
  credential the application is given is the cluster bootstrap superuser.
- **Explicit answer to the dispatch question — is the unprobed live role privilege required
  before confirmation?** **No, not for confirmation. Yes, for closure.** Specifically:
  (a) confirmation needs `compose.core.yml:13-16` (`POSTGRES_USER: postgres`),
  `:149-153` (that identity + that password handed to the app over TCP), the absence of any
  narrower credential, and the image's initialization contract — all in-repo; (b) the
  acceptance criterion "a regression proving that the runtime identity cannot administer the
  cluster or read/write n8n-owned data" (`findings.md:2056`) **cannot** be satisfied without
  the `SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user` probe and a
  cross-database read on a disposable deployment; until then that gate is `NOT RUN` and the
  row may be `OPEN` but never `CLOSED` under §0.2 rule 6(b). Recording the row as
  `BLOCKED` instead would be wrong: the *defect* is measured, only the *fix evidence* is not.
- **type:** F2 — Security & Authorization (§0.4: "Vượt quyền … rò rỉ dữ liệu"; the register's
  own category is correct). Not `backup-restore`/`data-integrity`: backup coverage is
  `F-DB-001`/`F-DB-002`.
- **severity:** **high** (keep as registered, `findings.md:2051`; and explicitly overrule
  `docs/execution/reports/p1/scan-db-3.md:16`'s Medium). Evidence for High: PostgreSQL
  superuser membership is not a degraded-privilege state — it is cluster administration, so
  an RCE or an SQL-execution flaw inside Knowledge reads and writes the separate `n8n`
  database and every role, which is exactly the exposure the dedicated `n8n LOGIN`
  (`bootstrap-postgres.sh:30-38`) and `OWNER n8n` database (`:40-42`) were built to prevent
  (`compose.core.yml:65-72`), and the Knowledge runtime pool is *routine* traffic
  (`database.py:451-463`) *and* DDL (`:2757-2768,2790-2819`), not an admin-only path. I
  declined `root-cause`: `F-DB-001`, `F-DB-002`, `F-KB-002` and `F-431` are not symptoms of
  the identity choice.
- **root_cause_of:** none.
- **depends_on:** none inside this bucket. Cross-owner coupling the lead must serialize:
  the role change and the `vector` extension/`knowledge` schema ownership have to be
  provisioned before the Knowledge pool can boot as a scoped role, and today the only
  provisioner is `bootstrap-postgres.sh`, which `start.ps1:85-89` runs **only** for
  `-Profile automation|all`. Measured: `start.ps1:3-4` accepts `knowledge`, and the bootstrap
  guard is `$Profile -in @("automation", "all")` — a fresh Knowledge-only profile has no
  role/extension provisioner at all (`docs/execution/reports/p2/xcheck-infra-kb.md:47` states
  the same, independently).
- **Counter-evidence sought, and what actually survived:**
  - *Searched for a scoped credential or grant.* `grep -n "GRANT |REVOKE |CREATE ROLE|
    CREATE USER|rolsuper" infrastructure/` returns **one** hit,
    `bootstrap-postgres.sh:31 CREATE ROLE n8n LOGIN`. There is no `knowledge` role, no
    `skills` role, no grant and no revocation anywhere in the shipped definitions. So "no
    role grants enforce that separation" (`findings.md:2053`) is confirmed by absence, which
    is the strongest form this lane can produce.
  - *Line-number drift, attributed (this is the dirty-tree trap in this row).*
    `apps/knowledge/app/database.py` is `M` in the baseline and the register's locators are
    **working-tree** numbers. The pre-existing diff inserts 13 lines before `start()`
    (`@@ -12,6 +12,7 @@` +1 `import unicodedata`; `@@ -28,6 +29,18 @@` +12
    `normalize_source_path`), so `:453-459` is HEAD `:440-446`; cumulative insertions before
    the migration runner are 28, so `:2757-2768` / `:2790-2819` are HEAD `:2729-2740` /
    `:2762-2791`. Every hunk is NFC source-path work attributable to the pre-existing F-576
    change set (it also `M`s `index_lifecycle.py`, `conftest.py`, `tests/` and
    `?? apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py`), and **none** touches
    the credential or DDL sites, so the premise is identical at HEAD and at the dispatch
    tree. This must be recorded because §0.2 rule 1 re-verification will be run against a
    different tree by the fixer.
  - *`zink-skill-store/src/vector-sync.mjs`* does not appear in `git status --short`: HEAD
    and working tree are the same, and `:307-335` is exactly
    `docker exec -i <container> psql -U postgres -d postgres` with no password argument,
    the SQL written to stdin at `:407-408`. `zink-skill-store/src/migrations.mjs` is `M`, but
    only at `@@ -243,10 +243,25 @@` (the F-431 DDL/ledger-atomicity hunk), so the cited
    `:75-92` (`SKILL_STORE_LEDGER = "skills.schema_migrations"`, `CREATE SCHEMA IF NOT EXISTS
    skills`) is unshifted. `zink-tools/adapters/skill-store/skill-adapter.mjs` is `M` (129
    added lines); the cited import block `:13-20` (`executePostgresQuery` imported directly
    from `../../../zink-skill-store/src/vector-sync.mjs`) and the `SELECT` builder at
    `:779-806` were re-read in the working tree and exist as described. The infrastructure
    locators (`compose.core.yml`, `bootstrap-postgres.sh`, `start.ps1`,
    `knowledge-t5-live.ps1`) do not appear in `git status --short` at all.
- **Qualification I would impose on the row (the widening is right, the single-mechanism
  framing is not).** The two client sites cross the boundary by *different* mechanisms:
  Knowledge holds a **superuser password on a `scram`-authenticated TCP path**
  (`KNOWLEDGE_DATABASE_HOST: postgres`, `compose.core.yml:149-153`), whereas Skill Store and
  the Tools adapter reach the database by **`docker exec` into the DB container with no
  credential at all** (`vector-sync.mjs:321-335`, default container name
  `:312-315`). Consequence for the fix, stated as a blocker (§3): creating scoped roles and
  switching to `psql -U <scoped>` constrains what the Skill Store session may do, but does
  **not** re-establish its boundary, because local-socket authentication inside that
  container authenticates whatever `-U` the caller names without a password — the effective
  control there is who may `docker exec` the `postgres` container, not the role. A fixer who
  reads the row as "one privilege boundary, two callers, one role patch" will produce a
  test that passes on the Knowledge half and certifies the Skill Store half by name only.
  This does not refute the row (both clients demonstrably operate as cluster administrator,
  which is the finding), and it is not a new finding to file from this lane; it is an
  acceptance-criteria correction.
- **Not a duplicate:** register grep for `privileg|superuser|rolsuper|GRANT|pg_read|
  cluster administrator|KNOWLEDGE_DATABASE_USER` matches only F-INFRA-002's own lines
  (`:2053,2057`) plus the unrelated F-INFRA-003 hardening row; `CHANGELOG.md` grep for
  `superuser|rolsuper|KNOWLEDGE_DATABASE_USER|least.privilege|psql -U postgres` returns zero.
  `F-431` is DDL/ledger atomicity, `F-435` is Tools importing Skill Store internals
  (`findings.md:941-952`) — both already named as distinct by
  `docs/execution/reports/p2/xcheck-skill-tools.md:40-47`. The `scan-db-3:16` Medium and
  `scan-infra-2:16` High conflict is real, and `xcheck-infra-kb.md:15,45` is correct that
  the register's High should stand.
- **red:** **YES.** `AGENTS.md` §7 several ways at once: **security boundary** (role grants /
  least privilege), **schema/migration semantics and persistence semantics** (routine DDL,
  `CREATE SCHEMA`, `CREATE EXTENSION vector` at `apps/knowledge/migrations/001_initial.sql:1`,
  and the `skills.*` ledger all move from superuser to capability-scoped authority),
  **topology** (`docker exec`-as-`postgres` is a host-privilege path), **dependencies** (the
  role provisioning owner is undecided, §3), and **required gate** — the fix necessarily
  edits `tests/m3-t1-contract.test.mjs:98`, which currently asserts
  `KNOWLEDGE_DATABASE_USER === "postgres"` as the expected deployed contract, plus
  `compose.core.yml:149-153` credential delivery and `bootstrap-postgres.sh`. No agent may
  do that silently (§10, §12); owner decision required.
- **fixer:** `fix-infrastructure` owns the credential/role/grant and provisioning surface;
  the callers are cross-owner and must be sequenced, not parallel-written. Files:
  `infrastructure/docker/compose/compose.core.yml` (`:13-16`, `:149-153`, n8n block `:65-72`
  to be preserved), `infrastructure/docker/scripts/bootstrap-postgres.sh`,
  `infrastructure/docker/scripts/start.ps1` (`:83-91` bootstrap gating) and
  `infrastructure/docker/scripts/preflight.ps1` / `credential-sentinels.ps1:39-54` (a new
  role password variable), plus — routed to other owners and therefore wave-splitting —
  `apps/knowledge/app/database.py:440-450,2729-2791` and
  `apps/knowledge/app/config.py:36-45` (`fix-knowledgebase`),
  `zink-skill-store/src/vector-sync.mjs:307-335` and `migrations.mjs`
  (`fix-skill-store`), `zink-tools/adapters/skill-store/skill-adapter.mjs:13-20`
  (`fix-tools`, same site as `F-435`), `tests/m3-t1-contract.test.mjs:91-100`
  (`fix-tests`), `tests/m11-t1-postgres-sql-gate.test.mjs:136-183` and
  `tests/agent-skill-F-431.test.mjs:106-130` (both hardcode `psql -U postgres`, and they skip
  without Docker — `m11-t1-postgres-sql-gate.test.mjs:2,16,141-183`).

## 3. Gate/test consequence for both rows (measured)

- No shipped test asserts either boundary. The tests that *look* like coverage pin the
  vulnerable state: `tests/m3-t1-contract.test.mjs:81-85` requires Knowledge to join
  `platform` **and** to receive `host.docker.internal:host-gateway`; `:91-99` requires
  `KNOWLEDGE_DATABASE_USER == "postgres"` and the shared `POSTGRES_PASSWORD` interpolation;
  `tests/agent-owner-F-288.test.mjs:185-211` requires only that the live driver *calls*
  `Assert-T5ModelEgressAllowlist` and orders it after `up knowledge`;
  `tests/m3-t5-contract.test.mjs:141-160` pins the strings `Assert-T5RuntimeIsolation` and
  `internal: true` in the **acceptance** file. So both fixes are "edit a green assertion that
  enshrines the defect" — the same failure shape the register already documents at `F-119`
  (`findings.md:239-250`), and it is why both rows are `red: YES` on the gate clause, not only
  on the security clause.
- `docs/development/conventions.md:66-105` is the gate registry: `verify`
  (`format:check → lint → test → repo:check`) and CI `python-quality` are the affected lanes;
  the PostgreSQL lanes skip without Docker and a skipped lane is `NOT RUN`
  (`tests/m11-t1-postgres-sql-gate.test.mjs:2,141-183`). Neither row can reach
  `findings.md` §0.2 rule 6 closure on this host alone: a WSL/Docker lane is mandatory.
- `docs/execution/context.md:8` records that `xcheck-tests-all` failed to start on its first
  dispatch and was re-launched; the lane did deliver both candidate sections
  (`xcheck-tests-all.md:20-46`), so I treated it as live evidence. Its two status lines
  ("Coverage gap; candidate remains pending triage") match my verdicts.

## 4. Blockers

1. **BLK-01-1 (F-INFRA-001):** no deployed-shape egress measurement exists and this lane is
   read-only. Missing fact: whether the deployed Knowledge container can open a direct socket
   to `1.1.1.1:443`, `8.8.8.8:53` and `host.docker.internal:11434`. Until one of the three is
   measured the row is CONFIRMED-AS-LATENT, not exploitable-proven. Needed action: a
   disposable deployed-composition probe reusing the two existing probe bodies verbatim
   (`knowledge-t5-common.ps1:603,605`). Owner: lead, with `fix-infrastructure` as author of
   the probe. Not required for my verdict; required for `findings.md:2043` acceptance.
2. **BLK-01-2 (F-INFRA-002, auth mechanism split):** the `docker exec` + passwordless local
   `psql -U postgres` path in `vector-sync.mjs:321-335` means the Skill Store/Tools half is
   gated by *container-exec authority*, not by role grants. Missing fact: the container's
   effective `pg_hba` authentication rules (the image's `pg_hba.conf` is not in this
   repository, and I ran no container inspection). Without it the fixer cannot decide whether
   a scoped role alone satisfies the widened acceptance criterion. Do not let
   `xcheck-db-all.md:21` and `xcheck-infra-skill-tools.md:18` stand as written: both state the
   fix as "constrain each module client's identity", which under-certifies this site.
3. **BLK-01-3 (F-INFRA-002, provisioning owner):** for `-Profile knowledge` the shipped
   start path never runs `bootstrap-postgres.sh` (`start.ps1:85-89` vs `:3-4`), so after
   privilege reduction there is no in-repo provisioner for `CREATE EXTENSION vector`
   (`bootstrap-postgres.sh:26`, `migrations/001_initial.sql:1`) or for a `knowledge` role.
   Missing fact: whether the live host's database volume was ever bootstrapped under the
   `all`/`automation` profile, and where extension provisioning is meant to live. This is a
   RED design decision (ownership of provisioning between Infrastructure and Knowledgebase),
   not a fixer detail — recommend the lead put it to the owner with `F-DB-001`/`F-DB-002`
   kept out of the same decision.

## 5. Last meaningful checkpoint

Both rows re-verified locator-by-locator against the dispatch working tree at
`85eb094`; F-INFRA-001 CONFIRMED-AS-LATENT / medium / red; F-INFRA-002 CONFIRMED / high /
red, with the live role probe declared unnecessary for confirmation and necessary for
closure. No register, context or source edit made. No credential value read or printed:
`infrastructure/docker/env/.env` was seen by filename only (`glob`) and never opened; only
the variable *names* from `credential-sentinels.ps1:39-54` are cited.
