// Resolver health probe: deliberately emits no resolver stdout, secret, ID or
// child stderr. It exists solely to separate operator-environment failures from
// governance RPC failures.
import path from "node:path";
import process from "node:process";
import { resolveGatewayToken } from "../../../verify.mjs";

const stateDir = "/home/hoang_vinh/.openclaw-zink";
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
