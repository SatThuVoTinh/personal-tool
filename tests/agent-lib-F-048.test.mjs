// M12/T9 F-048 (R5-E13-03): the repository - which lives under OneDrive, a
// synced third-party store, and is pushable to a remote - used to carry the
// complete server-scoped bot/role/channel identity map, which enables targeted
// impersonation of an agent mention surface.
//
// The library half is landed: `integrations/openclaw/lib/authority.mjs` is the
// ONE source of the identity map, and no tracked markdown file may carry a raw
// snowflake again.
//
// The first lane is RED at HEAD on the files the ORCHESTRATOR owns:
// `docs/execution/findings.md` still carries snowflakes (the register quotes
// them verbatim). The threshold is not weakened here: the lane names every
// offending file so the residual is visible instead of hidden.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DISCORD_BOT_IDS,
  DISCORD_CHANNEL_IDS,
  DISCORD_ROLE_IDS,
} from "../integrations/openclaw/lib/authority.mjs";
import { agentInstructions } from "../integrations/openclaw/lib/policy.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SNOWFLAKE = /(?<![0-9])[1-9][0-9]{16,19}(?![0-9])/u;

test("F-048: no tracked markdown file carries a raw Discord snowflake", () => {
  const tracked = execFileSync("git", ["ls-files", "*.md"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(tracked.length > 0, "the tracked markdown must actually be walked");
  const offenders = [];
  for (const relative of tracked) {
    const src = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    const match = src.match(SNOWFLAKE);
    if (match) offenders.push(`${relative}: ${match[0]}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `tracked markdown must not carry a raw snowflake: ${offenders.join(", ")}`,
  );
});

test("F-048: authority.mjs is the only source", () => {
  assert.ok(DISCORD_BOT_IDS, "the bot ids must live in authority.mjs");
  assert.ok(DISCORD_ROLE_IDS, "the role ids must live in authority.mjs");
  assert.ok(DISCORD_CHANNEL_IDS, "the surface ids must live in authority.mjs");
  const instructions = agentInstructions("o1");
  for (const [surface, id] of Object.entries(DISCORD_CHANNEL_IDS)) {
    assert.ok(
      instructions.includes(id),
      `the governance instructions must carry the ${surface} surface id`,
    );
  }
});
