#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

import {
  catalogError,
  getActiveSkill,
  quarantineInvalidVersion,
  scanCatalog,
} from "../src/catalog.mjs";
import { applySkillStoreMigrations } from "../src/migrations.mjs";
import {
  retireSkill,
  syncSkillsToVectorStore,
  withSkillStoreWriterLock,
} from "../index.mjs";

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

/**
 * The `--flag value` pairs of one command line, or `null` when the shape is
 * wrong: an unknown flag, a repeated flag, a missing value or a value that
 * looks like the next flag.
 */
function parseFlagValues(args, flags) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flags.has(flag) ||
      values.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      return null;
    values.set(flag, value);
  }
  return values;
}

/** namespace/capability/version share one grammar across the CLI commands. */
function validIdentityFlags(namespace, capability, version) {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return Boolean(
    namespace &&
    capability &&
    version &&
    namespace.split("/").length <= 8 &&
    namespace.split("/").every((segment) => slug.test(segment)) &&
    slug.test(capability) &&
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version),
  );
}

/**
 * The `deprecate` arguments.
 *
 * M12/T9 F-095 (R5-E04-05) / H8: the governed retirement needs the identity of
 * the version to withdraw, the decision that authorized the withdrawal and
 * the actor that carried it out. The decision reference is NOT checked here:
 * the governed writer owns that grammar and answers `DECISION_REF_INVALID`,
 * so the CLI never invents a second rule for it.
 */
function parseDeprecate(args) {
  const flags = new Set([
    "--namespace",
    "--capability",
    "--version",
    "--decision-ref",
    "--actor",
    "--store-id",
  ]);
  const values = parseFlagValues(args, flags);
  if (!values) return null;
  const namespace = values.get("--namespace");
  const capability = values.get("--capability");
  const version = values.get("--version");
  const decisionRef = values.get("--decision-ref");
  const actor = values.get("--actor") ?? "owner";
  const storeId = values.get("--store-id");
  if (
    !validIdentityFlags(namespace, capability, version) ||
    !decisionRef ||
    !actor
  )
    return null;
  return { namespace, capability, version, decisionRef, actor, storeId };
}

/**
 * The `sync` arguments (M12/T9-R4 F-430).
 *
 * Only the optional store identity the F-544 gate demands: a store that
 * DECLARES an identity is synced only when the caller names it.
 */
function parseSync(args) {
  const values = parseFlagValues(args, new Set(["--store-id"]));
  if (!values) return null;
  return { storeId: values.get("--store-id") };
}

/**
 * The bounded derived-sync projection a CLI response carries (F-430).
 *
 * The full sync report lists every skill with its embedding diagnostics; the
 * CLI answers with the facts an operator acts on, never the whole report.
 */
function derivedSyncProjection(report) {
  return {
    status: report?.status ?? null,
    error_code: report?.error_code ?? null,
    tombstone_status: report?.tombstone_status ?? null,
    synced_count: report?.synced_count ?? 0,
    failed_count: report?.failed_count ?? 0,
    sync_generation_id: report?.sync_generation_id ?? null,
  };
}

/**
 * The `quarantine` arguments (M12/T9-R4 F-580).
 *
 * The repair names the one version directory to withdraw from canonical state.
 * It carries no decision reference and no actor: it publishes no governed
 * lifecycle transition and deletes nothing — it renames a directory the
 * catalog already refuses into the residue grammar, where its bytes stay
 * inspectable and the writer's sweep clears it.
 */
