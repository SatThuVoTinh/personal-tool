// Consume owner-supplied identifiers in trusted operator context only.
// Never print identifier values, input JSON, child command arguments or raw errors.
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  parseIdentifiers,
  assertNoSymlinkComponents,
} from "../../../lib/policy.mjs";

const stateDir = "/home/hoang_vinh/.openclaw-zink";
const input = path.join(stateDir, "operator/m7-t2/discord-identifiers.json");
let stage = "identifiers";
try {
  assertNoSymlinkComponents(input);
  const stat = lstatSync(input);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
    throw new Error("INVALID_IDENTIFIER_FILE");
  const values = JSON.parse(readFileSync(input, "utf8"));
  const identifiers = parseIdentifiers(values);
  if (
    Object.keys(values).length !== 6 ||
    Object.values(identifiers).some((id) => typeof id !== "string")
  )
    throw new Error("INVALID_IDENTIFIER_FILE");
  stage = "builder-preflight";
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const args = [
    "integrations/openclaw/configure.mjs",
    "--preflight",
    "--state-dir",
    stateDir,
  ];
  for (const [name, value] of Object.entries(identifiers))
    args.push(
      `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  execFileSync(process.execPath, args, {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
    maxBuffer: 65536,
  });
  process.stdout.write(
    `${JSON.stringify({ identifiers: "VALID", builder_preflight: "PASS", installed_mutation: false })}\n`,
  );
} catch (error) {
  // Classify only known static diagnostics; unknown output stays undisclosed.
  const output = String(error.stderr ?? "");
  // The list is ordered most-specific first because `find` wins the tie: a mode
  // drift on the hotfix must be reported as the hotfix, not as a generic mode class.
  // M12/T2 deployment attempt: a real refusal arrived as `PREFLIGHT_REJECTED` because
  // none of these classes named it, and an undiagnosable fail-closed gate costs the
  // operator a whole round trip. The classes below are static literals from
  // `configure.mjs` / `policy.mjs` - never a message, which could quote config content.
  const known = [
    "governance instructions drift",
    "Agent governance instructions drift",
    "Governance plugin asset",
    "Governance plugin entrypoint",
    "Governance plugin manifest",
    "Governance plugin package",
    "Gemini stream hotfix utility",
    "Password-store resolver",
    "Auth order plan",
    "Auth SecretRef plan",
    "Systemd drop-in",
    "Governance identity key",
    "T2 backup manifest",
    "ROUTER_HOST_UNAVAILABLE",
    "ROUTER_PORT_UNAVAILABLE",
    "ROUTER_API_KEY_UNAVAILABLE",
    "must be a numeric Discord snowflake",
    "surface IDs must be distinct",
    "Existing config must be canonical JSON",
    "Ledger corruption",
    "symlink",
    "mode drift",
    "Policy drift",
    "EXECUTION_STATE_UNKNOWN",
    "permission",
    "EACCES",
    "ENOENT",
  ];
  const reason =
    known.find((entry) => output.includes(entry) || error.code === entry) ??
    "PREFLIGHT_REJECTED";
  process.stdout.write(
    `${JSON.stringify({ stage, status: "FAIL", reason, installed_mutation: false })}\n`,
  );
  process.exitCode = 1;
}
