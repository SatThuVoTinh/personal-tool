// Trusted operator-only live apply. Identifier values, config bodies, secrets
// and raw child-process errors must never enter model-visible output.
//
// R7 DS: the sequence, the mutation boundary and the rollback condition live in
// apply-orchestration.mjs, which is covered by tests that never touch WSL. This
// file supplies the real, trusted effects only.
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
import { applyRuntime, classifyApplyReason } from "./apply-orchestration.mjs";

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

const oldQuarantine = path.join(
  stateDir,
  "operator",
  "m7-t2",
  "backups",
  "r12",
  "quarantined-t2",
);

const report = await applyRuntime({
  readIdentifiers,
  runBuilder,
  pruneQuarantine() {
    if (existsSync(oldQuarantine))
      rmSync(oldQuarantine, { recursive: true, force: true });
  },
  pruneStaleNativeBackup() {
    if (!existsSync(nativeBackup)) return;
    const inspection = inspectNativePatch(runtimeRoot);
    if (
      Object.values(inspection).every((entry) => entry.state === "BASELINE")
    ) {
      rmSync(nativeBackup, { recursive: true, force: true });
    }
  },
  applyNativePatch: () => applyNativePatch(runtimeRoot, nativeBackup),
  checkNativePatch: () => checkNativePatch(runtimeRoot),
  restoreNativePatch: () => {
    if (existsSync(path.join(nativeBackup, "manifest.json")))
      restoreNativePatch(runtimeRoot, nativeBackup);
  },
  restoreT1RuntimeFiles: (identifiers) =>
    restoreT1RuntimeFiles({ stateDir, identifiers }),
  restartScopedGateway,
  validateConfig() {
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
  },
  classifyReason: classifyApplyReason,
});

process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
