import { createHash } from "node:crypto";
import {
  readFileSync,
  lstatSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

// The OpenClaw releases this patch is verified against, keyed BY VERSION.
//
// A bundle hash only means something for the release that produced it: every
// OpenClaw release renames its bundles, so an unversioned hash table silently
// becomes a set of stale filenames the moment the host upgrades. Keying by
// version makes the trust anchor explicit, lets `inspectNativePatch` resolve the
// host to exactly one verified pin, and turns "the host moved" into a named
// condition instead of an unexplained missing file.
//
// Each entry is established by reading the release, not by hashing whatever is
// on disk: the anchors must be present and UNIQUE (replaceOnce enforces
// uniqueness), each injection point must be the same code path it was chosen
// for, and the run-id prerequisite must be positively identified as the module
// that derives `runId` from the request idempotency key.
export const NATIVE_RUNTIME_PINS = Object.freeze({
  "2026.6.34": Object.freeze({
    runIdSource: "dist/agent-FRfbCcij.js",
    runIdSourceSha256:
      "7972dc078d111d2b4132589ce85c0881f2a56583297c221f62b83f2cee465f25",
    sources: Object.freeze({
      "selection-DopzNY3I.js": Object.freeze({
        role: "selection",
        sha256:
          "a5698c5523e87ad454cf89e4a5c940689403f7b6eac6f3d14c7205f1e3071ed6",
      }),
      "subagent-announce-Bh1QyKiE.js": Object.freeze({
        role: "announce",
        sha256:
          "764e6ffa2524a03cd8a5d15a8621cb5594f733a91f05311e45b012b727077994",
      }),
    }),
  }),
  "2026.7.1-2": Object.freeze({
    // Verified: all 10 anchors present and unique; `const activeSession =
    // session;` still follows session resolution before the turn,
    // `const acceptedSessionSpawns = ...` still follows the llm_output hook at
    // run end, and the two announce anchors are still the descendant-wake and
    // completion gates.
    runIdSource: "dist/subagent-control-CXT-voKm.js",
    // Verified: this module performs
    //   `const idempotencyKey = crypto.randomUUID(); let runId = idempotencyKey;`
    // i.e. it is the native agent handler that binds runId to the request
    // idempotency key used by the scoped announce transformation.
    runIdSourceSha256:
      "d11cf9e48cc63f88716a7cb6c8e81d9188469d76af4ab4f691d9934cf1d2e140",
    sources: Object.freeze({
      "selection-JInn13lc.js": Object.freeze({
        role: "selection",
        sha256:
          "ccff13111aa60369ac9d88b526a58a7df1f733f1d99d205c01c6186036957e66",
      }),
      "subagent-announce-BH7YpLmx.js": Object.freeze({
        role: "announce",
        sha256:
          "03f150dff16b9ce8679b0d27f697f3b6dd7726cfa0a4f65d329b9364cb307169",
      }),
    }),
  }),
});

// The release the deployment was originally pinned to. Kept as a named constant
// because the README/runbook and the migration path both refer to it.
export const NATIVE_PINNED_RUNTIME_VERSION = "2026.6.34";
// Every release this patch may be applied to.
export const NATIVE_SUPPORTED_RUNTIME_VERSIONS = Object.freeze(
  Object.keys(NATIVE_RUNTIME_PINS),
);
// The pin used when no host version has been resolved.
export const NATIVE_SOURCE_BASELINE =
  NATIVE_RUNTIME_PINS[NATIVE_PINNED_RUNTIME_VERSION].sources;
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

const selectionAnchor = "\t\t\tconst activeSession = session;";
const selectionPatch = `${selectionAnchor}
\t\t\tawait enterNativeRun(params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId,
\t\t\t\tinputProvenance: params.inputProvenance,
\t\t\t\tchannelId: params.messageChannel ?? params.messageProvider,
\t\t\t\tsenderId: params.senderId, currentMessageId: params.currentMessageId,
\t\t\t\ttrigger: params.trigger, transcriptPrompt: params.transcriptPrompt
\t\t\t}, params.abortSignal);
\t\t\tinstallNativeToolGate(activeSession.agent, params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId
\t\t\t});`;
const wakeAnchor = "\t\t\tif (await wakeSubagentRunAfterDescendants({";
const wakePatch = `\t\t\tconst zinkWakeGate = await gateNativeAnnounce(subagentAnnounceDeps.getRuntimeConfig(), {
\t\t\t\tphase: "descendant_wake", childSessionKey: params.childSessionKey,
\t\t\t\tchildRunId: params.childRunId, requesterSessionKey: targetRequesterSessionKey,
\t\t\t\tnextRunId: buildAnnounceIdempotencyKey(\`\${wakeAnnounceId}:wake\`),
\t\t\t\tfindings: childCompletionFindings, outcome
\t\t\t}, params.signal);
\t\t\tif (zinkWakeGate.governed && zinkWakeGate.action !== "deliver") {
\t\t\t\tshouldDeleteChildSession = false;
\t\t\t\treturn zinkWakeGate.action === "discard";
\t\t\t}
${wakeAnchor}`;
const finalAnchor =
  "\t\tconst replyInstruction = buildAnnounceReplyInstruction({";
const finalPatch = `\t\tconst zinkCompletionGate = await gateNativeAnnounce(subagentAnnounceDeps.getRuntimeConfig(), {
\t\t\tphase: "completion", childSessionKey: params.childSessionKey,
\t\t\tchildRunId: params.childRunId, requesterSessionKey: targetRequesterSessionKey,
\t\t\tnextRunId: buildAnnounceIdempotencyKey(announceId),
\t\t\tfindings, outcome
\t\t}, params.signal);
\t\tif (zinkCompletionGate.governed) {
\t\t\tshouldDeleteChildSession = false;
\t\t\tif (zinkCompletionGate.action !== "deliver") return zinkCompletionGate.action === "discard";
\t\t\tfindings = zinkCompletionGate.receipt;
\t\t}
${finalAnchor}`;

// The edit sets are defined ONCE, by the ROLE a bundle plays, and each release's
// pin references a role. Duplicating the patch text per release would let two
// releases drift apart in exactly the way the duplicated-policy findings
// describe, so the text lives here and only the filenames+hashes are per-release.
const SELECTION_EDITS = [
  [
    "import { a as normalizeLowercaseStringOrEmpty",
    'import { enterNativeRun, installNativeToolGate, finishNativeRun, sanitizeNativePrompt } from "./zink-governance-boundary.mjs";\nimport { a as normalizeLowercaseStringOrEmpty',
  ],
  [
    "async function runEmbeddedAttempt(params) {",
    "async function runEmbeddedAttempt(params) {\n\tparams = { ...params, prompt: await sanitizeNativePrompt(params.config, params.prompt) };",
  ],
  [selectionAnchor, selectionPatch],
  [
    "\t\t\tconst acceptedSessionSpawns = getAcceptedSessionSpawns();",
    `\t\t\tawait finishNativeRun(params.config, {
\t\t\t\tlastAssistant, yielded: yieldDetected,
\t\t\t\tsuccess: !aborted && !promptError && !timedOut && !idleTimedOut,
\t\t\t\ttimedOut: timedOut || idleTimedOut,
\t\t\t\t// Provider usage for the completed turn, when the runtime reports it.
\t\t\t\t// Absent is normal: the quota seam then stays "unknown", which already
\t\t\t\t// keeps the PRIMARY model.
\t\t\t\tusage: typeof attemptUsage === "undefined" ? null : attemptUsage
\t\t\t}, { agentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId });
\t\t\tconst acceptedSessionSpawns = getAcceptedSessionSpawns();`,
  ],
];

const ANNOUNCE_EDITS = [
  [
    "import { c as normalizeOptionalString }",
    'import { gateNativeAnnounce } from "./zink-governance-boundary.mjs";\nimport { c as normalizeOptionalString }',
  ],
  [
    "\t\t\t\tfindings: childCompletionFindings,",
    "\t\t\t\tfindings: zinkWakeGate.governed ? zinkWakeGate.receipt : childCompletionFindings,",
  ],
  [wakeAnchor, wakePatch],
  [
    "\t\tif (!childCompletionFindings) {",
    '\t\tif (subagentAnnounceDeps.getRuntimeConfig()?.plugins?.entries?.["zink-governance"]?.enabled === true) childCompletionFindings = void 0;\n\t\tif (!childCompletionFindings) {',
  ],
  [
    '\t\tconst findings = childCompletionFindings || reply || "(no output)";',
    '\t\tlet findings = childCompletionFindings || reply || "(no output)";',
  ],
  [finalAnchor, finalPatch],
];

const EDITS_BY_ROLE = Object.freeze({
  selection: SELECTION_EDITS,
  announce: ANNOUNCE_EDITS,
});

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("NATIVE_PATCH_ANCHOR_MISMATCH");
  return source.replace(before, () => after);
}

