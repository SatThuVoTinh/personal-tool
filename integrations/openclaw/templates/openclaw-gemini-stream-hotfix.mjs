#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const OPENCLAW_HOTFIX_RELEASE = "2026.6.34";

const TRANSPORT_TRANSFORMATIONS = Object.freeze([
  Object.freeze({
    label: "abort and trailing-frame handling",
    before: `\t\twhile (true) {
\t\t\tif (signal?.aborted) throw new Error("Request was aborted");
\t\t\tconst { done, value } = await reader.read();
\t\t\tif (done) {
\t\t\t\tcompleted = true;
\t\t\t\tbreak;
\t\t\t}
\t\t\tbuffer += decoder.decode(value, { stream: true }).replace(/\\r/g, "");`,
    after: `\t\twhile (true) {
\t\t\tif (signal?.aborted) throw new Error("Request was aborted");
\t\t\tconst { done, value } = await reader.read();
\t\t\tif (signal?.aborted) throw new Error("Request was aborted");
\t\t\tif (done) {
\t\t\t\tbuffer += decoder.decode().replace(/\\r/g, "");
\t\t\t\tif (buffer.split("\\n").some((line) => line.startsWith("data:") && line.slice(5).trim().length > 0)) throw new Error("Google SSE stream ended with an incomplete frame");
\t\t\t\tcompleted = true;
\t\t\t\tbreak;
\t\t\t}
\t\t\tbuffer += decoder.decode(value, { stream: true }).replace(/\\r/g, "");`,
  }),
  Object.freeze({
    label: "terminal-reason state",
    before: `\t\t\t\tlet currentBlockIndex = -1;
\t\t\t\tconst toolCallBlocksById = /* @__PURE__ */ new Map();`,
    after: `\t\t\t\tlet currentBlockIndex = -1;
\t\t\t\tlet sawTerminalReason = false;
\t\t\t\tconst toolCallBlocksById = /* @__PURE__ */ new Map();`,
  }),
  Object.freeze({
    label: "terminal-reason capture",
    before: `\t\t\t\t\tif (typeof candidate?.finishReason === "string") {
\t\t\t\t\t\toutput.stopReason = mapStopReasonString(candidate.finishReason);`,
    after: `\t\t\t\t\tif (typeof candidate?.finishReason === "string" && candidate.finishReason !== "FINISH_REASON_UNSPECIFIED") {
\t\t\t\t\t\tsawTerminalReason = true;
\t\t\t\t\t\toutput.stopReason = mapStopReasonString(candidate.finishReason);`,
  }),
  Object.freeze({
    label: "missing-terminal rejection",
    before: `\t\t\t\tif (currentBlockIndex >= 0) pushTextBlockEnd(stream, output, currentBlockIndex);
\t\t\t\tfinalizeTransportStream({`,
    after: `\t\t\t\tif (currentBlockIndex >= 0) pushTextBlockEnd(stream, output, currentBlockIndex);
\t\t\t\tif (!sawTerminalReason && !options?.signal?.aborted) throw Object.assign(new Error("Google stream ended before a terminal finish reason"), {
\t\t\t\t\tcode: "STREAM_INCOMPLETE",
\t\t\t\t\ttype: "google_incomplete_stream"
\t\t\t\t});
\t\t\t\tfinalizeTransportStream({`,
  }),
]);

const ERROR_CLASSIFICATION_TRANSFORMATIONS = Object.freeze([
  Object.freeze({
    label: "incomplete assistant stream timeout classification",
    before: `\tserverError: [
\t\t"an error occurred while processing",`,
    after: `\tserverError: [
\t\t/^[\\w -]*stream ended (?:before (?:message_?stop|(?:a )?terminal (?:finish reason|response event|event))|without a terminal finish reason)[.!]?$/i,
\t\t"an error occurred while processing",`,
  }),
]);

