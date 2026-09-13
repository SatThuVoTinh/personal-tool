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

export const NATIVE_SOURCE_BASELINE = Object.freeze({
  "selection-DopzNY3I.js":
    "a5698c5523e87ad454cf89e4a5c940689403f7b6eac6f3d14c7205f1e3071ed6",
  "subagent-announce-Bh1QyKiE.js":
    "764e6ffa2524a03cd8a5d15a8621cb5594f733a91f05311e45b012b727077994",
});
// Read-only prerequisite: the native agent handler binds runId exactly to the
// request idempotency key used by the scoped announce transformation.
const RUN_ID_SOURCE = "dist/agent-FRfbCcij.js";
const RUN_ID_SOURCE_SHA256 =
  "7972dc078d111d2b4132589ce85c0881f2a56583297c221f62b83f2cee465f25";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

const selectionAnchor = "\t\t\tconst activeSession = session;";
const selectionPatch = `${selectionAnchor}
\t\t\tawait enterNativeRun(params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId,
\t\t\t\tinputProvenance: params.inputProvenance,
\t\t\t\tchannelId: params.messageChannel ?? params.messageProvider,
\t\t\t\tsenderId: params.senderId, currentMessageId: params.currentMessageId
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

const transformations = {
  "selection-DopzNY3I.js": [
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
\t\t\t\ttimedOut: timedOut || idleTimedOut
\t\t\t}, { agentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId });
\t\t\tconst acceptedSessionSpawns = getAcceptedSessionSpawns();`,
    ],
  ],
  "subagent-announce-Bh1QyKiE.js": [
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
  ],
};

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("NATIVE_PATCH_ANCHOR_MISMATCH");
  return source.replace(before, () => after);
}

export function transformNativeSource(file, source) {
  const edits = transformations[file];
  if (!edits) throw new Error("NATIVE_PATCH_TARGET_DENIED");
  if (sha256(source) === NATIVE_SOURCE_BASELINE[file]) {
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
  if (sha256(before) !== NATIVE_SOURCE_BASELINE[file])
    throw new Error("NATIVE_SOURCE_DRIFT");
  return {
    state: "PATCHED",
    before,
    after: source,
    beforeDigest: sha256(before),
    afterDigest: sha256(source),
  };
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
  for (const target of [
    "package.json",
    "dist",
    RUN_ID_SOURCE,
    ...Object.keys(NATIVE_SOURCE_BASELINE).map((file) =>
      path.join("dist", file),
    ),
  ])
    if (lstatSync(path.join(root, target)).isSymbolicLink())
      throw new Error("NATIVE_TARGET_SYMLINK");
  if (
    sha256(readFileSync(path.join(root, RUN_ID_SOURCE))) !==
    RUN_ID_SOURCE_SHA256
  )
    throw new Error("NATIVE_RUN_ID_SOURCE_DRIFT");
  if (
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
      .version !== "2026.6.34"
  )
    throw new Error("NATIVE_VERSION_MISMATCH");
  return Object.fromEntries(
    Object.keys(NATIVE_SOURCE_BASELINE).map((file) => [
      file,
      transformNativeSource(
        file,
        readFileSync(path.join(root, "dist", file), "utf8"),
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
        const manifest = {
          version: "m7-t2-r12",
          runtime_root: path.resolve(root),
          bridge_digest: sha256(bridgeContents()),
          files: {},
        };
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
  const manifest = {
    version: "m7-t2-r12",
    runtime_root: path.resolve(root),
    bridge_digest: sha256(bridgeContents()),
    files: {},
  };
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
    Object.keys(manifest.files).sort().join() !==
      Object.keys(NATIVE_SOURCE_BASELINE).sort().join()
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
    const transformed = transformNativeSource(file, contents);
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
