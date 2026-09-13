import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  AGENT_IDS,
  buildConfig,
  stableJson,
  validateConfig,
} from "../../lib/policy.mjs";

const T1_SHA = "997b6ce221072eea06a969218a8e2e49ebee1dcc";
const T1_POLICY_SHA256 =
  "1865f2a5efa0a239683d520478e87951fd73493e275432d46a5ea67313297e2b";
const digest = (body) => createHash("sha256").update(body).digest("hex");
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("BACKUP_JSON_INVALID");
  }
}
function noLinks(target) {
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  )
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error("BACKUP_SYMLINK_DENIED");
}
function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !["EPERM", "EISDIR", "EINVAL", "ENOTSUP"].includes(error.code)
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function writeNew(file, body) {
  noLinks(file);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(path.dirname(file));
}
function pluginFiles(root, relative = "") {
  if (!existsSync(root)) return [];
  noLinks(root);
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_DENIED");
      if (entry.isDirectory()) {
        if (!["lib", "contracts", "policy"].includes(name))
          throw new Error("BACKUP_UNEXPECTED_PLUGIN_CONTENT");
        return pluginFiles(root, name);
      }
      if (
        !entry.isFile() ||
        !/^(?:index\.mjs|package\.json|openclaw\.plugin\.json|governance-manifests\.json|lib\/[a-z-]+\.mjs|contracts\/[a-z-]+\.schema\.json|policy\/[a-z-]+\.json)$/u.test(
          name,
        )
      )
        throw new Error("BACKUP_UNEXPECTED_PLUGIN_CONTENT");
      return [name];
    })
    .sort();
}
export function runtimeBackupPath(stateDir) {
  return path.join(stateDir, "operator", "m7-t2", "backups", "r12");
}

