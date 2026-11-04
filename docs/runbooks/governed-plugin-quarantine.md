# The governed plugin quarantine

This runbook names the quarantine convention the governed plugin deployment
uses, and the convention the live host already uses. It is the tracked owner
of both: before it existed, the displaced trees on the live host carried a
naming convention that no tracked file accounted for, so nobody could say
whether a directory beside the governed plugin was a backup, a rollback
artefact, or a second copy the loader might execute.

## The rule

The plugin loader scans the **extensions root** - `<stateDir>/extensions/` -
and registers every directory there that carries an `openclaw.plugin.json`. A
directory that keeps the governed plugin id is therefore a **second candidate
for the same plugin**, and which copy executes is decided by origin
precedence rather than by the deployment record.

A **displaced tree** is a directory under the extensions root that:

- is not the governed plugin directory itself, and
- carries an `openclaw.plugin.json` whose `id` is the governed plugin id.

A displaced tree is not allowed to stay under the extensions root. The deploy
and the rollback ceremonies move it out of every scanned directory, as one
transaction: every destination is checked before any tree is moved, and every
move is a single `rename`, so the ceremony either leaves the scanned
directory free of displaced trees or changes nothing at all.

The gate that keeps this true is in
`integrations/openclaw/topology/lib/runtime-backup.mjs`
(`findDisplacedPluginTrees`, `quarantineDisplacedPluginTrees`), and the
assertion that exactly one manifest per plugin id exists under the extensions
root is in `tests/agent-final-F-370.test.mjs`.

## Where a displaced tree goes

The repository's own quarantine destination is the backup root's
`quarantined-t2` directory:

```text
<stateDir>/operator/m7-t2/backups/r12/quarantined-t2/extensions/<tree name>
```

That path is outside the extensions root, so a tree moved there is no longer a
candidate for the loader. The rollback ceremony has always quarantined the
governed plugin tree itself there; the deploy ceremony uses the same
destination for the trees it displaces.

## The convention the live host actually uses

Measured read-only on the live WSL host on **2026-10-21**, the extensions root
`/home/hoang_vinh/.openclaw-zink/extensions` (mode `700`) held exactly three
directories, all mode `700`, and **all three** declared
`"id": "zink-governance"` in their `openclaw.plugin.json`:

| Directory                           | Role              | `index.mjs` bytes | mtime      |
| ----------------------------------- | ----------------- | ----------------- | ---------- |
| `zink-governance/`                  | the active plugin | 335 797           | 2026-09-28 |
| `zink-governance-pre-mig-20260928/` | displaced         | 147 911           | 2026-09-28 |
| `zink-governance-pre-r4-20260928/`  | displaced         | 139 374           | 2026-09-13 |

The convention is therefore:

```text
<plugin id>-<reason>-<YYYYMMDD>
```

- the plugin id is **kept**, so the directory stays recognisable as the plugin
  it was - which is exactly why it is a displaced tree and must be moved;
- `<reason>` names why the tree was displaced (`pre-mig` for the pre-migration
  tree, `pre-r4` for the pre-R4 tree);
- `<YYYYMMDD>` is the date the tree was displaced.

This convention appears in **no** tracked file, which is why this runbook
exists. It is also not sufficient on its own: a directory named this way
still carries the governed manifest id, so it still registers as a second
candidate for the loader. The ceremony moves it to the quarantine destination
above; the name is what tells an operator which tree it was and why.

## What an operator may do

- Read anything under the extensions root and under the quarantine
  destination.
- Move a displaced tree to the quarantine destination by hand, following the
  ceremony's rule: check every destination first, then rename.
- Nothing else. Deleting a displaced tree, or renaming its manifest id in
  place, is an owner-authorized action: the tree is the only copy of that
  build.

## Related

- `docs/runbooks/backups-and-recovery-archives.md` - the owner of the
  repository's `backups/` directory and of the retention rules for recovery
  artefacts.
- `integrations/openclaw/topology/lib/runtime-backup.mjs` - the deploy and
  rollback ceremonies.
