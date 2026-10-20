# Backups, register snapshots and recovery archives

This runbook is the tracked owner of the repository's `backups/` directory.
It answers the three questions the directory could not answer before: who
owns it, what it is for, and when an entry may be deleted.

## Owner

The repository maintainer owns `backups/`, under the audit protocol that
requires a copy of the findings register before every write to it. The
protocol is recorded in the findings register itself
(`docs/execution/findings.md` section 0).

No other component owns the directory. A runbook that cites `backups/` for
anything else is citing a directory with no owner.

## Purpose

`backups/` holds two kinds of artifact, and only two:

1. **Register snapshots** - the copy of `docs/execution/findings.md` taken
   before a write to the register, named `findings.<reason>-<timestamp>.md`.
   They exist so a write that damages the register can be compared against
   the state before it.
2. **Recovery archives** - the PostgreSQL dumps of the `knowledge` schema
   that the T5 live driver writes. The driver owns the archive name
   (`knowledge.dump`) and writes the run's manifest beside it
   (`knowledge.manifest.json`); its default backup root is
   `%LOCALAPPDATA%\ZinkKnowledge\recovery\m4\<runId>\`, and the archives
   under `backups/knowledge-t5/<runId>/` are the runs whose backup root
   pointed into this repository.

Everything under `backups/` is Git-ignored, including nested directories of
the same name: the ignore rules are `/backups/*` and `**/backups/*`, and
the repository policy check fails when a generated tree named `backups`,
`logs` or `temp` is not ignored, so a capture under a module path cannot
be staged by accident.

## Retention

- A register snapshot is kept until the commit that supersedes it answers the
  question the snapshot was taken for. A snapshot older than 90 days may be
  deleted only under an owner-authorized cleanup.
- A recovery archive is kept until the owner authorizes its deletion. The
  driver refuses to write a zero-length archive, and an archive is never a
  restore source on its own: a restore needs a fresh, verified recovery
  point.

Neither kind of artifact may be deleted by an agent. Deletion is an
owner-authorized action.

## The recovery archives that are already here

Three archives sit under `backups/knowledge-t5/`. They predate the driver
owning the name, so no tracked file produced them; the tracked ledger
`docs/runbooks/recovery-archive-ledger.json` records each one with its
digest, its producer and its retention, and the repository policy check fails
when an archive under `backups/` is not in that ledger or no longer matches
its recorded digest.

| Run id                             | Bytes   | sha256                                                             | State                       |
| ---------------------------------- | ------- | ------------------------------------------------------------------ | --------------------------- |
| `4d26bc4f820d427b85339aee2286c9b2` | 319 932 | `eb1488035dcfdf8db24b2927a331bbf8f57be1f439e4555b0ef79ddd460d0857` | legacy, no tracked producer |
| `a02b3919a8aa43de9ebc7c21cb5d285b` | 319 932 | `aeaeedfb8b6498ec1e9dc616c3c098c9ecc3b2ec83b8c1d34aaa3770d2ca0f74` | legacy, no tracked producer |
| `fe69e04156204b739933733b3e703adc` | 0       | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | rejected, zero length       |

The third one is zero length. The driver refuses to write a zero-length
recovery archive, so this file restores nothing and is not a recovery
archive; it is recorded as a rejected artifact instead. Removing it is a
destructive action on the owner's operational data and needs the owner's
authorization:

```powershell
Remove-Item -LiteralPath "backups\knowledge-t5\fe69e04156204b739933733b3e703adc\knowledge.dump" -Force
```

The fourth run directory, `0a4003be37b34fa589b36e67e298f537`, holds no
archive at all; the ledger records it as a run that produced none.

## The canonical copy

A snapshot under `backups/` is **never the canonical record**. The
canonical copy of the findings register is the tracked file
`docs/execution/findings.md`; when a snapshot and the tracked register
disagree, the tracked register wins, and the snapshot is evidence of an
earlier state, not a competing authority.

The same rule holds for the recovery archives: the tracked ledger
`docs/runbooks/recovery-archive-ledger.json` records every archive with its
digest, its producer and its retention, and that ledger - not the archive
directory - is the answer to "which recovery archives exist".

## The pre-tracking window of the register

The register became a tracked file only at commit `3325e5e`
(2026-10-17T22:57:27Z). Before that commit it was untracked, so the
revisions between the first snapshot and that commit exist only in the
snapshots under `backups/`. The register's own rule is that an `F-xxx`
number is permanent and a row leaves the queue only when it is closed with
its acceptance met, so the identities that existed only in that window have
to be answerable from the repository.

The 13 snapshots taken before the tracking
commit are:

- `findings.pre-reclass-20261017-164726.md` (2026-10-17T09:47:26.212Z)
- `findings.post-move-pre-format-20261017-175251.md` (2026-10-17T10:49:45.506Z)
- `findings.pre-R7-audit-20261017-180715.md` (2026-10-17T11:07:15.107Z)
- `findings.pre-b2-wave1-20261017-194323.md` (2026-10-17T11:12:54.674Z)
- `findings.pre-R7-append2-20261017-200705.md` (2026-10-17T13:07:05.621Z)
- `findings.wave1-done-20261017-222357.md` (2026-10-17T14:43:03.964Z)
- `findings.pre-b2-x1-20261018-045721.md` (2026-10-17T21:40:39.615Z)
- `findings.pre-b2-x2-20261018-050551.md` (2026-10-17T21:57:22.388Z)
- `findings.pre-b2-x14-20261018-050808.md` (2026-10-17T22:05:52.226Z)
- `findings.pre-R7b-20261018-050849.md` (2026-10-17T22:08:49.345Z)
- `findings.collision-check-20261018-051108.md` (2026-10-17T22:09:22.438Z)
- `findings.pre-d9-corrections-20261018-054733.md` (2026-10-17T22:47:33.788Z)
- `findings.pre-d9-run-20261018-055123.md` (2026-10-17T22:51:23.962Z)

Their union carries 75 identities that no longer appear
anywhere in the tracked register. Those are the rows that were deleted or
merged in the pre-tracking window; the register's section 2 records the same
list, and the numbers are never reused:

- `R1-A16-05`
- `R2-B02-02`
- `R2-B07-03`
- `R3-P01-01`
- `R3-P01-02`
- `R3-P01-03`
- `R3-P01-04`
- `R3-P01-05`
- `R3-P01-06`
- `R3-P01-07`
- `R3-P01-08`
- `R3-P02-01`
- `R3-P02-02`
- `R3-P02-03`
- `R3-P02-04`
- `R3-P02-05`
- `R3-P02-06`
- `R3-P02-07`
- `R3-P02-08`
- `R3-P02-09`
- `R3-P03-01`
- `R3-P03-02`
- `R3-P03-03`
- `R3-P03-04`
- `R3-P03-05`
- `R3-P03-06`
- `R3-P03-07`
- `R3-P03-08`
- `R3-P04-01`
- `R3-P04-02`
- `R3-P04-04`
- `R3-P04-05`
- `R3-P04-06`
- `R3-P04-07`
- `R3-P04-09`
- `R3-P05-01`
- `R3-P05-02`
- `R3-P05-03`
- `R3-P05-04`
- `R3-P05-05`
- `R3-P05-06`
- `R3-P05-07`
- `R3-P05-08`
- `R3-P06-01`
- `R3-P06-02`
- `R3-P06-03`
- `R3-P06-04`
- `R3-P06-05`
- `R3-P06-06`
- `R3-P06-07`
- `R3-P06-08`
- `R3-P06-09`
- `R6-A01-01`
- `R6-A02-01`
- `R6-CFG-02`
- `R6-CFG-04`
- `R6-HUNT-02`
- `R6-V03-03`
- `R6-V04-01`
- `R6-V04-02`
- `R6-V04-03`
- `R6-V05-02`
- `R6-V05-03`
- `R6-V08-01`
- `R6-V09-01`
- `R6-V09-02`
- `R6-V09-03`
- `R6-V12-01`
- `R6-V12-02`
- `R7-D1-01`
- `R7-D1-02`
- `R7-D1-03`
- `R7-D10A-04`
- `R7-D12A-02`
- `R7-D8-05`

With this list, the question "which rows were deleted before the register
was tracked" is answerable from the repository alone, and the snapshots are
retained under the retention rule above rather than being the only copy.

## What an agent may do with this directory

- Read anything under `backups/`.
- Write a register snapshot under `backups/` before a write to the register,
  following the audit protocol.
- Nothing else. No deletion, no move, no rename of an archive.
