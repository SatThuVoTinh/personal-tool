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
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  AGENT_IDS,
  buildConfig,
  governancePluginFiles,
  stableJson,
  validateConfig,
} from "../../lib/policy.mjs";
import { GOVERNANCE_VERSION } from "./canonical.mjs";
import { SUPPORTED_GOVERNANCE_VERSIONS } from "./ledger.mjs";

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
/**
 * M12/T9 F-185: the governance revisions a backup manifest may carry.
 *
 * The revision a manifest RECORDS is the authoritative constant
 * (`GOVERNANCE_VERSION`, `topology/lib/canonical.mjs`): it is the revision the
 * machinery that captured those bytes was running, so the restore evidence
 * attributes the bytes to the revision that produced them.
 *
 * The revisions a manifest may CARRY are every revision the machinery
 * actually wrote: the published lineage (`SUPPORTED_GOVERNANCE_VERSIONS`,
 * derived from the ledger-event contract - the one declaration of the
 * governance versions this repository publishes) plus the current
 * authoritative revision. So a manifest written under an earlier revision
 * still restores, and bumping the constant never retroactively invalidates a
 * real written manifest - which is exactly what a frozen literal did.
 */
export function isWrittenGovernanceVersion(value) {
  return (
    typeof value === "string" &&
    (value === GOVERNANCE_VERSION ||
      SUPPORTED_GOVERNANCE_VERSIONS.includes(value))
  );
}

/**
 * M12/T9 F-369: the pre-apply ceremony refuses a NESTED governance root.
 *
 * A caller that passed the ledger root as the state root minted a second,
 * empty, permission-valid governance root INSIDE the real one
 * (`<state>/operator/m7-t2/ledger/operator/m7-t2/ledger/`). The live host
 * still carries that artifact, and nothing in the apply ceremony noticed: the
 * real ledger reads intact while a second root sits beside it, and every
 * reader of the state root has to decide which one is the truth.
 *
 * The ledger's own `LEDGER_ROOT_ALREADY_JOINED` guard refuses a state root
 * that already ends with the ledger suffix, but it runs in the plugin, at
 * runtime - after the ceremony has already shaped the tree. This refusal runs
 * in the ceremony itself, before any write: a nested ledger root inside the
 * real one is an operator decision (the artifact is live state; removing it is
 * not this ceremony's to do), so the ceremony fails closed and names it.
 */
function assertNoNestedLedgerRoot(stateDir) {
  const nested = path.join(
    stateDir,
    "operator",
    "m7-t2",
    "ledger",
    "operator",
    "m7-t2",
    "ledger",
  );
  if (!existsSync(nested)) return;
  const holdsLedger =
    existsSync(path.join(nested, "events.jsonl")) ||
    existsSync(path.join(nested, "snapshot.json"));
  if (!holdsLedger) return;
  throw new Error(
    `BACKUP_NESTED_LEDGER_ROOT_PRESENT: ${nested} (a second, empty governance root inside the real one; move that directory out of the state root — this ceremony never deletes live state)`,
  );
}

/**
 * M12/T9 F-131: the deployed asset set, DERIVED from the packager.
 *
 * The enumerator used to carry its own hand-written list of what a plugin
 * tree may contain - four root files and a name pattern per directory - while
 * the packager (`governancePluginFiles()`) ships a different, larger set. Every
 * governed asset the enumerator did not know was therefore an unexplained
 * hard failure of `configure.mjs --apply` and of the rollback in
 * `restoreT1RuntimeFiles`, and the rollback guard fired before the quarantine
 * move, so the tree could not even be rolled back.
 *
 * The list is now the packager's own: the files it deploys, the three files
 * it writes beside them, and the directories those files live in. Adding a
 * governed asset - a new `lib/` module, a runtime module that travels in
 * `zink-skill-store/` or `zink-tools/`, a contract - can no longer fail the
 * enumerator, because the enumerator asks the packager what it ships.
 *
 * Symlinks are still refused, and anything OUTSIDE the deployed set is still
 * refused - the refusal now names the offending relative path, so an operator
 * sees which file to act on instead of a bare code.
 */