function parseQuarantine(args) {
  const values = parseFlagValues(
    args,
    new Set(["--namespace", "--capability", "--version"]),
  );
  if (!values) return null;
  const namespace = values.get("--namespace");
  const capability = values.get("--capability");
  const version = values.get("--version");
  if (!validIdentityFlags(namespace, capability, version)) return null;
  return { namespace, capability, version };
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
    // M12/T9 F-095 (R5-E04-05) / H8: the governed retirement. The owner
    // withdraws a wrong skill through this command instead of editing the
    // tree, and the state transition is recorded in the durable record.
    if (args[0] === "deprecate") {
      const options = parseDeprecate(args.slice(1));
      if (!options) return cliError("Invalid skill-store deprecate arguments.");
      const retired = await withSkillStoreWriterLock(skillsRoot, () =>
        retireSkill({
          skillsRoot,
          namespace: options.namespace.split("/"),
          capability: options.capability,
          version: options.version,
          ownerActor: options.actor,
          decisionRef: options.decisionRef,
        }),
      );
      const skill = {
        namespace: retired.namespace,
        capability: retired.capability,
        version: retired.version,
        retired_at: retired.retired_at,
        decision_ref: retired.decision_ref,
      };
      // M12/T9-R4 F-430: the retirement PROPAGATES in the same command.
      //
      // The canonical transition above committed under the writer lock, but
      // the adapter keeps serving the derived `status = 'ACTIVE' AND
      // sync_status = 'READY'` rows until a sync runs — and before this fix
      // the ONLY sync trigger was an unrelated plugin approval, so a retired
      // skill stayed searchable indefinitely. The sync runs OUTSIDE the lock
      // section: `syncSkillsToVectorStore` acquires the writer lock itself for
      // its scan-and-tombstone phase. A store that DECLARES an identity is
      // synced only when the operator names it (`--store-id`, the F-544 gate).
      //
      // A failed propagation is NEVER reported as success: the retirement is
      // canonically committed, so the envelope carries it plus the failed
      // sync under a named code and a non-zero exit, and `skill-store sync`
      // is the documented retry path.
      const derived = await syncSkillsToVectorStore({
        skillsRoot,
        ...(options.storeId ? { expectedStoreId: options.storeId } : {}),
      });
      if (derived.status === "FAILED") {
        return response(
          5,
          {
            error: {
              code: "DERIVED_SYNC_FAILED",
              message:
                "the retirement committed canonically but the derived-index sync failed; " +
                "re-run `skill-store sync` (with --store-id when the store declares an identity) to propagate it",
              details: [],
            },
            retired: skill,
            derived_sync: derivedSyncProjection(derived),
          },
          "stderr",
        );
      }
      return response(
        0,
        {
          status: retired.status,
          skill,
          derived_sync: derivedSyncProjection(derived),
        },
        "stdout",
      );
    }
    // M12/T9-R4 F-430: the derived-index sync as its own command. It is the
    // documented retry path when a deprecate's propagation failed (exit 5,
    // DERIVED_SYNC_FAILED): the canonical retirement is already committed, so
    // the operator re-runs THIS instead of waiting for an unrelated plugin
    // approval to sync.
    if (args[0] === "sync") {
      const options = parseSync(args.slice(1));
      if (!options) return cliError("Invalid skill-store sync arguments.");
      const report = await syncSkillsToVectorStore({
        skillsRoot,
        ...(options.storeId ? { expectedStoreId: options.storeId } : {}),
      });
      if (report.status === "FAILED") {
        return response(
          5,
          {
            error: {
              code: "DERIVED_SYNC_FAILED",
              message:
                report.error ??
                "the derived-index sync failed; nothing was propagated",
              details: [],
            },
            derived_sync: derivedSyncProjection(report),
          },
          "stderr",
        );
      }
      return response(
        0,
        { status: report.status, derived_sync: derivedSyncProjection(report) },
        "stdout",
      );
    }
    // M12/T9-R4 F-580: the repair for a canonical directory the catalog
    // refuses. Withdrawing it by rename into the residue grammar is what makes
    // the store readable again; deleting it is never an option.
    if (args[0] === "quarantine") {
      const options = parseQuarantine(args.slice(1));
      if (!options)
        return cliError("Invalid skill-store quarantine arguments.");
      const quarantined = await quarantineInvalidVersion({
        skillsRoot,
        namespace: options.namespace.split("/"),
        capability: options.capability,
        version: options.version,
      });
      return response(
        0,
        {
          status: quarantined.status,
          skill: {
            namespace: quarantined.namespace,
            capability: quarantined.capability,
            version: quarantined.version,
            quarantined_as: quarantined.quarantined_as,
            reason_codes: quarantined.reason_codes,
          },
        },
        "stdout",
      );
    }
    // M12/T9 F-094 (R5-E03-07) / H5: the Skill Store applies its OWN schema.
    // The Knowledgebase's migration runner no longer owns the `skills.*` DDL,
    // so the store's schema is applied here, against the store's own ledger.
    if (args[0] === "migrate") {
      const applied = await applySkillStoreMigrations({});
      return response(
        0,
        {
          status: applied.status,
          applied: applied.applied,
          skipped: applied.skipped,
          ledger: applied.ledger,
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
