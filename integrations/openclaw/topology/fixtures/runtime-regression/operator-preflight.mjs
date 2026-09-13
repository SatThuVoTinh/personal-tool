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
  const known = [
    "governance instructions drift",
    "Governance plugin asset",
    "Governance plugin entrypoint",
    "Governance plugin manifest",
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
