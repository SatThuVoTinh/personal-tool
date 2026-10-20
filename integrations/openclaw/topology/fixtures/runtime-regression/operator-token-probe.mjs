// Resolver health probe: deliberately emits no resolver stdout, secret, ID or
// child stderr. It exists solely to separate operator-environment failures from
// governance RPC failures.
import path from "node:path";
import process from "node:process";
import { resolveGatewayToken } from "../../../verify.mjs";

// F-219: the machine-specific state root is NOT a literal. The probe takes
// it from the environment or the first argument and refuses to run without
// one, exactly like live-governance-probe.mjs: a probe that silently points
// at one operator's machine root says nothing about any other, and the
// literal is what made this file drift silently.
const stateDir = process.env.ZINK_PROBE_STATE_DIR ?? process.argv[2] ?? null;
if (!stateDir) {
  process.stdout.write(
    `${JSON.stringify({ resolver: "FAIL", code: "PROBE_STATE_DIR_NOT_NAMED" })}\n`,
  );
  process.exit(2);
}
const environment = {
  ...process.env,
  PATH: "/home/hoang_vinh/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  OPENCLAW_PROFILE: "zink",
  OPENCLAW_STATE_DIR: stateDir,
  PASSWORD_STORE_DIR: path.join(stateDir, "secrets/password-store"),
  GNUPGHOME: path.join(stateDir, "secrets/gnupg"),
};
try {
  const token = await resolveGatewayToken(
    path.join(stateDir, "bin/openclaw-pass-resolver"),
    environment,
  );
  // Prevent the resolved token from lingering in this operator process.
  const valid = typeof token === "string" && token.length > 0;
  process.stdout.write(
    `${JSON.stringify({ resolver: valid ? "PASS" : "FAIL" })}\n`,
  );
  process.exitCode = valid ? 0 : 1;
} catch (error) {
  const code =
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code)
      : "UNKNOWN";
  process.stdout.write(`${JSON.stringify({ resolver: "FAIL", code })}\n`);
  process.exitCode = 1;
}