const PAYLOAD_TRANSFORMATIONS = Object.freeze([
  Object.freeze({
    label: "errored assistant reasoning suppression",
    before: `\tconst reasoningText = suppressAssistantArtifacts || runAborted ? "" : assistantForPayload && params.reasoningLevel === "on" && params.thinkingLevel !== "off" ? extractAssistantThinking(assistantForPayload) : "";`,
    after: `\tconst reasoningText = suppressAssistantArtifacts || runAborted || lastAssistantNeedsErrorSurface ? "" : assistantForPayload && params.reasoningLevel === "on" && params.thinkingLevel !== "off" ? extractAssistantThinking(assistantForPayload) : "";`,
  }),
  Object.freeze({
    label: "errored assistant answer suppression",
    before: `\tconst answerTexts = suppressAssistantArtifacts || runAborted ? [] : (shouldUseCanonicalFinalAnswer ? [fallbackAnswerSourceText] : shouldPreferRawAnswerText && fallbackRawAnswerText ? [fallbackRawAnswerText] : hasAssistantTextPayload ? nonEmptyAssistantTexts : fallbackAnswerText ? [fallbackAnswerText] : []).filter((text) => !shouldSuppressRawErrorText(text));`,
    after: `\tconst answerTexts = suppressAssistantArtifacts || runAborted || lastAssistantNeedsErrorSurface ? [] : (shouldUseCanonicalFinalAnswer ? [fallbackAnswerSourceText] : shouldPreferRawAnswerText && fallbackRawAnswerText ? [fallbackRawAnswerText] : hasAssistantTextPayload ? nonEmptyAssistantTexts : fallbackAnswerText ? [fallbackAnswerText] : []).filter((text) => !shouldSuppressRawErrorText(text));`,
  }),
]);

const EMBEDDED_RUNNER_TRANSFORMATIONS = Object.freeze([
  Object.freeze({
    label: "errored assistant final evidence suppression",
    before: `\t\t\t\t\tconst finalAssistantVisibleText = resolveFinalAssistantVisibleText(sessionLastAssistant);
\t\t\t\t\tconst finalAssistantRawText = resolveFinalAssistantRawText(sessionLastAssistant);`,
    after: `\t\t\t\t\tconst finalAssistantStopReason = (sessionLastAssistant?.stopReason ?? "").trim().toLowerCase();
\t\t\t\t\tconst terminalAssistantCanOwnFinalText = finalAssistantStopReason !== "error" && finalAssistantStopReason !== "aborted";
\t\t\t\t\tconst finalAssistantVisibleText = terminalAssistantCanOwnFinalText ? resolveFinalAssistantVisibleText(sessionLastAssistant) : void 0;
\t\t\t\t\tconst finalAssistantRawText = terminalAssistantCanOwnFinalText ? resolveFinalAssistantRawText(sessionLastAssistant) : void 0;`,
  }),
  Object.freeze({
    label: "single terminal stop-reason projection",
    before: `\t\t\t\t\tconst timedOutDuringPrompt = timedOut && !timedOutDuringCompaction && !timedOutDuringToolExecution;
\t\t\t\t\tconst finalAssistantStopReason = (sessionLastAssistant?.stopReason ?? "").trim().toLowerCase();`,
    after: `\t\t\t\t\tconst timedOutDuringPrompt = timedOut && !timedOutDuringCompaction && !timedOutDuringToolExecution;`,
  }),
]);