let governedAssetSet = null;
function governedPluginAssets() {
  if (governedAssetSet) return governedAssetSet;
  const { assets } = governancePluginFiles();
  const files = new Set([
    ...Object.keys(assets),
    // The three files the packager writes beside the assets it materializes.
    "index.mjs",
    "openclaw.plugin.json",
    "package.json",
  ]);
  const directories = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1)
      directories.add(parts.slice(0, index).join("/"));
  }
  governedAssetSet = { files, directories };
  return governedAssetSet;
}
function pluginFiles(root, relative = "") {
  if (!existsSync(root)) return [];
  noLinks(root);
  const { files, directories } = governedPluginAssets();
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(`BACKUP_SYMLINK_DENIED: ${name}`);
      if (entry.isDirectory()) {
        if (!directories.has(name))
          throw new Error(`BACKUP_UNEXPECTED_PLUGIN_CONTENT: ${name}`);
        return pluginFiles(root, name);
      }
      if (!entry.isFile() || !files.has(name))
        throw new Error(`BACKUP_UNEXPECTED_PLUGIN_CONTENT: ${name}`);
      return [name];
    })
    .sort();
}
/**
 * M12/T9 F-370: the plugin trees the loader finds beside the governed one.
 *
 * The loader scans `<stateDir>/extensions/`, so a tree left there under
 * another directory name still registers as a candidate for the governed
 * plugin id, and the copy that executes is decided by origin precedence
 * rather than by the deployment record.
 *
 * The live host's own convention - measured read-only on 2026-10-21 - is a
 * sibling directory named `<plugin-id>-<reason>-<YYYYMMDD>` that KEEPS the
 * governed manifest id, so it is a displaced tree by exactly this rule. The
 * runbook `docs/runbooks/governed-plugin-quarantine.md` is its tracked name.
 */
