// Trusted operator-only explicit rollback. This command restores only the
// R12-owned native sources and generated runtime surfaces, never auth stores.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  restoreNativePatch,
  inspectNativePatch,
} from "../../lib/native-patch.mjs";
import { restoreT1RuntimeFiles } from "../../lib/runtime-backup.mjs";
import {
  assertNoSymlinkComponents,
  parseIdentifiers,
} from "../../../lib/policy.mjs";

const stateDir = "/home/hoang_vinh/.openclaw-zink";
const runtimeRoot = "/home/hoang_vinh/.local/lib/node_modules/openclaw";
const backup = path.join(stateDir, "operator", "m7-t2", "native-r12");
const identifiersPath = path.join(
  stateDir,
  "operator/m7-t2/discord-identifiers.json",
);

function identifiers() {
  assertNoSymlinkComponents(identifiersPath);
  const stat = lstatSync(identifiersPath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
    throw new Error("INVALID_IDENTIFIER_FILE");
  return parseIdentifiers(JSON.parse(readFileSync(identifiersPath, "utf8")));
}

try {
  const values = identifiers();
  restoreNativePatch(runtimeRoot, backup);
  await restoreT1RuntimeFiles({ stateDir, identifiers: values });
  execFileSync(
    "systemctl",
    ["--user", "restart", "openclaw-gateway-zink.service"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
  const baseline = inspectNativePatch(runtimeRoot);
  if (!Object.values(baseline).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_RESTORE_FAILED");
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", runtime: "T1_RESTORED" })}\n`,
  );
} catch {
  process.stdout.write(
    `${JSON.stringify({ status: "FAIL", runtime: "RESTORE_UNVERIFIED" })}\n`,
  );
  process.exitCode = 1;
}