export const OPENCLAW_HOTFIX_ARTIFACTS = Object.freeze([
  Object.freeze({
    id: "transport",
    fileName: "transport-stream-Cs5gt3Yy.js",
    originalSha256:
      "569565566e892c5d8a0d2b65b270a9266b3a8c00fa1dc8f6bb6fd5dafc57d294",
    patchedSha256:
      "0a28c70cc5d6c554236d24cb5597b076f252473609ed4e279fc7dd59fd2f2d67",
    transformations: TRANSPORT_TRANSFORMATIONS,
  }),
  Object.freeze({
    id: "error-classification",
    fileName: "sanitize-user-facing-text-DCd-Uriq.js",
    originalSha256:
      "a6ba882b8900a6e89659097598124cb5c8f37a83bd942d3d851e8c943e9eb5df",
    patchedSha256:
      "ed30e5dc00037b33491f7458e5ae531a1e182b54522cc88027c1be938b587277",
    transformations: ERROR_CLASSIFICATION_TRANSFORMATIONS,
  }),
  Object.freeze({
    id: "payloads",
    fileName: "payloads-CpuaeKbz.js",
    originalSha256:
      "1a957b607a04cb95e4d51cf26a909270c5c891a81249f0aa0534ec7ea6435aff",
    patchedSha256:
      "b11fcd454d247e8d23f676eef21391357f74fab7754753ee0f2b29f10e780933",
    transformations: PAYLOAD_TRANSFORMATIONS,
  }),
  Object.freeze({
    id: "embedded-runner",
    fileName: "embedded-agent-CGzgLLU-.js",
    originalSha256:
      "7b2d568c408240879eb998377090df11fe17780c5dc0eeb5d749f6bb147565f7",
    patchedSha256:
      "6979b5633dacf6ec1fa1ecc2469d5ce3f735bee4dbb021f3891575af4aad61da",
    transformations: EMBEDDED_RUNNER_TRANSFORMATIONS,
  }),
]);

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function artifactSpec(artifactId) {
  const spec = OPENCLAW_HOTFIX_ARTIFACTS.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!spec) throw new Error(`Unknown OpenClaw hotfix artifact: ${artifactId}`);
  return spec;
}

function occurrences(contents, needle) {
  return contents.split(needle).length - 1;
}

function replaceExactlyOnce(contents, before, after, label) {
  if (occurrences(contents, before) !== 1) {
    throw new Error(`Hotfix source shape mismatch at ${label}`);
  }
  return contents.replace(before, after);
}

export function patchContents(artifactId, contents) {
  let output = contents;
  for (const transformation of artifactSpec(artifactId).transformations) {
    output = replaceExactlyOnce(
      output,
      transformation.before,
      transformation.after,
      transformation.label,
    );
  }
  return output;
}

export function revertContents(artifactId, contents) {
  let output = contents;
  for (const transformation of [
    ...artifactSpec(artifactId).transformations,
  ].reverse()) {
    output = replaceExactlyOnce(
      output,
      transformation.after,
      transformation.before,
      transformation.label,
    );
  }
  return output;
}

export function assertPatchedInvariants(artifactId, contents) {
  for (const transformation of artifactSpec(artifactId).transformations) {
    if (
      occurrences(contents, transformation.before) !== 0 ||
      occurrences(contents, transformation.after) !== 1
    ) {
      throw new Error(`Hotfix invariant missing at ${transformation.label}`);
    }
  }
}

function resolveRuntime() {
  const expectedRoot = path.join(
    homedir(),
    ".local",
    "lib",
    "node_modules",
    "openclaw",
  );
  const binary = realpathSync(
    path.join(homedir(), ".local", "bin", "openclaw"),
  );
  const packageRoot = path.dirname(binary);
  if (packageRoot !== realpathSync(expectedRoot)) {
    throw new Error(
      "OpenClaw package root is outside the expected user-local install",
    );
  }
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  requireSupportedRelease(manifest.version);
  return OPENCLAW_HOTFIX_ARTIFACTS.map((spec) => {
    const filePath = path.join(packageRoot, "dist", spec.fileName);
    const entry = lstatSync(filePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(
        `OpenClaw hotfix target must be a regular non-symlink file: ${spec.fileName}`,
      );
    }
    return {
      spec,
      filePath,
      fileMode: entry.mode & 0o777,
      contents: readFileSync(filePath, "utf8"),
    };
  });
}

