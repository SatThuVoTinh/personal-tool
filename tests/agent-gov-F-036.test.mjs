// M12/T9 F-036 (legacy R5-E13-02) — the router API key must travel through the
// SAME SecretRef indirection as every other secret.
//
// The owner's decision (2026-10-21, `H6`): "làm" — route the router key
// through `secrets.providers`, so the generated `openclaw.json` carries a
// REFERENCE and never the credential, and the key can be rotated without a
// re-apply of the whole tree.
//
// MEASURED AT HEAD (before this fix):
//   - `policy.mjs` wrote `models.providers[router].apiKey = resolveRouterApiKey()`,
//     and `resolveRouterApiKey()` returned the literal
//     `process.env.ZINK_ROUTER_API_KEY`;
//   - every OTHER secret — the seven Discord bot tokens and the gateway token —
//     is carried as a `{source, provider, id}` reference and resolved at RUNTIME
//     through the `secrets.providers` block the config declares;
//   - `buildSecretsPlan()` returned ZERO targets (the auth profiles it once
//     carried are gone), so the plan never mentioned the router key either.
//
// The reference syntax and the entry-id convention are the repository's OWN:
// `SECRET_REFS` carries `{source: "exec", provider: PASS_PROVIDER_ID, id}` and
// `PASS_ENTRY_IDS` carries the `zink/openclaw/<NAME>` ids the password-store
// resolver is allowed to serve. The pinned runtime accepts that shape at
// `models.providers.<id>.apiKey` (the provider's `apiKey` is a `SecretInput`,
// i.e. a string or a `{source, provider, id}` reference), so the router key
// joins the seven bot tokens and the gateway token on the same path.
//
// These lanes assert the OWNED properties:
//   1. the generated config carries a REFERENCE to the router secret;
//   2. the key's bytes never reach the generated config;
//   3. the secrets plan and the config agree — the plan declares no credential
//      and every reference the config carries is one the declared provider may
//      serve;
//   4. the preflight still refuses a plan that does not match the builder.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PASS_ENTRY_IDS,
  PASS_PROVIDER_ID,
  ROUTER_PROVIDER_ID,
  SECRET_REFS,
  buildConfig,
  buildSecretsPlan,
  passResolverContents,
  stableJson,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  ROUTER_TEST_API_KEY,
  applyRouterTestEnv,
} from "./helpers/router-env.mjs";

const identifiers = Object.freeze({
  discordGuildId: "12345678901234567",
  discordOwnerId: "32345678901234567",
  discordOfficeChannelId: "22345678901234567",
  discordResultsForumId: "42345678901234567",
  discordApprovalsForumId: "52345678901234567",
  discordIncidentsForumId: "62345678901234567",
});

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");

function temporaryDirectory() {
  return mkdtempSync(path.join(os.tmpdir(), "zink-f036-"));
}

/** The generated config, with the placeholder router environment applied. */
function generatedConfig() {
  const restore = applyRouterTestEnv();
  try {
    const stateDir = temporaryDirectory();
    try {
      return buildConfig({ stateDir, identifiers });
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
}

/** Every `{source, provider, id}` reference the config carries. */
function secretReferences(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) secretReferences(entry, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  if (
    typeof value.source === "string" &&
    typeof value.provider === "string" &&
    typeof value.id === "string"
  ) {
    found.push(value);
  }
  for (const entry of Object.values(value)) secretReferences(entry, found);
  return found;
}

test("F-036: the generated config carries a reference to the router secret", () => {
  const config = generatedConfig();
  const router = config.models.providers[ROUTER_PROVIDER_ID];
  assert.deepEqual(
    router.apiKey,
    {
      source: "exec",
      provider: PASS_PROVIDER_ID,
      id: PASS_ENTRY_IDS.router,
    },
    "the router credential must be a reference, resolved at runtime",
  );
  assert.equal(
    PASS_ENTRY_IDS.router,
    "zink/openclaw/ZINK_ROUTER_API_KEY",
    "the router entry must follow the repository's own zink/openclaw/<NAME> convention",
  );
  assert.deepEqual(SECRET_REFS.router, {
    source: "exec",
    provider: PASS_PROVIDER_ID,
    id: PASS_ENTRY_IDS.router,
  });
  // The reference is the SAME shape the seven bot tokens and the gateway token
  // already carry, so the router key joins one mechanism instead of a second.
  assert.deepEqual(
    Object.keys(SECRET_REFS.router).sort(),
    Object.keys(SECRET_REFS.gateway).sort(),
  );
  assert.equal(SECRET_REFS.router.provider, SECRET_REFS.gateway.provider);
});

test("F-036: the key's bytes never reach the generated config", () => {
  const config = generatedConfig();
  const serialized = stableJson(config);
  assert.equal(
    serialized.includes(ROUTER_TEST_API_KEY),
    false,
    "the router credential must not be baked into the generated config",
  );
  assert.equal(
    serialized.includes('"ZINK_ROUTER_API_KEY"'),
    false,
    "the generated config must not carry the environment variable the key used to come from as a setting",
  );
  assert.ok(
    serialized.includes(PASS_ENTRY_IDS.router),
    "the generated config must carry the reference the runtime resolves",
  );
});

test("F-036: the secrets plan and the config agree", () => {
  const plan = buildSecretsPlan();
  // The plan is what the preflight compares against the builder, byte for
  // byte. It declares NO credential — the router key is a CONFIG reference, like
  // the seven bot tokens and the gateway token, and not an auth-profile target.
  assert.deepEqual(plan, {
    version: 1,
    protocolVersion: 1,
    targets: [],
  });
  assert.equal(
    stableJson(plan).includes(ROUTER_TEST_API_KEY),
    false,
    "the secrets plan must never carry a credential",
  );

  // The agreement the config and the declared provider must keep: every
  // reference the config carries names an id the password-store resolver is
  // allowed to serve. A reference to an id the resolver refuses would leave
  // the runtime unable to resolve the credential at all.
  const resolver = passResolverContents();
  const references = secretReferences(generatedConfig());
  assert.ok(references.length > 0, "the config must carry secret references");
  for (const reference of references) {
    assert.equal(
      reference.provider,
      PASS_PROVIDER_ID,
      "every reference must name the provider the config declares",
    );
    assert.ok(
      resolver.includes(reference.id),
      `the declared provider must be allowed to serve '${reference.id}'`,
    );
  }
  assert.ok(
    references.some((reference) => reference.id === PASS_ENTRY_IDS.router),
    "the router secret must be one of the references the provider may serve",
  );
});

test("F-036: the preflight still refuses a secrets plan that drifted", () => {
  const verifySource = readFileSync(
    path.join(REPOSITORY_ROOT, "integrations", "openclaw", "verify.mjs"),
    "utf8",
  );
  assert.ok(
    verifySource.includes("!== stableJson(buildSecretsPlan())"),
    "the preflight must still compare the plan file with the builder's plan",
  );
  assert.ok(
    verifySource.includes("Auth SecretRef plan drift detected"),
    "the preflight must still refuse a drifted plan by name",
  );
  // The comparison is not vacuous: a plan that carries anything the builder
  // does not produce can never equal the builder's plan.
  const drifted = {
    ...buildSecretsPlan(),
    targets: [{ type: "auth-profiles.api_key.key", path: "profiles.main.key" }],
  };
  assert.notEqual(
    stableJson(drifted),
    stableJson(buildSecretsPlan()),
    "a drifted plan must not compare equal to the builder's plan",
  );
});