export function transformNativeSource(file, source, version) {
  // Resolve the edit set and the expected hash from the pin for the release the
  // caller resolved, never from a single global table: that is what made a host
  // on a newer release look like an unexplained missing file.
  const pin = NATIVE_RUNTIME_PINS[version];
  const entry = pin?.sources?.[file];
  if (!entry) throw new Error("NATIVE_PATCH_TARGET_DENIED");
  const edits = EDITS_BY_ROLE[entry.role];
  if (!edits) throw new Error("NATIVE_PATCH_TARGET_DENIED");
  if (sha256(source) === entry.sha256) {
    const after = edits.reduce(
      (text, [before, replacement]) => replaceOnce(text, before, replacement),
      source,
    );
    return {
      state: "BASELINE",
      before: source,
      after,
      beforeDigest: sha256(source),
      afterDigest: sha256(after),
    };
  }
  // Already-patched is accepted only if exact inverse restores the frozen hash.
  let before;
  try {
    before = [...edits]
      .reverse()
      .reduce(
        (text, [original, replacement]) =>
          replaceOnce(text, replacement, original),
        source,
      );
  } catch {
    throw new Error("NATIVE_SOURCE_DRIFT");
  }
  if (sha256(before) !== entry.sha256) throw new Error("NATIVE_SOURCE_DRIFT");
  return {
    state: "PATCHED",
    before,
    after: source,
    beforeDigest: sha256(before),
    afterDigest: sha256(source),
  };
}