function writeAtomically(filePath, contents, fileMode) {
  const temporaryPath = `${filePath}.zink-hotfix-${process.pid}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", fileMode);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, fileMode);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original write failure.
      }
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temp path is absent after a successful rename or before creation.
    }
    throw error;
  }
}

export function requireSupportedRelease(version) {
  if (version !== OPENCLAW_HOTFIX_RELEASE) {
    throw new Error(
      `Unsupported OpenClaw version: expected ${OPENCLAW_HOTFIX_RELEASE}`,
    );
  }
}

export function requireKnownHash(artifactId, contents) {
  const spec = artifactSpec(artifactId);
  const digest = sha256(contents);
  if (digest !== spec.originalSha256 && digest !== spec.patchedSha256) {
    throw new Error(
      `OpenClaw hotfix target hash is not allowlisted: ${spec.fileName}`,
    );
  }
  return digest;
}

function classifyState(records) {
  const states = records.map(({ spec, contents }) => {
    const digest = requireKnownHash(spec.id, contents);
    return digest === spec.patchedSha256 ? "patched" : "original";
  });
  if (states.every((state) => state === "patched")) return "patched";
  if (states.every((state) => state === "original")) return "original";
  if (
    states[0] === "patched" &&
    states.slice(1).every((state) => state === "original")
  ) {
    return "r18-predecessor";
  }
  throw new Error(
    "OpenClaw hotfix artifacts are in an unsupported partial state",
  );
}

function desiredContents(record, desiredState) {
  const digest = sha256(record.contents);
  const desiredDigest =
    desiredState === "patched"
      ? record.spec.patchedSha256
      : record.spec.originalSha256;
  if (digest === desiredDigest) return record.contents;
  const output =
    desiredState === "patched"
      ? patchContents(record.spec.id, record.contents)
      : revertContents(record.spec.id, record.contents);
  if (sha256(output) !== desiredDigest) {
    throw new Error(
      `Transformed OpenClaw artifact hash mismatch: ${record.spec.fileName}`,
    );
  }
  return output;
}

function writeTransaction(records, desiredState) {
  const planned = records.map((record) => ({
    ...record,
    desired: desiredContents(record, desiredState),
  }));
  const changed = [];
  try {
    for (const record of planned) {
      if (record.desired === record.contents) continue;
      writeAtomically(record.filePath, record.desired, record.fileMode);
      changed.push(record);
    }
  } catch (error) {
    let rollbackError;
    for (const record of [...changed].reverse()) {
      try {
        writeAtomically(record.filePath, record.contents, record.fileMode);
      } catch (candidate) {
        rollbackError ??= candidate;
      }
    }
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "OpenClaw hotfix write and rollback both failed",
        { cause: error },
      );
    }
    throw error;
  }
}

function verifyRuntimeState(records, expectedState) {
  for (const { spec, filePath } of records) {
    const contents = readFileSync(filePath, "utf8");
    const expectedDigest =
      expectedState === "patched" ? spec.patchedSha256 : spec.originalSha256;
    if (sha256(contents) !== expectedDigest) {
      throw new Error(
        `OpenClaw hotfix post-write verification failed: ${spec.fileName}`,
      );
    }
    if (expectedState === "patched") {
      assertPatchedInvariants(spec.id, contents);
    }
  }
}

export function run(mode) {
  const records = resolveRuntime();
  const currentState = classifyState(records);
  if (mode === "check") {
    if (currentState !== "patched") {
      throw new Error("OpenClaw Gemini stream recovery hotfix is not applied");
    }
    verifyRuntimeState(records, "patched");
  } else if (mode === "apply") {
    writeTransaction(records, "patched");
    verifyRuntimeState(records, "patched");
  } else if (mode === "revert") {
    writeTransaction(records, "original");
    verifyRuntimeState(records, "original");
  } else {
    throw new Error("Select exactly one of --check, --apply, or --revert");
  }
  process.stdout.write(`PASS: Gemini stream recovery hotfix ${mode}\n`);
}

function main() {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length !== 1 ||
    !/^--(?:check|apply|revert)$/u.test(arguments_[0])
  ) {
    throw new Error(
      "Usage: openclaw-gemini-stream-hotfix.mjs --check|--apply|--revert",
    );
  }
  run(arguments_[0].slice(2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
