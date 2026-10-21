# Runbook — deploying the M12/T9 build: what the operator does

This is the operator-facing note for the M12/T9 band. It says what a person
has to do on the machine, and — just as important — what they do NOT have to do.

## Nothing to do: the ledger's derived snapshot

The M12/T9 band changed how the governance ledger re-derives a task's state
(F-160) and what a task carries (F-060). A snapshot written by an older build
therefore no longer agrees with its own journal, and the ledger would refuse to
read.

The deploy ceremony now **recomputes the derived snapshot from the journal**
before the apply, and it says so in its own output:

```text
[zink-operator] the derived ledger snapshot was recomputed from the journal: sequence=… tasks=…
```

The **journal is never written** — it is the record. Only the derived cache is
recomputed, and only when the two disagree. A journal that does not verify is
refused and nothing is written.

**So: run the deploy as usual. There is no manual step.**

## One thing to do: the stale backup file with loose permissions

The state root holds credential-bearing files, and the policy is that only the
owner may read them. One file does not satisfy that today:

```text
~/.openclaw-zink/openclaw.json.bak-mobile-1789615159090
```

It is a stale **backup copy** of `openclaw.json` (note the `.bak-mobile-` name).
The live config is `~/.openclaw-zink/openclaw.json` — that file is not the one
in question, and it must not be touched.

Check it:

```bash
ls -l ~/.openclaw-zink/openclaw.json.bak-mobile-*
```

If the permissions read `-rw-r--r--` (or anything else that lets another
account read it), fix it. Either one:

```bash
# option A — keep the backup, make it owner-only (recommended)
chmod 600 ~/.openclaw-zink/openclaw.json.bak-mobile-1789615159090

# option B — drop the stale copy
rm ~/.openclaw-zink/openclaw.json.bak-mobile-1789615159090
```

Verify:

```bash
ls -l ~/.openclaw-zink/openclaw.json.bak-mobile-*
# -rw------- 1 <owner> <group> …   (option A)
# ls: cannot access '…': No such file or directory   (option B)
```

Until this is done, `--preflight` and `--apply` **refuse** on purpose. That is
the new check working, not a fault: the check is `F-035`, and it enumerates the
state root instead of looking at named paths.

## Nothing to do: the deployment's admission list

The packaged extension's bytes moved with this band (the packaged set grew from
34 to 45 assets), and the admission list in
`integrations/openclaw/configure.mjs` has to name the bytes that are **on the
host** so the preflight can accept them.

That list is already rolled: every asset of the deployed build is named, so
`--preflight` accepts the extension that is installed today. Nothing to do.

After the deploy, the extension on the host carries the NEW build's bytes, and
the NEXT deploy will need the new digests admitted. That roll is part of the
band that changes the packaged set, not an operator step.

## The order to do it in

1. `chmod 600` (or delete) the stale backup copy — the one manual step.
2. Run the normal deploy. The ceremony recomputes the derived ledger snapshot
   and prints a line when it does.
3. Watch the ceremony's output for the recompute line. If it is absent, the
   ledger already agreed with its journal and nothing was rewritten.

## If the deploy refuses

| The refusal says             | What it means                                                             | What to do                                                                 |
| ---------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `STATE_ROOT_FILE_MODE_DRIFT` | a file in the state root is readable by another account                   | fix the permissions it names, then re-run                                  |
| `snapshot workflow mismatch` | the derived snapshot still disagrees with the journal after the recompute | the journal itself changed shape: report it, do not hand-edit the snapshot |
| `Ledger state incomplete`    | half of the ledger pair is missing                                        | an operator action on the host: report it                                  |
