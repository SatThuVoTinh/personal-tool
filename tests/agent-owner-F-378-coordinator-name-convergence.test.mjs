// M12/T9 F-378 — the deploy refused the owner's own config.
//
// Measured on the live host on 2026-10-22, READ-ONLY: the live
// `~/.openclaw-zink/openclaw.json` differs from the config the current build
// generates in exactly THREE paths — the two coordinators' DISPLAY names
// ("ETL Coordinator" / "Analytics Coordinator" against the current
// "Coordinator O1" / "Coordinator O2") and the router credential (a baked-in
// string against the current SecretRef). The credential is ALREADY converged
// (the builder replaces the whole `models` subtree), so the two NAMES were the
// only drift the builder could not converge — and the preflight refused the
// deployment with `Policy drift`.
//
// The names are generated data: `AGENT_DEFINITIONS` in
// `integrations/openclaw/lib/authority.mjs` is the canonical roster, exactly
// like the mention grammar and the `alsoAllow` list that the builder already
// regenerates. A config written by the previous build therefore differs in
// exactly that field, and converges the same way — with the RESULT re-validated
// by `validateConfig`, so a config that differs in any OTHER respect still
// fails closed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  AGENT_DEFINITIONS,
  SECRET_REFS,
  validateConfig,
} from "../integrations/openclaw/lib/policy.mjs";
import { applyRouterTestEnv } from "./helpers/router-env.mjs";
import { takeApplyTransaction } from "./helpers/apply-transaction.mjs";

// The router ENDPOINT and CREDENTIAL are resolved from the environment at
// build time; the placeholders let this lane assert config SHAPE only.
applyRouterTestEnv();

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
});

const discordIdentifierArguments = Object.freeze([
  "--discord-guild-id",
  identifiers.discordGuildId,
  "--discord-owner-id",
  identifiers.discordOwnerId,
  "--discord-office-channel-id",
  identifiers.discordOfficeChannelId,
  "--discord-results-forum-id",
  identifiers.discordResultsForumId,
  "--discord-approvals-forum-id",
  identifiers.discordApprovalsForumId,
  "--discord-incidents-forum-id",
  identifiers.discordIncidentsForumId,
]);

/** The retired display names, measured on the live host on 2026-10-22. */
const RETIRED_NAMES = Object.freeze({
  o1: "ETL Coordinator",
  o2: "Analytics Coordinator",
});

/** The current canonical display name of one agent id. */
function canonicalName(agentId) {
  const definition = AGENT_DEFINITIONS.find(
    (candidate) => candidate.id === agentId,
  );
  assert.ok(definition, `the canonical roster must carry ${agentId}`);
  return definition.name;
}

/** The agent entry with this id, in a config's roster. */
function agentById(config, agentId) {
  const agent = config.agents.list.find(
    (candidate) => candidate.id === agentId,
  );
  assert.ok(agent, `the config must carry the agent ${agentId}`);
  return agent;
}

test("M12/T9 F-378: the retired coordinator display names are really retired", () => {
  // The premise of the convergence: the current build names the coordinators
  // differently from the build that wrote the live config.
  assert.notEqual(canonicalName("o1"), RETIRED_NAMES.o1);
  assert.notEqual(canonicalName("o2"), RETIRED_NAMES.o2);
  assert.equal(canonicalName("o1"), "Coordinator O1");
  assert.equal(canonicalName("o2"), "Coordinator O2");
});

test("M12/T9 F-378: the builder converges the retired coordinator names, and stays fail-closed otherwise", () => {
  const root = mkdtempSync(path.join(tmpdir(), "zink-f378-"));
  try {
    const environment = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
    };
    const stateDir = path.join(root, ".openclaw-zink");
    const systemdUserDir = path.join(root, ".config", "systemd", "user");
    const script = path.join(
      process.cwd(),
      "integrations",
      "openclaw",
      "configure.mjs",
    );
    const apply = () =>
      execFileSync(
        process.execPath,
        [
          "--",
          script,
          "--state-dir",
          stateDir,
          "--systemd-user-dir",
          systemdUserDir,
          ...discordIdentifierArguments,
          "--apply",
          // F-111: the builder's apply is reachable only through the apply
          // orchestration, which takes the transaction snapshot first.
          "--apply-transaction",
          takeApplyTransaction({
            stateDir,
            runtimeRoot: path.join(root, "runtime"),
            systemdRoot: systemdUserDir,
          }),
        ],
        { env: environment, stdio: "pipe" },
      );

    const configPath = path.join(stateDir, "openclaw.json");
    apply();
    const canonical = JSON.parse(readFileSync(configPath, "utf8"));

    // The live host's shape: the retired display names AND the router
    // credential baked into the config as a plain string.
    const retired = JSON.parse(JSON.stringify(canonical));
    agentById(retired, "o1").name = RETIRED_NAMES.o1;
    agentById(retired, "o2").name = RETIRED_NAMES.o2;
    retired.models.providers.router.apiKey = "sk-baked-into-the-live-config";
    writeFileSync(configPath, `${JSON.stringify(retired, null, 2)}\n`, "utf8");

    assert.doesNotThrow(
      apply,
      "a config written by the previous build must converge, not be refused",
    );
    const converged = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(agentById(converged, "o1").name, canonicalName("o1"));
    assert.equal(agentById(converged, "o2").name, canonicalName("o2"));
    assert.deepEqual(
      converged.models.providers.router.apiKey,
      SECRET_REFS.router,
      "the converged config must carry the router credential as a reference, not as a value",
    );
    assert.doesNotThrow(() =>
      validateConfig(converged, { stateDir, identifiers }),
    );

    // Convergence is FIELD-SCOPED. The same retired names carried alongside an
    // unrelated difference must still fail closed, otherwise the migration
    // would launder arbitrary config edits into an accepted config.
    const mixed = JSON.parse(JSON.stringify(retired));
    agentById(mixed, "main").sandbox.docker.network = "bridge";
    writeFileSync(configPath, `${JSON.stringify(mixed, null, 2)}\n`, "utf8");
    assert.throws(apply, /Policy drift at agents/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
