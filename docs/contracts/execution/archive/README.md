# Archived execution contracts

This directory holds the **complete text of closed execution contracts**. It exists
because the protocol used to destroy its own evidence: `docs/contracts/execution/README.md`
prescribed `delete ACTIVE.md` at closeout, while `AGENTS.md` §11 forbids claiming
completion without checkable evidence. Archiving formalises the precedent already set by
`docs/contracts/m7-m8-red-team-backlog.md`.

Owner authorization: 2026-10-15, decision `H10` / proposal `R3-P04-03` (recorded `RED:
Yes` — it rewrites a documented governance invariant — and granted explicitly).

## What goes here

One file per closed contract revision, named:

```text
YYYY-MM-DD-<milestone>-<task>-R<revision>.md
```

Example: `2026-10-15-M12-T2.1-R3.md`.

The date is the closeout date, not the approval date. The text is the contract **as it
stood when the task closed**, not edited afterwards. Retention is permanent: these are
small text files, and deleting one reopens the exact failure this directory was created
to end.

## Secret-scrub rule — runs BEFORE the file is staged

`AGENTS.md` §10 forbids committing live identifiers, credentials, private user data,
Vault content, backups, or ignored secret values. An archived contract names tasks,
paths, digests, and sometimes operator commands, so every archived file passes this
check first. If any step fails, **do not archive**: leave the contract in place, record
the blockage, and treat the archive as `NOT RUN`.

1. **Pattern sweep.** Scan the outgoing text for credential-shaped material:

   ```text
   (?i)(api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*\S
   [A-Za-z0-9+/]{32,}={0,2}
   ```

   A hit is cleared only when it is a **field name**, an **environment variable name**,
   or a **digest** already published in tracked source or CI output. A value is never a
   legitimate hit.

2. **Operator-owned sources are off-limits.** No value may be copied from
   `~/.openclaw-zink/router.env`, `operator/m7-t2/discord-identifiers.json`, any file
   under the OpenClaw state root, the source Obsidian Vault, backups, or raw logs.
   Referring to such a path is fine; reproducing its content is not.
3. **Identifiers.** A Discord snowflake may appear only if it already exists in tracked
   source (`integrations/openclaw/lib/authority.mjs`) or in already-tracked history.
   Anything not already tracked is replaced by a role name.
4. **No live state captures.** No ledger event rows, no config file bodies, no
   environment dumps, no raw log excerpts. **Naming** an absolute live path is allowed —
   21 already-tracked files do it, and a contract that cannot say which path it must not
   touch is not reviewable — but a path may only appear as the documented target, never
   as captured content from that path.
5. **One human pass.** A reader confirms the above before the commit. The commit message
   states that the scrub ran and what it removed, or states that nothing was removed.

## How closeout uses this directory

```text
review PASS
→ copy ACTIVE.md here under the dated name, run the scrub rule
→ local implementation commit (already made)
→ update PLAN.md (task closed, evidence level, pointer NONE)
→ delete ACTIVE.md
→ local closeout commit
→ push the task branch when AGENTS.md §12 authorizes it
```

`PLAN.md` cites the archived file by name for any claim that would otherwise rest on a
deleted contract.

## How a citation inside an archived contract resolves

Two citations appear in the archived contracts and must not be read as live pointers.

- **The defect register.** The archived contracts name the register's former path
  `.agents/states/findings.md`, because they were written before the register moved. The
  owner moved it on **2026-10-17** ("chuyển sang docs/execution đi"); the live register is
  `docs/execution/findings.md`, which is Git-tracked. A citation of the former path in an
  archived contract is a historical pointer to that move.
- **A re-application order.** The archived contracts that order a re-application from a
  `.agents/states/*-pending-admission.md` file are frozen history: those diffs were
  written for a tree that no longer exists. The live rule is in
  `.agents/states/README.md` — a pending-admission file must not be offered to an
  executor unless a recorded check proves its diff is still absent from the tracked
  tree, and a diff that is already applied is annotated `ALREADY LANDED via <commit>`.
