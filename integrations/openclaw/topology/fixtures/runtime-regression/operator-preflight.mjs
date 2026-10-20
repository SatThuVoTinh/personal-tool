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
import {
  KNOWN_REFUSAL_REASONS,
  assertSameRefusalClasses,
  refusalOutput,
} from "./refusal-classifier.mjs";

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
  //
  // M12/T9 F-159: the MATCHING RULE is shared with the apply driver
  // (`refusal-classifier.mjs`), and the class SET is asserted equal to the
  // shared set at load time, so the two drivers can never drift apart.
  //
  // Both drivers exec the same builder child, so the identical refusal used
  // to resolve to a different code (or to no code at all) depending on which
  // driver reported it: eighteen diagnostics were named only here and
  // degraded to `PREFLIGHT_REJECTED` on the apply path, while the apply
  // driver degraded this driver's `INVALID_IDENTIFIER_FILE` to
  // `APPLY_REJECTED`.
  //
  // The list below stays HERE (this driver is the reader's statement of what
  // it names) and the shared classifier is the authority; the equality check
  // fails closed on the first byte of drift, so a hand-maintained copy can
  // never become a second truth.
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
    "INVALID_IDENTIFIER_FILE",
    "GATEWAY_NOT_ACTIVE",
    "GATEWAY_UNIT_NOT_RELOADED",
    "symlink",
    "mode drift",
    "Policy drift",
    "EXECUTION_STATE_UNKNOWN",
    "permission",
    "EACCES",
    "ENOENT",
  ];
  assertSameRefusalClasses(known, KNOWN_REFUSAL_REASONS);
  const reason =
    known.find((entry) => refusalOutput(error).includes(entry)) ??
    "PREFLIGHT_REJECTED";
  process.stdout.write(
    `${JSON.stringify({ stage, status: "FAIL", reason, installed_mutation: false })}\n`,
  );
  process.exitCode = 1;
}