// Operator-only artifact construction. No auth store, backing SecretRef value,
// identity key or transcript is read/copied. Caller supplies T1-bound IDs.
export async function createRuntimeBackup({ stateDir, identifiers }) {
  if (!path.isAbsolute(stateDir))
    throw new Error("BACKUP_ABSOLUTE_PATH_REQUIRED");
  const root = runtimeBackupPath(stateDir);
  noLinks(root);
  if (existsSync(root)) return verifyRuntimeBackup({ stateDir, identifiers });
  const configPath = path.join(stateDir, "openclaw.json");
  noLinks(configPath);
  if (existsSync(configPath)) {
    // Validate before capturing: config must contain references, never raw keys.
    validateConfig(parseJson(readFileSync(configPath, "utf8")), {
      stateDir,
      identifiers,
    });
  }
  const source = execFileSync(
    "git",
    ["show", `${T1_SHA}:integrations/openclaw/lib/policy.mjs`],
    { maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (digest(source) !== T1_POLICY_SHA256)
    throw new Error("T1_BASELINE_SOURCE_MISMATCH");
  const targets = [
    "openclaw.json",
    ...AGENT_IDS.map((id) => `workspaces/${id}/AGENTS.md`),
    ...pluginFiles(path.join(stateDir, "extensions", "zink-governance")).map(
      (file) => `extensions/zink-governance/${file}`,
    ),
  ];
  // Complete all reads/type checks before creating a backup directory.
  const originals = targets.map((relative) => {
    const target = path.join(stateDir, relative);
    noLinks(target);
    if (!existsSync(target)) return { relative, existed: false };
    if (!lstatSync(target).isFile())
      throw new Error("BACKUP_TARGET_NOT_REGULAR");
    const body = readFileSync(target);
    return {
      relative,
      existed: true,
      mode: lstatSync(target).mode & 0o777,
      digest: digest(body),
      body,
    };
  });
  mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
  mkdirSync(root, { mode: 0o700 });
  writeNew(path.join(root, "t1-policy.mjs"), source);
  const baseline = await import(
    pathToFileURL(path.join(root, "t1-policy.mjs")).href
  );
  const fallback = baseline.buildConfig({ stateDir, identifiers });
  baseline.validateConfig(fallback, { stateDir, identifiers });
  writeNew(path.join(root, "t1-config.json"), stableJson(fallback));
  for (const entry of originals)
    if (entry.existed)
      writeNew(path.join(root, "preimages", entry.relative), entry.body);
  const manifest = {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r12",
    t1_sha: T1_SHA,
    t1_policy_source_digest: T1_POLICY_SHA256,
    t1_config_digest: digest(stableJson(fallback)),
    intended_config_digest: digest(
      stableJson(buildConfig({ stateDir, identifiers })),
    ),
    files: originals.map((original) => {
      const entry = { ...original };
      delete entry.body;
      return entry;
    }),
    restore_order: [
      "native-preimages",
      "t1-config",
      "quarantine-generated-AGENTS",
      "quarantine-governance-extension",
      "restart-zink-gateway",
      "verify-t1-effective-tools",
    ],
    excluded: [
      "auth-stores",
      "identity.key",
      "SecretRef-values",
      "transcripts",
    ],
  };
  writeNew(path.join(root, "manifest.json"), stableJson(manifest));
  syncDirectory(root);
  syncDirectory(path.dirname(root));
  return verifyRuntimeBackup({ stateDir, identifiers });
}

export async function verifyRuntimeBackup({ stateDir, identifiers }) {
  const root = runtimeBackupPath(stateDir);
  noLinks(root);
  const manifestPath = path.join(root, "manifest.json");
  noLinks(manifestPath);
  const manifest = parseJson(readFileSync(manifestPath, "utf8"));
  if (
    manifest.governance_version !== "m7-t2-r12" ||
    manifest.t1_sha !== T1_SHA ||
    manifest.t1_policy_source_digest !== T1_POLICY_SHA256 ||
    !Array.isArray(manifest.files)
  )
    throw new Error("BACKUP_MANIFEST_INVALID");
  const sourcePath = path.join(root, "t1-policy.mjs");
  noLinks(sourcePath);
  if (digest(readFileSync(sourcePath)) !== T1_POLICY_SHA256)
    throw new Error("T1_BASELINE_SOURCE_MISMATCH");
  const baseline = await import(pathToFileURL(sourcePath).href);
  const fallbackPath = path.join(root, "t1-config.json");
  noLinks(fallbackPath);
  const fallback = readFileSync(fallbackPath);
  if (digest(fallback) !== manifest.t1_config_digest)
    throw new Error("BACKUP_DIGEST_MISMATCH");
  baseline.validateConfig(parseJson(fallback.toString("utf8")), {
    stateDir,
    identifiers,
  });
  for (const entry of manifest.files) {
    if (
      !/^(?:openclaw\.json|workspaces\/(?:main|o1|o2|excel|power-bi|sql|python)\/AGENTS\.md|extensions\/zink-governance\/(?:index\.mjs|package\.json|openclaw\.plugin\.json|governance-manifests\.json|lib\/[a-z-]+\.mjs|contracts\/[a-z-]+\.schema\.json|policy\/[a-z-]+\.json))$/u.test(
        entry.relative,
      )
    )
      throw new Error("BACKUP_TARGET_DENIED");
    if (!entry.existed) continue;
    const file = path.join(root, "preimages", entry.relative);
    noLinks(file);
    if (
      !lstatSync(file).isFile() ||
      digest(readFileSync(file)) !== entry.digest
    )
      throw new Error("BACKUP_DIGEST_MISMATCH");
  }
  const required = [
    "openclaw.json",
    ...AGENT_IDS.map((id) => `workspaces/${id}/AGENTS.md`),
  ];
  const names = manifest.files.map((entry) => entry.relative);
  if (
    new Set(names).size !== names.length ||
    required.some((name) => !names.includes(name)) ||
    manifest.files.some(
      (entry) =>
        typeof entry.existed !== "boolean" ||
        (entry.existed &&
          (!Number.isInteger(entry.mode) ||
            entry.mode < 0 ||
            entry.mode > 0o777 ||
            !/^[a-f0-9]{64}$/u.test(entry.digest))),
    )
  )
    throw new Error("BACKUP_MANIFEST_INVALID");
  if (process.platform !== "win32") {
    if ((lstatSync(root).mode & 0o777) !== 0o700)
      throw new Error("BACKUP_PERMISSION_MISMATCH");
    for (const file of [
      manifestPath,
      sourcePath,
      fallbackPath,
      ...manifest.files
        .filter((entry) => entry.existed)
        .map((entry) => path.join(root, "preimages", entry.relative)),
    ])
      if ((lstatSync(file).mode & 0o777) !== 0o600)
        throw new Error("BACKUP_PERMISSION_MISMATCH");
  }
  return {
    manifestPath,
    manifestDigest: digest(readFileSync(manifestPath)),
    fileCount: manifest.files.length,
    t1PolicyVerified: true,
  };
}

// Operator step only: native preimages must be restored before this step and the
// scoped gateway restarted/verified afterwards. Never reports a live rollback PASS.
export async function restoreT1RuntimeFiles({ stateDir, identifiers }) {
  await verifyRuntimeBackup({ stateDir, identifiers });
  const root = runtimeBackupPath(stateDir);
  const fallback = readFileSync(path.join(root, "t1-config.json"));
  const config = path.join(stateDir, "openclaw.json");
  const quarantine = path.join(root, "quarantined-t2");
  noLinks(quarantine);
  const targets = [
    ...AGENT_IDS.map((id) => `workspaces/${id}/AGENTS.md`),
    "extensions/zink-governance",
  ];
  // Validate the entire bounded move set first. No auth/key/workflow ledger path
  // participates; a previously quarantined target is never overwritten.
  for (const relative of targets) {
    const source = path.join(stateDir, relative);
    const destination = path.join(quarantine, relative);
    noLinks(source);
    noLinks(destination);
    if (!existsSync(source)) continue;
    const stat = lstatSync(source);
    if (relative.startsWith("extensions/")) {
      if (!stat.isDirectory()) throw new Error("RESTORE_TARGET_INVALID");
      pluginFiles(source);
    } else if (!stat.isFile()) throw new Error("RESTORE_TARGET_INVALID");
    if (existsSync(destination)) throw new Error("RESTORE_QUARANTINE_CONFLICT");
  }
  noLinks(config);
  if (existsSync(config) && !lstatSync(config).isFile())
    throw new Error("RESTORE_TARGET_INVALID");
  const temporary = path.join(stateDir, "openclaw.json.zink-r12-restore");
  noLinks(temporary);
  if (existsSync(temporary)) throw new Error("RESTORE_TEMP_CONFLICT");
  const current = existsSync(config) ? readFileSync(config) : undefined;
  if (current && digest(current) !== digest(fallback)) {
    // A drifted/secret-bearing config must not enter the quarantine artifact.
    validateConfig(parseJson(current.toString("utf8")), {
      stateDir,
      identifiers,
    });
  }
  const savedConfig = path.join(quarantine, "openclaw.json");
  noLinks(savedConfig);
  if (
    current &&
    digest(current) !== digest(fallback) &&
    existsSync(savedConfig)
  )
    throw new Error("RESTORE_QUARANTINE_CONFLICT");
  mkdirSync(quarantine, { recursive: true, mode: 0o700 });
  if (current && digest(current) !== digest(fallback))
    writeNew(savedConfig, current);
  if (!current || digest(current) !== digest(fallback)) {
    writeNew(temporary, fallback);
    renameSync(temporary, config);
    syncDirectory(stateDir);
  }
  chmodSync(config, 0o600);
  for (const relative of targets) {
    const source = path.join(stateDir, relative);
    if (!existsSync(source)) continue;
    const destination = path.join(quarantine, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    renameSync(source, destination);
    syncDirectory(path.dirname(source));
    syncDirectory(path.dirname(destination));
  }
  if (
    digest(readFileSync(config)) !== digest(fallback) ||
    targets.some((relative) => existsSync(path.join(stateDir, relative)))
  )
    throw new Error("RESTORE_VERIFICATION_FAILED");
  return {
    filesRestored: true,
    liveBaselineValidation: "NOT RUN",
    gatewayRestartRequired: true,
  };
}
