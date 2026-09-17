// Trusted operator-only live apply. Identifier values, config bodies, secrets
// and raw child-process errors must never enter model-visible output.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  applyNativePatch,
  checkNativePatch,
  inspectNativePatch,
  restoreNativePatch,
} from "../../lib/native-patch.mjs";
import { restoreT1RuntimeFiles } from "../../lib/runtime-backup.mjs";
import {
  assertNoSymlinkComponents,
  parseIdentifiers,
} from "../../../lib/policy.mjs";

const stateDir = "/home/hoang_vinh/.openclaw-zink";
const runtimeRoot = "/home/hoang_vinh/.local/lib/node_modules/openclaw";
const nativeBackup = path.join(stateDir, "operator", "m7-t2", "native-r12");
const identifiersPath = path.join(
  stateDir,
  "operator/m7-t2/discord-identifiers.json",
);
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const service = "openclaw-gateway-zink.service";

function readIdentifiers() {
  assertNoSymlinkComponents(identifiersPath);
  const stat = lstatSync(identifiersPath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
    throw new Error("INVALID_IDENTIFIER_FILE");
  const parsed = JSON.parse(readFileSync(identifiersPath, "utf8"));
  const identifiers = parseIdentifiers(parsed);
  if (Object.keys(parsed).length !== 6)
    throw new Error("INVALID_IDENTIFIER_FILE");
  return identifiers;
}

function configArgs(mode, identifiers) {
  const args = [
    "integrations/openclaw/configure.mjs",
    mode,
    "--state-dir",
    stateDir,
  ];
  for (const [name, value] of Object.entries(identifiers))
    args.push(
      `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  return args;
}

function runBuilder(mode, identifiers) {
  execFileSync(process.execPath, configArgs(mode, identifiers), {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 65536,
  });
}

function restartScopedGateway() {
  execFileSync("systemctl", ["--user", "restart", service], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 65536,
  });
  const state = execFileSync("systemctl", ["--user", "is-active", service], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
    maxBuffer: 4096,
  })
    .toString("utf8")
    .trim();
  if (state !== "active") throw new Error("GATEWAY_NOT_ACTIVE");
}

async function rollback(identifiers) {
  const nativeManifest = path.join(nativeBackup, "manifest.json");
  if (existsSync(nativeManifest)) restoreNativePatch(runtimeRoot, nativeBackup);
  await restoreT1RuntimeFiles({ stateDir, identifiers });
  restartScopedGateway();
  execFileSync(
    "/home/hoang_vinh/.local/bin/openclaw",
    ["--profile", "zink", "config", "validate"],
    {
      env: {
        ...process.env,
        OPENCLAW_PROFILE: "zink",
        OPENCLAW_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
}

let stage = "identifiers";
let identifiers;
try {
  identifiers = readIdentifiers();
  stage = "builder";
  runBuilder("--apply", identifiers);
  stage = "native-patch";
  const oldQuarantine = path.join(
    stateDir,
    "operator",
    "m7-t2",
    "backups",
    "r12",
    "quarantined-t2",
  );
  if (existsSync(oldQuarantine))
    rmSync(oldQuarantine, { recursive: true, force: true });
  if (existsSync(nativeBackup)) {
    const inspection = inspectNativePatch(runtimeRoot);
    if (
      Object.values(inspection).every((entry) => entry.state === "BASELINE")
    ) {
      rmSync(nativeBackup, { recursive: true, force: true });
    }
  }
  applyNativePatch(runtimeRoot, nativeBackup);
  checkNativePatch(runtimeRoot);
  stage = "gateway-restart";
  restartScopedGateway();
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", stage: "applied", rollback_ready: true })}\n`,
  );
} catch {
  let recovery = "NOT_ATTEMPTED";
  try {
    if (identifiers) {
      await rollback(identifiers);
      recovery = "RESTORED";
    }
  } catch {
    recovery = "FAILED";
  }
  process.stdout.write(
    `${JSON.stringify({ status: "FAIL", stage, recovery })}\n`,
  );
  process.exitCode = 1;
}
