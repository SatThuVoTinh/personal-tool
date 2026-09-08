# OpenClaw T2 Trusted Governance Runtime

This directory provisions the owner-approved M7/T2-R11 OpenClaw profile. It is
intentionally a private seven-bot Discord conversation foundation with the
frozen five-stack topology, not the Zink Tools bridge. The model agents remain
bounded; trusted builder/operator and the model-invisible `zink-governance`
plugin enforce topology, ledger, lineage, budgets and result acceptance.

## Safety boundary

The generated `main`, `o1`, `o2`, `excel`, `power-bi`, `sql`, and `python`
agents use the exact pinned effective-tool matrix: coordinators receive only
their required status/spawn/yield surface and specialists receive native
`session_status`. The harmless specialist re-allow avoids the exact-version
empty-tool model failure observed on OpenClaw `2026.6.34`. Model policy still limits
session overrides to the two approved Google aliases. Every agent
uses a separate non-repository workspace and agent state directory plus a Docker
sandbox with no network, read-only root, all capabilities dropped and no binds.
This does not put the Gateway, channel plugin or internal routing inside the
sandbox; gateway loopback/auth, plugin inventory and Discord access gates remain
separate controls.

Plugin discovery is fail-closed with `plugins.bundledDiscovery="allowlist"` and
`plugins.allow=["google","discord","zink-governance"]`. Google remains the
only model provider plugin and Discord is the only channel plugin; the local
governance plugin is model-invisible, has no network capability and is not a
Zink Tools adapter. Browser, OpenAI, ACP and all other bundled or external
plugins are ineligible to load. The implicit memory slot is explicitly disabled.

The operator ledger lives outside every model workspace at
`~/.openclaw-zink/operator/m7-t2/ledger/` and uses append-only JSONL plus an
atomic snapshot. Corruption fails closed as `EXECUTION_STATE_UNKNOWN`; native
OpenClaw sessions are reconciliation evidence, not governance authority.

Each agent has one Discord account with the same account ID as the agent ID.
All seven accounts are available in the owner-only text channel `#office` and
the forum parents `#results`, `#approvals`, and `#incidents`. An account accepts
only an owner message that explicitly mentions its bot or directly replies to a
message authored by that same bot. Bot-authored messages are ignored. The exact
native delegation graph is enabled only through explicit target allowlists;
Discord is never the internal bot message bus.

Global Discord streaming is pinned to `mode="off"` for all seven accounts, with
no account override. OpenClaw therefore keeps typing/model progress internal and
posts only the final terminally validated reply. Do not enable `progress`,
`partial`, or `block`: a provider stream can fail after partial tokens arrive.
R19 additionally classifies an incomplete terminal stream as a timeout-class
native recovery event and suppresses any retained errored assistant text,
reasoning, or final-answer evidence.

OpenClaw `2026.6.34` always requests Message Content Intent and treats a direct
reply to the bot as an implicit mention. Keep Message Content Intent enabled for
all seven applications. The builder does not persist the unsupported
`channels.discord.intents.messageContent` key. This release also has no Discord
join-introduction feature or `joinIntro` schema key, so the builder persists no
invented key and the runtime has no join/onboarding post behavior to enable.
Supplemental history, quote, and thread context is filtered to the owner
allowlist.

Only these moving Google aliases are permitted:

```text
google/gemini-flash-latest
google/gemini-flash-lite-latest
```

Fallback stays within Google. A failure of both aliases is closed; no OpenAI,
Codex or another provider is configured. The exact profiles
`google:zink-01` through `google:zink-21` each use one structured `exec`
SecretRef, never an inline value. The keys are partitioned without sharing:
three consecutive profiles per agent in roster order. The resolver can read
only those 21 Gemini entries, seven account-specific Discord entries and the
Gateway entry from the encrypted `pass` password store.

