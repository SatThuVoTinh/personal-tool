#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

import { catalogError, getActiveSkill, scanCatalog } from "../src/catalog.mjs";

const canonicalSkillsRoot = fileURLToPath(
  new URL("../skills/", import.meta.url),
);

function response(exitCode, value, stream) {
  return {
    exitCode,
    stderr: stream === "stderr" ? `${JSON.stringify(value)}\n` : "",
    stdout: stream === "stdout" ? `${JSON.stringify(value)}\n` : "",
  };
}

function cliError(message) {
  return response(
    4,
    { error: { code: "CLI_INPUT_INVALID", message, details: [] } },
    "stderr",
  );
}

/**
 * Maps a thrown error onto the CLI's error envelope.
 *
 * M12/T9-R1 F-096: the catch used to have no binding at all, so `error.code`
 * and `error.details` were unreachable BY CONSTRUCTION and every failure
 * answered the same blanket `OPERATIONAL_FAILURE` with an empty details
 * list. A caller could therefore not tell "your input is invalid" (retryable)
 * from "the tree is poisoned" (needs an operator) without parsing prose.
 *
 * The governed writer (`catalog.mjs`'s `writerError`) classifies every
 * refusal with a `code` and a machine-readable `details` list, and that
 * shape is what identifies a classified failure here. Anything else is an
 * unexpected fault and keeps the blanket code.
 */
export function classifyCliError(error) {
  if (Array.isArray(error?.details)) {
    return {
      code:
        typeof error?.code === "string" && error.code
          ? error.code
          : "OPERATIONAL_FAILURE",
      message:
        typeof error?.message === "string" && error.message
          ? error.message
          : "Skill Store operation failed.",
      details: error.details,
    };
  }
  return {
    code: "OPERATIONAL_FAILURE",
    message: "Skill Store operation failed.",
    details: [],
  };
}

function parseGet(args) {
  if (args.length !== 4) return null;
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !new Set(["--namespace", "--capability"]).has(flag) ||
      values.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      return null;
    values.set(flag, value);
  }
  const namespace = values.get("--namespace");
  const capability = values.get("--capability");
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (
    !namespace ||
    !capability ||
    namespace.split("/").length > 8 ||
    !namespace.split("/").every((segment) => slug.test(segment)) ||
    !slug.test(capability)
  )
    return null;
  return { namespace, capability };
}

export async function executeCli(args, skillsRoot = canonicalSkillsRoot) {
  try {
    if (args.length === 1 && args[0] === "validate") {
      const catalog = await scanCatalog(skillsRoot);
      return catalog.errors.length > 0
        ? response(2, catalogError(catalog.errors), "stderr")
        : response(
            0,
            { status: "valid", manifest_count: catalog.records.length },
            "stdout",
          );
    }
    if (args[0] === "get") {
      const options = parseGet(args.slice(1));
      if (!options) return cliError("Invalid skill-store get arguments.");
      const result = await getActiveSkill(
        skillsRoot,
        options.namespace,
        options.capability,
      );
      if (result.errors.length > 0)
        return response(2, catalogError(result.errors), "stderr");
      if (!result.skill)
        return response(
          3,
          {
            error: {
              code: "ACTIVE_SKILL_NOT_FOUND",
              message: "No exact ACTIVE skill was found.",
              details: [],
            },
          },
          "stderr",
        );
      return response(
        0,
        {
          skill: {
            manifest: result.skill.manifest,
            markdown: result.skill.markdown,
          },
        },
        "stdout",
      );
    }
    return cliError("Invalid skill-store command.");
  } catch (error) {
    const classified = classifyCliError(error);
    return response(1, { error: classified }, "stderr");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await executeCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