/** The OpenClaw release installed under `root`, or null when unreadable. */
function resolveRuntimeVersion(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
      .version;
  } catch {
    return null;
  }
}

export function inspectNativePatch(root) {
  if (!path.isAbsolute(root)) throw new Error("NATIVE_ROOT_MUST_BE_ABSOLUTE");
  // Reject symlink ancestors before any source reads.
  let cursor = path.resolve(root);
  while (cursor !== path.dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error("NATIVE_ROOT_SYMLINK");
    cursor = path.dirname(cursor);
  }
  // The runtime version is read FIRST and resolves the pin. A host on a release
  // this patch has not been verified against is a NAMED condition, not a bare
  // ENOENT about a hashed filename: an unverified release must never be
  // patched, and the operator has to be told which releases are supported.
  let installedVersion = resolveRuntimeVersion(root);
  if (!installedVersion) throw new Error("NATIVE_MANIFEST_UNREADABLE");
  const pin = NATIVE_RUNTIME_PINS[installedVersion];
  if (!pin) {
    const error = new Error(
      `NATIVE_VERSION_MISMATCH: this patch is verified against OpenClaw ${NATIVE_SUPPORTED_RUNTIME_VERSIONS.join(", ")} but the host has ${installedVersion}. An unverified release is never patched; adding one is a separately authorized runtime migration.`,
    );
    error.code = "NATIVE_VERSION_MISMATCH";
    error.expected = NATIVE_SUPPORTED_RUNTIME_VERSIONS;
    error.actual = installedVersion;
    throw error;
  }

  // Fail closed with a governance code, never a raw filesystem error, when a
  // pinned prerequisite is absent.
  for (const target of [
    "package.json",
    "dist",
    pin.runIdSource,
    ...Object.keys(pin.sources).map((file) => path.join("dist", file)),
  ]) {
    const full = path.join(root, target);
    let stats;
    try {
      stats = lstatSync(full);
    } catch {
      const error = new Error(
        `NATIVE_SOURCE_DRIFT: pinned artifact ${target} is absent from OpenClaw ${installedVersion}`,
      );
      error.code = "NATIVE_SOURCE_DRIFT";
      error.artifact = target;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error("NATIVE_TARGET_SYMLINK");
  }
  if (
    sha256(readFileSync(path.join(root, pin.runIdSource))) !==
    pin.runIdSourceSha256
  )
    throw new Error("NATIVE_RUN_ID_SOURCE_DRIFT");
  return Object.fromEntries(
    Object.keys(pin.sources).map((file) => [
      file,
      transformNativeSource(
        file,
        readFileSync(path.join(root, "dist", file), "utf8"),
        installedVersion,
      ),
    ]),
  );
}

function assertNoLinks(target) {
  if (!path.isAbsolute(target)) throw new Error("NATIVE_PATH_MUST_BE_ABSOLUTE");
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  )
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error("NATIVE_PATH_SYMLINK");
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

function writeExclusive(file, contents, mode) {
  const fd = openSync(file, "wx", mode);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function replaceAtomic(file, contents, mode) {
  const temporary = `${file}.zink-r12-tmp`;
  assertNoLinks(file);
  writeExclusive(temporary, contents, mode);
  chmodSync(temporary, mode);
  renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}

const bridgeContents = () =>
  readFileSync(new URL("./native-boundary.mjs", import.meta.url), "utf8");
const bridgeFile = (root) =>
  path.join(root, "dist", "zink-governance-boundary.mjs");

export function checkNativePatch(root) {
  const inspection = inspectNativePatch(root);
  assertNoLinks(bridgeFile(root));
  if (
    !Object.values(inspection).every((entry) => entry.state === "PATCHED") ||
    !existsSync(bridgeFile(root)) ||
    sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
  )
    throw new Error("NATIVE_PATCH_INCOMPLETE");
  return { status: "PATCHED", files: Object.keys(inspection) };
}

// The backup manifest is built in ONE place. `restoreNativePatch` requires
// `runtime_version` to resolve a pin, and the two apply paths (fresh patch and
// re-take on an already-patched host) previously declared the manifest
// separately, so the fresh-patch manifest omitted the field and every backup
// taken while actually patching was unrestorable.
export function nativeBackupManifest(root) {
  return {
    version: "m7-t2-r12",
    runtime_root: path.resolve(root),
    // The OpenClaw release the backup was taken from. A restore has to
    // resolve the SAME pin that produced the patch, and the file names in
    // a backup are release-specific, so this is recorded explicitly rather
    // than assumed to be the currently-deployed one.
    runtime_version: resolveRuntimeVersion(root),
    bridge_digest: sha256(bridgeContents()),
    files: {},
  };
}

export function applyNativePatch(root, backupRoot) {
  const inspection = inspectNativePatch(root);
  if (Object.values(inspection).every((entry) => entry.state === "PATCHED")) {
    if (
      !existsSync(bridgeFile(root)) ||
      sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
    ) {
      assertNoLinks(bridgeFile(root));
      replaceAtomic(bridgeFile(root), bridgeContents(), 0o600);
    }
    if (backupRoot) {
      const manifestPath = path.join(backupRoot, "manifest.json");
      if (!existsSync(manifestPath)) {
        assertNoLinks(backupRoot);
        mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
        const manifest = nativeBackupManifest(root);
        for (const [file, entry] of Object.entries(inspection)) {
          const mode = lstatSync(path.join(root, "dist", file)).mode & 0o777;
          writeExclusive(path.join(backupRoot, file), entry.before, 0o600);
          manifest.files[file] = {
            before_digest: entry.beforeDigest,
            after_digest: entry.afterDigest,
            mode,
          };
        }
        writeExclusive(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          0o600,
        );
        syncDirectory(backupRoot);
        syncDirectory(path.dirname(backupRoot));
      }
    }
    return checkNativePatch(root);
  }
  if (!Object.values(inspection).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_PATCH_PARTIAL_STATE");
  assertNoLinks(bridgeFile(root));
  if (existsSync(bridgeFile(root)))
    throw new Error("NATIVE_BRIDGE_ALREADY_EXISTS");
  assertNoLinks(backupRoot);
  const relativeBackup = path.relative(root, backupRoot);
  if (!(
    relativeBackup === ".." ||
    relativeBackup.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeBackup)
  ))
    throw new Error("NATIVE_BACKUP_MUST_BE_EXTERNAL");
  mkdirSync(backupRoot, { mode: 0o700 }); // Never overwrite an earlier backup.
  const manifest = nativeBackupManifest(root);
  for (const [file, entry] of Object.entries(inspection)) {
    const mode = lstatSync(path.join(root, "dist", file)).mode & 0o777;
    writeExclusive(path.join(backupRoot, file), entry.before, 0o600);
    manifest.files[file] = {
      before_digest: entry.beforeDigest,
      after_digest: entry.afterDigest,
      mode,
    };
  }
  writeExclusive(
    path.join(backupRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o600,
  );
  syncDirectory(backupRoot);
  syncDirectory(path.dirname(backupRoot));
  try {
    writeExclusive(bridgeFile(root), bridgeContents(), 0o600);
    syncDirectory(path.join(root, "dist"));
    for (const [file, entry] of Object.entries(inspection)) {
      const target = path.join(root, "dist", file);
      if (sha256(readFileSync(target)) !== entry.beforeDigest)
        throw new Error("NATIVE_SOURCE_DRIFT");
      replaceAtomic(target, entry.after, manifest.files[file].mode);
    }
    return checkNativePatch(root);
  } catch (cause) {
    restoreNativePatch(root, backupRoot);
    throw new Error("NATIVE_APPLY_FAILED_RESTORED", { cause });
  }
}

export function restoreNativePatch(root, backupRoot) {
  assertNoLinks(root);
  assertNoLinks(backupRoot);
  assertNoLinks(path.join(backupRoot, "manifest.json"));
  const manifest = JSON.parse(
    readFileSync(path.join(backupRoot, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== "m7-t2-r12" ||
    manifest.runtime_root !== path.resolve(root) ||
    !NATIVE_RUNTIME_PINS[manifest.runtime_version] ||
    Object.keys(manifest.files).sort().join() !==
      Object.keys(NATIVE_RUNTIME_PINS[manifest.runtime_version].sources)
        .sort()
        .join()
  )
    throw new Error("NATIVE_BACKUP_MANIFEST_INVALID");
  const originals = {};
  // Validate every preimage/current target before restoring any file.
  for (const [file, expected] of Object.entries(manifest.files)) {
    const backup = path.join(backupRoot, file);
    const target = path.join(root, "dist", file);
    assertNoLinks(backup);
    assertNoLinks(target);
    const contents = readFileSync(backup, "utf8");
    const transformed = transformNativeSource(
      file,
      contents,
      manifest.runtime_version,
    );
    if (
      transformed.state !== "BASELINE" ||
      transformed.beforeDigest !== expected.before_digest ||
      transformed.afterDigest !== expected.after_digest ||
      !Number.isInteger(expected.mode) ||
      expected.mode < 0 ||
      expected.mode > 0o777
    )
      throw new Error("NATIVE_BACKUP_INVALID");
    if (
      ![expected.before_digest, expected.after_digest].includes(
        sha256(readFileSync(target)),
      )
    )
      throw new Error("NATIVE_RESTORE_CONFLICT");
    originals[file] = contents;
  }
  assertNoLinks(bridgeFile(root));
  if (
    existsSync(bridgeFile(root)) &&
    sha256(readFileSync(bridgeFile(root))) !== manifest.bridge_digest
  )
    throw new Error("NATIVE_BRIDGE_RESTORE_CONFLICT");
  for (const [file, contents] of Object.entries(originals))
    replaceAtomic(
      path.join(root, "dist", file),
      contents,
      manifest.files[file].mode,
    );
  if (existsSync(bridgeFile(root))) unlinkSync(bridgeFile(root));
  syncDirectory(path.join(root, "dist"));
  const restored = inspectNativePatch(root);
  if (!Object.values(restored).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_RESTORE_FAILED");
  return { status: "RESTORED", files: Object.keys(restored) };
}