The builder persists `agents.defaults.thinkingDefault="low"`. For the approved
Flash aliases this avoids the unsupported Gemini `MINIMAL` request level and
keeps the provider payload deterministic at `LOW` unless a later approved task
changes the policy.

OpenClaw may add `meta.lastTouchedVersion` and `meta.lastTouchedAt` when its own
config CLI writes the file. Verification accepts only those two runtime-managed
fields, requires the pinned release version and rejects any broader metadata.

Each agent's three-profile pool permits at most two additional profile rotations
before advancing to the fallback model. Native cooldown and session pinning are
per agent; a key is never provisioned into a second agent's auth store.

## Prepare non-secret identifiers

In a systemd-capable WSL shell, set only local shell variables for the guild,
owner, one text channel, and three forum-parent identifiers. All four surface
IDs must be distinct numeric Discord IDs. Do not add tokens or API keys to shell
history, the repo, or the builder command line.

```bash
export ZINK_STATE_DIR="$HOME/.openclaw-zink"
export ZINK_DISCORD_GUILD_ID='replace-with-guild-id'
export ZINK_DISCORD_OWNER_ID='replace-with-owner-user-id'
export ZINK_DISCORD_OFFICE_CHANNEL_ID='replace-with-office-channel-id'
export ZINK_DISCORD_RESULTS_FORUM_ID='replace-with-results-forum-id'
export ZINK_DISCORD_APPROVALS_FORUM_ID='replace-with-approvals-forum-id'
export ZINK_DISCORD_INCIDENTS_FORUM_ID='replace-with-incidents-forum-id'
```

Run the repository builder from the repository root. `--dry-run` writes nothing.

```bash
node integrations/openclaw/configure.mjs --dry-run \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID" \
  --discord-office-channel-id "$ZINK_DISCORD_OFFICE_CHANNEL_ID" \
  --discord-results-forum-id "$ZINK_DISCORD_RESULTS_FORUM_ID" \
  --discord-approvals-forum-id "$ZINK_DISCORD_APPROVALS_FORUM_ID" \
  --discord-incidents-forum-id "$ZINK_DISCORD_INCIDENTS_FORUM_ID"

node integrations/openclaw/configure.mjs --apply \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID" \
  --discord-office-channel-id "$ZINK_DISCORD_OFFICE_CHANNEL_ID" \
  --discord-results-forum-id "$ZINK_DISCORD_RESULTS_FORUM_ID" \
  --discord-approvals-forum-id "$ZINK_DISCORD_APPROVALS_FORUM_ID" \
  --discord-incidents-forum-id "$ZINK_DISCORD_INCIDENTS_FORUM_ID"
```

The builder creates only regular owner-private state/config files, seven exact
empty workspace templates and agent directories, the allowlisted password-store
resolver, its empty private store directory, a systemd drop-in, and
`zink-auth-secret-plan.json` plus `zink-auth-order-plan.json`. It refuses
pre-existing workspace, config, resolver, account, binding or plan drift instead
of deleting it. R19 upgrades only the exact known R18 hotfix utility, preserves
the R16-to-current systemd drop-in migration and the exact R17 config migration
that added final-only Discord delivery. Any other pre-existing utility, drop-in,
channel, or streaming drift fails closed.

When applying a revision to an already-running profile, stop only the named
service before `configure.mjs --apply`, then start it after the apply. A dry run
is safe while the service is active. Do not hand-write `openclaw.json` while the
Gateway is running: its in-memory config writer can restore an older snapshot
over the new file.

```bash
systemctl --user stop openclaw-gateway-zink.service
# Run the exact configure.mjs --apply command above.
systemctl --user start openclaw-gateway-zink.service
```

If an earlier one-channel config was generated with a wrong ID, stop the named
service and move only `openclaw.json` to a private recovery directory before
applying R16. This preserves all encrypted entries and generated auth stores:

