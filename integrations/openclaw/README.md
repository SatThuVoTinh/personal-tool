# OpenClaw T1 Foundation

This directory provisions the owner-approved M7/T1-R9 OpenClaw profile. It is
intentionally a private Discord conversation foundation, not the Zink Tools
bridge: there are no specialists, skills, native Zink plugins or data/tool
access surfaces in T1.

## Safety boundary

The generated `main` agent has an empty effective tool set and no command
surface. It uses a separate, non-repository workspace and a Docker sandbox with
no network, read-only root, all capabilities dropped and no binds. This does not
put the Gateway or channel plugin inside the sandbox; gateway loopback/auth,
plugin inventory and Discord access gates remain separate controls.

Only these moving Google aliases are permitted:

```text
google/gemini-flash-latest
google/gemini-flash-lite-latest
```

Fallback stays within Google. A failure of both aliases is closed; no OpenAI,
Codex or another provider is configured. The single `google:zink-primary`
profile is an API-key profile whose key is a structured SecretRef in the
OpenClaw auth store, never an inline value.

## Prepare non-secret identifiers

In a systemd-capable WSL shell, set only local shell variables for the three
Discord identifiers. Do not add tokens or API keys to shell history, the repo or
the builder command line.

```bash
export ZINK_STATE_DIR="$HOME/.openclaw-zink"
export ZINK_DISCORD_GUILD_ID='replace-with-guild-id'
export ZINK_DISCORD_CHANNEL_ID='replace-with-channel-id'
export ZINK_DISCORD_OWNER_ID='replace-with-owner-user-id'
```

Run the repository builder from the repository root. `--dry-run` writes nothing.

```bash
node integrations/openclaw/configure.mjs --dry-run \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-channel-id "$ZINK_DISCORD_CHANNEL_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID"

node integrations/openclaw/configure.mjs --apply \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-channel-id "$ZINK_DISCORD_CHANNEL_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID"
```

The builder creates only regular, owner-private state/config files, the exact
empty workspace template, a systemd drop-in, and
`zink-auth-secret-plan.json`. It refuses pre-existing workspace/config drift
instead of deleting it.

## Install and provision locally

Install OpenClaw through its official `extended-stable` path, then persist its
update channel with the generated config. Do not substitute `latest` if
`extended-stable` cannot be selected. Build the official
`openclaw-sandbox:bookworm-slim` image if the Docker preflight says it is absent.

Populate the masked OpenClaw store with the three values named
`GEMINI_API_KEY`, `DISCORD_BOT_TOKEN` and `ZINK_OPENCLAW_GATEWAY_TOKEN` through
an approved local secret-entry flow. Then let OpenClaw, not this repository,
write the `main` auth SQLite record from the generated ref-only plan:

```bash
export OPENCLAW_PROFILE=zink
export OPENCLAW_STATE_DIR="$ZINK_STATE_DIR"
openclaw secrets apply --from "$ZINK_STATE_DIR/zink-auth-secret-plan.json"
```

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
  --discord-channel-id "$ZINK_DISCORD_CHANNEL_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID"

node integrations/openclaw/verify.mjs --live \
  --state-dir "$ZINK_STATE_DIR" \
  --discord-guild-id "$ZINK_DISCORD_GUILD_ID" \
  --discord-channel-id "$ZINK_DISCORD_CHANNEL_ID" \
  --discord-owner-id "$ZINK_DISCORD_OWNER_ID"
```

The live operator checklist also requires: no default gateway active for the
same port/state; `openclaw-gateway-zink.service` enabled and active; no native
Discord command registrations; `channels status --channel discord --probe` live
success; targeted channel capabilities when the installed CLI supports them; and
owner mention/non-owner/no-mention/command-like message tests. Redact IDs and
all runtime output before recording evidence.