export function findDisplacedPluginTrees(
  stateDir,
  pluginId = "zink-governance",
) {
  const extensionsRoot = path.join(stateDir, "extensions");
  if (!existsSync(extensionsRoot)) return [];
  noLinks(extensionsRoot);
  const displaced = [];
  for (const entry of readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (entry.name === pluginId) continue;
    if (!entry.isDirectory()) continue;
    const directory = path.join(extensionsRoot, entry.name);
    const manifestPath = path.join(directory, "openclaw.plugin.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
    if (manifest?.id !== pluginId) continue;
    displaced.push(directory);
  }
  return displaced.sort();
}

/**
 * M12/T9 F-370: move a displaced tree OUT of the directory the loader scans.
 *
 * M12/T9 F-421: every destination is checked before any tree is moved, and a
 * rename that fails after an earlier one committed undoes the committed moves
 * in reverse order. Without that undo the first tree was quarantined while the
 * rest stayed live — a duplicate plugin id with stale code — so the ceremony
 * is all-or-nothing above one element too. `rename` is injectable because the
 * mid-loop fault is the only way to prove the undo.
 */
export function quarantineDisplacedPluginTrees(
  stateDir,
  pluginId = "zink-governance",
  { rename = renameSync } = {},
) {
  const displaced = findDisplacedPluginTrees(stateDir, pluginId);
  if (displaced.length === 0) return [];
  const destination = path.join(
    runtimeBackupPath(stateDir),
    "quarantined-t2",
    "extensions",
  );
  noLinks(destination);
  const moves = displaced.map((source) => ({
    source,
    target: path.join(destination, path.basename(source)),
  }));
  for (const move of moves) {
    noLinks(move.source);
    noLinks(move.target);
    if (existsSync(move.target)) {
      throw new Error("RESTORE_QUARANTINE_CONFLICT");
    }
  }
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const moved = [];
  try {
    for (const move of moves) {
      rename(move.source, move.target);
      moved.push(move);
      syncDirectory(path.dirname(move.source));
      syncDirectory(path.dirname(move.target));
    }
  } catch (error) {
    for (const move of moved.reverse()) {
      try {
        rename(move.target, move.source);
        syncDirectory(path.dirname(move.source));
        syncDirectory(path.dirname(move.target));
      } catch {
        /* the original failure is the honest cause; a failed undo is residue */
      }
    }
    throw error;
  }
  return moves.map((move) => ({ from: move.source, to: move.target }));
}

export function runtimeBackupPath(stateDir) {
  return path.join(stateDir, "operator", "m7-t2", "backups", "r12");
}

// Operator-only artifact construction. No auth store, backing SecretRef value,
// identity key or transcript is read/copied. Caller supplies T1-bound IDs.
export async function createRuntimeBackup({ stateDir, identifiers }) {
  if (!path.isAbsolute(stateDir))
    throw new Error("BACKUP_ABSOLUTE_PATH_REQUIRED");
  // M12/T9 F-369: the ceremony refuses a nested governance root BEFORE it
  // shapes or writes anything.
  assertNoNestedLedgerRoot(stateDir);
  const root = runtimeBackupPath(stateDir);
  noLinks(root);
  if (existsSync(root)) {
    // M12/T9 F-370: the deploy ceremony moves a displaced plugin tree out of
    // the directory the loader scans, on every apply - not only on the first.
    quarantineDisplacedPluginTrees(stateDir);
    return verifyRuntimeBackup({ stateDir, identifiers });
  }
  const configPath = path.join(stateDir, "openclaw.json");
  noLinks(configPath);
  if (existsSync(configPath)) {
    // Validate before capturing: config must contain references, never raw keys.
    validateConfig(parseJson(readFileSync(configPath, "utf8")), {
      stateDir,
      identifiers,
    });
  }
  // M10/T2-R22: bound the subprocess in TIME as well as in output size.
  //
  // `maxBuffer` caps what git may RETURN; it does nothing about git never
  // returning. This call sits on the synchronous `configure.mjs --apply` critical
  // path (`createRuntimeBackup` is invoked from there), so a `git show` blocked on
  // a slow filesystem or a held index lock would hang the apply indefinitely with
  // no bound and no error. Every other subprocess on an operator path in this
  // repository sets an explicit timeout — `operator-preflight.mjs` uses 30s,
  // `operator-apply.mjs` 60s, `native-patch-probe.mjs` 10s — and `verify.mjs`
  // enforces both a timeout and an output cap via `execFileBounded`. Reading a
  // single blob is normally instant, so 30s is generous; exceeding it is a real
  // fault worth surfacing rather than hanging on.
  const source = execFileSync(
    "git",
    ["show", `${T1_SHA}:integrations/openclaw/lib/policy.mjs`],
    {
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
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
    // M12/T9 F-185: the revision that captured these bytes, from the one
    // authoritative source - never a frozen literal.
    governance_version: GOVERNANCE_VERSION,
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
  // M12/T9 F-370: the deploy ceremony moves a displaced plugin tree out of
  // the directory the loader scans. A tree that stays there registers as a
  // second candidate for the governed plugin id, and which copy runs is then
  // decided by origin precedence instead of by the deployment record.
  quarantineDisplacedPluginTrees(stateDir);
  return verifyRuntimeBackup({ stateDir, identifiers });
}

export async function verifyRuntimeBackup({ stateDir, identifiers }) {
  const root = runtimeBackupPath(stateDir);
  noLinks(root);
  const manifestPath = path.join(root, "manifest.json");
  noLinks(manifestPath);
  const manifest = parseJson(readFileSync(manifestPath, "utf8"));
  if (
    // M12/T9 F-185: the manifest may carry ANY revision the machinery wrote,
    // so a manifest written under an earlier revision still restores and
    // bumping the authoritative constant never invalidates real evidence.
    !isWrittenGovernanceVersion(manifest.governance_version) ||
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
  // M12/T9 F-131: the manifest may only name the files the packager deploys
  // (plus the config and the workspace instructions), derived from the same
  // source the enumerator uses.
  const pluginPrefix = "extensions/zink-governance/";
  const { files: governedFiles } = governedPluginAssets();
  for (const entry of manifest.files) {
    const governed =
      entry.relative === "openclaw.json" ||
      AGENT_IDS.some((id) => entry.relative === `workspaces/${id}/AGENTS.md`) ||
      (entry.relative.startsWith(pluginPrefix) &&
        governedFiles.has(entry.relative.slice(pluginPrefix.length)));
    if (!governed) throw new Error(`BACKUP_TARGET_DENIED: ${entry.relative}`);
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

/**
 * M12/T9 F-147: the EXPECTED post-restore state of every manifest entry.
 *
 * The T1 baseline is the T1 CONFIG plus the ABSENCE of the T2 artifacts, so
 * the expectation is derived from the MANIFEST - the evidence the backup
 * captured - and never from what the restore happens to produce:
 *
 *   - `openclaw.json` -> the T1 fallback (the manifest's `t1_config_digest`);
 *   - every other entry the manifest recorded as present -> its captured
 *     preimage, byte for byte;
 *   - every other entry the manifest recorded as absent -> absent.
 */
function expectedRestoreState(manifest) {
  const expected = new Map();
  for (const entry of manifest.files) {
    if (entry.relative === "openclaw.json") {
      expected.set(entry.relative, {
        existed: true,
        digest: manifest.t1_config_digest,
      });
      continue;
    }
    if (!entry.existed) {
      expected.set(entry.relative, { existed: false, digest: null });
      continue;
    }
    expected.set(entry.relative, { existed: true, digest: entry.digest });
  }
  return expected;
}

/**
 * The live state against the expectation, by path. An empty list is the only
 * state in which the restore may report `filesRestored: true`.
 */
function restoreMismatches(expected, stateDir) {
  const mismatches = [];
  for (const [relative, want] of expected) {
    const target = path.join(stateDir, relative);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (!want.existed) {
      if (stat) mismatches.push(relative);
      continue;
    }
    if (!stat || !stat.isFile()) {
      mismatches.push(relative);
      continue;
    }
    if (digest(readFileSync(target)) !== want.digest) mismatches.push(relative);
  }
  return mismatches.sort();
}

// Operator step only: native preimages must be restored before this step and the
// scoped gateway restarted/verified afterwards. Never reports a live rollback PASS.
export async function restoreT1RuntimeFiles({ stateDir, identifiers }) {
  await verifyRuntimeBackup({ stateDir, identifiers });
  const root = runtimeBackupPath(stateDir);
  const manifest = parseJson(
    readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const fallback = readFileSync(path.join(root, "t1-config.json"));
  const config = path.join(stateDir, "openclaw.json");
  const quarantine = path.join(root, "quarantined-t2");
  noLinks(quarantine);
  // M12/T9 F-370: a displaced tree is moved out of the scanned directory by
  // the rollback too, or the loader keeps two candidates for the governed
  // plugin id after the active tree is quarantined.
  const displaced = findDisplacedPluginTrees(stateDir);
  const displacedRelative = new Set(
    displaced.map((directory) =>
      path.relative(stateDir, directory).split(path.sep).join("/"),
    ),
  );
  const targets = [
    ...AGENT_IDS.map((id) => `workspaces/${id}/AGENTS.md`),
    "extensions/zink-governance",
    ...displacedRelative,
  ];
  // F-147: the expectation is derived from the manifest, so `filesRestored`
  // can only be reported when the live bytes match the evidence the backup
  // captured.
  const expected = expectedRestoreState(manifest);
  const manifestEntry = (relative) =>
    manifest.files.find((entry) => entry.relative === relative);
  /**
   * A target that is ALREADY RESTORED is not quarantined again: its earlier
   * content is already preserved in the quarantine artifact and re-quarantining
   * it would destroy that copy. The discriminator is the quarantine artifact's
   * own presence, not the digest: the first restore preserves the live content
   * and re-installs the preimage, and the second restore finds both the
   * preserved copy and the restored file.
   */
  const alreadyRestored = (relative) => {
    const entry = manifestEntry(relative);
    if (!entry?.existed) return false;
    if (!existsSync(path.join(quarantine, relative))) return false;
    return digest(readFileSync(path.join(stateDir, relative))) === entry.digest;
  };
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
      // A displaced tree is LEAVING the scanned directory, so its content is
      // not the deployed asset set and is not enumerated as one.
      if (!displacedRelative.has(relative)) pluginFiles(source);
    } else if (!stat.isFile()) throw new Error("RESTORE_TARGET_INVALID");
    if (!relative.startsWith("extensions/") && alreadyRestored(relative))
      continue;
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
    try {
      renameSync(temporary, config);
    } catch (cause) {
      // F-163: the restore temp has a FIXED name, so a residue left by an
      // interrupted write makes every later restore refuse with
      // RESTORE_TEMP_CONFLICT forever. The temp is removed on the failure
      // path, so a failed restore leaves no residue and the next one runs.
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!["ENOENT", "EPERM", "EISDIR"].includes(error?.code)) throw error;
      }
      throw cause;
    }
    syncDirectory(stateDir);
  }
  chmodSync(config, 0o600);
  for (const relative of targets) {
    const source = path.join(stateDir, relative);
    if (!existsSync(source)) continue;
    if (!relative.startsWith("extensions/") && alreadyRestored(relative))
      continue;
    const destination = path.join(quarantine, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    renameSync(source, destination);
    syncDirectory(path.dirname(source));
    syncDirectory(path.dirname(destination));
  }
  // F-147: RE-INSTALL the captured preimages. The quarantine preserves the T2
  // content, and the preimage is what the runtime goes back to - so the
  // post-restore state is the state the backup captured, not a state in which
  // the captured files are simply gone.
  for (const entry of manifest.files) {
    if (entry.relative === "openclaw.json" || !entry.existed) continue;
    const target = path.join(stateDir, entry.relative);
    if (existsSync(target)) continue;
    const preimage = path.join(root, "preimages", entry.relative);
    noLinks(preimage);
    const body = readFileSync(preimage);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, body);
    chmodSync(target, entry.mode);
    syncDirectory(path.dirname(target));
  }
  const mismatches = restoreMismatches(expected, stateDir);
  if (mismatches.length > 0)
    throw new Error(
      `RESTORE_VERIFICATION_FAILED: ${mismatches.length} restored file(s) do not match the captured preimage`,
    );
  return {
    filesRestored: true,
    liveBaselineValidation: "NOT RUN",
    gatewayRestartRequired: true,
  };
}