```bash
systemctl --user stop openclaw-gateway-zink.service 2>/dev/null || true
install -d -m 700 "$HOME/openclaw-zink-recovery"
mv --no-clobber "$ZINK_STATE_DIR/openclaw.json" \
  "$HOME/openclaw-zink-recovery/openclaw.json.pre-r16"
```

## Install and provision locally

Install OpenClaw through its official `extended-stable` path, then persist its
update channel with the generated config. Do not substitute `latest` if
`extended-stable` cannot be selected. Build the official
`openclaw-sandbox:bookworm-slim` image if the Docker preflight says it is absent.

Install the exact matching official Discord plugin and pin the resolved install
record. Never install its moving tag or run broad `doctor --fix` remediation:

```bash
openclaw plugins install --pin @openclaw/discord@2026.6.34
```

Install `pass`, create the dedicated two-year unattended service identity, then
initialize its private store. The empty passphrase is deliberate for unattended
systemd startup; filesystem ownership, the isolated GPG home, the 29-entry
resolver allowlist, and the minimal-tool agents remain the access boundary. Rotate
the identity before expiry. A process that compromises the Linux account can use
this key, so do not treat encryption at rest as account-level isolation.

```bash
install -d -m 700 \
  "$ZINK_STATE_DIR/secrets/gnupg" \
  "$ZINK_STATE_DIR/secrets/password-store"
export PASSWORD_STORE_DIR="$ZINK_STATE_DIR/secrets/password-store"
export GNUPGHOME="$ZINK_STATE_DIR/secrets/gnupg"
gpg --batch --pinentry-mode loopback --passphrase '' \
  --quick-generate-key 'Zink OpenClaw Service' default default 2y
pass init 'Zink OpenClaw Service'
```

Insert all 21 Gemini values, seven Discord bot tokens and the Gateway token
interactively. Secret values must be entered only at the `pass` prompts; never
put them in these commands or shell history.

```bash
for index in $(seq -w 1 21); do
  pass insert "zink/openclaw/GEMINI_API_KEY_${index}"
done
for agent in main o1 o2 excel power-bi sql python; do
  entry="${agent^^}"
  entry="${entry//-/_}"
  pass insert "zink/openclaw/DISCORD_BOT_TOKEN_${entry}"
done
pass insert zink/openclaw/ZINK_OPENCLAW_GATEWAY_TOKEN
```

The setup must pass a non-interactive resolver probe under the same
`GNUPGHOME`/`PASSWORD_STORE_DIR` used by the named systemd user service. Missing,
unreadable, or expired credentials fail closed; do not weaken GPG or store
permissions as a workaround.

Then let OpenClaw, not this repository, write exactly three agent-local auth
records per agent from the generated 21-target ref-only plan:

```bash
export OPENCLAW_PROFILE=zink
export OPENCLAW_STATE_DIR="$ZINK_STATE_DIR"
openclaw secrets apply \
  --from "$ZINK_STATE_DIR/zink-auth-secret-plan.json" \
  --dry-run \
  --allow-exec
openclaw secrets apply \
  --from "$ZINK_STATE_DIR/zink-auth-secret-plan.json" \
  --allow-exec
```

OpenClaw natively reads the default agent's auth store through secondary-agent
runtime views. Lock each stored per-agent order to its own three profiles so
that inherited main profiles remain ineligible:

```bash
openclaw models auth order set --agent main --provider google \
  google:zink-01 google:zink-02 google:zink-03
openclaw models auth order set --agent o1 --provider google \
  google:zink-04 google:zink-05 google:zink-06
openclaw models auth order set --agent o2 --provider google \
  google:zink-07 google:zink-08 google:zink-09
openclaw models auth order set --agent excel --provider google \
  google:zink-10 google:zink-11 google:zink-12
openclaw models auth order set --agent power-bi --provider google \
  google:zink-13 google:zink-14 google:zink-15
openclaw models auth order set --agent sql --provider google \
  google:zink-16 google:zink-17 google:zink-18
openclaw models auth order set --agent python --provider google \
  google:zink-19 google:zink-20 google:zink-21
```

