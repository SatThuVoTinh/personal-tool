// Shared test environment for the governed model provider (M10/T2-R9).
//
// The router ENDPOINT is resolved from the environment at BUILD time and baked
// into the generated openclaw.json, because the installed OpenClaw has no
// `${ENV}` config templating (proven against the runtime). The router
// CREDENTIAL is not: M12/T9 F-036 (owner decision 2026-10-21, `H6`) moved it
// onto the password-store indirection, so the generated config carries a
// REFERENCE (`SECRET_REFS.router`) and the key is resolved at RUNTIME by the
// installed resolver.
//
// This helper supplies obviously-fake, non-routable placeholder values so the
// CONFIG SHAPE can be asserted without a live router. It deliberately does NOT
// stand in for a reachability gate: the real endpoint is checked by
// `verify.mjs`'s live router probe, which runs against the live runtime and is
// never satisfied by these placeholders.
//
// Precedent: `tests/m8-t2.17-owner-identity-hygiene.test.mjs` already sets
// `process.env.DISCORD_OWNER_ID` for the same reason.
export const ROUTER_TEST_HOST = "router.invalid";
export const ROUTER_TEST_PORT = "1";
export const ROUTER_TEST_API_KEY = "test-router-key-not-a-credential";

export function applyRouterTestEnv() {
  const previous = {
    ZINK_ROUTER_HOST: process.env.ZINK_ROUTER_HOST,
    ZINK_ROUTER_PORT: process.env.ZINK_ROUTER_PORT,
    ZINK_ROUTER_API_KEY: process.env.ZINK_ROUTER_API_KEY,
  };
  process.env.ZINK_ROUTER_HOST = ROUTER_TEST_HOST;
  process.env.ZINK_ROUTER_PORT = ROUTER_TEST_PORT;
  process.env.ZINK_ROUTER_API_KEY = ROUTER_TEST_API_KEY;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