The generated order plan is the comparison source for verification. A missing,
extra or reordered profile is a failure; never clear these overrides while the
R19 partition is active.

## Apply the Gemini stream hotfix

OpenClaw `2026.6.34` can accept an incomplete Gemini SSE response as a normal
`stop`, and its older payload layer can surface retained partial text beside an
error. R17 introduced the official fail-closed transport checks; R18 disabled
Discord previews. R19 backports upstream timeout classification plus errored
payload/final-evidence suppression. Apply and verify the patch before restarting
the service:

```bash
"$HOME/.local/bin/node" \
  "$ZINK_STATE_DIR/bin/openclaw-gemini-stream-hotfix.mjs" --apply
"$HOME/.local/bin/node" \
  "$ZINK_STATE_DIR/bin/openclaw-gemini-stream-hotfix.mjs" --check
```

The utility accepts only OpenClaw `2026.6.34` and exact known original, R18
predecessor, or fully patched SHA-256 state across four frozen bundle artifacts.
It validates every artifact before writing, rolls back completed writes if a
later write fails, rejects any other partial state, and makes repeated
apply/check calls safe. The generated service drop-in runs `--check` in
`ExecStartPre`, so a package update or restored vendor file cannot silently
start without review.

For an owner-approved rollback, stop the named service first, run `--revert`,
and restore the exact pre-hotfix drop-in from the matching repository revision before
starting the service. The R17 drop-in intentionally refuses to start against an
unpatched artifact. Do not remove the preflight alone or resume on another
OpenClaw release.

Install the named service using the same profile/state environment and reload
the drop-in:

```bash
openclaw gateway install
systemctl --user daemon-reload
systemctl --user enable --now openclaw-gateway-zink.service
```

Ensure linger is enabled before expecting the user service to survive logout. If
the command needs privilege, obtain owner approval first:

```bash
sudo loginctl enable-linger "$(whoami)"
```

No Windows Scheduled Task is created. Linger does not start a stopped WSL distro
after Windows boot.

## Verify

Static verification reads no secrets. Live verification runs the OpenClaw CLI
checks and can only pass after valid secrets, Discord setup, service startup and
the official sandbox image are present.

```bash
node integrations/openclaw/verify.mjs \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID" \
  --discord-office-channel-id "$ZINK_DISCORD_OFFICE_CHANNEL_ID" \
  --discord-results-forum-id "$ZINK_DISCORD_RESULTS_FORUM_ID" \
  --discord-approvals-forum-id "$ZINK_DISCORD_APPROVALS_FORUM_ID" \
  --discord-incidents-forum-id "$ZINK_DISCORD_INCIDENTS_FORUM_ID"

node integrations/openclaw/verify.mjs --live \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID" \
  --discord-office-channel-id "$ZINK_DISCORD_OFFICE_CHANNEL_ID" \
  --discord-results-forum-id "$ZINK_DISCORD_RESULTS_FORUM_ID" \
  --discord-approvals-forum-id "$ZINK_DISCORD_APPROVALS_FORUM_ID" \
  --discord-incidents-forum-id "$ZINK_DISCORD_INCIDENTS_FORUM_ID"
```

The live operator checklist also requires: all seven Discord applications have
Message Content Intent enabled; `#office` grants View Channel, Send Messages,
and Read Message History; each forum grants View Channel, Send Messages in
Threads, and Read Message History; no default
gateway active for the same port/state; `openclaw-gateway-zink.service` enabled
and active; no native Discord command registrations; all seven account probes
succeed; targeted capability checks cover all 28 account/surface pairs, require
the operational permissions, and reject administrator, channel/role/webhook
management, or application-command permission; and owner mention,
direct-reply, multi-mention, non-owner, no-mention, bot-authored, and command-like
message tests behave exactly as contracted. Additional non-admin channel
capabilities remain owner-managed Discord state. Redact IDs and all runtime
output before recording evidence.
