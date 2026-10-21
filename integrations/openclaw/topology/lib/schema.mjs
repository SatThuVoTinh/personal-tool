import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Canonical governance schema contracts backed by ../contracts/*.schema.json:
// - ledger-event
// - ledger-snapshot
// - agent-result-payload
// - approval-request
// - delegation-envelope
// - delegation-proposal
// - execution-brief
// - governance-manifest
// - governed-reference
// - incident
// - result
// - trusted-result-envelope
export const CANONICAL_CONTRACTS = Object.freeze([
  "ledger-event",
  "ledger-snapshot",
  "agent-result-payload",
  "approval-request",
  "delegation-envelope",
  "delegation-proposal",
  "execution-brief",
  "governance-manifest",
  "governed-reference",
  "incident",
  "result",
  "trusted-result-envelope",
]);

// Canonical tool contracts backed by zink-tools/contracts/
export const CANONICAL_TOOL_CONTRACTS = Object.freeze([
  "tool-call",
  "tool-result",
  "zink-excel",
  "zink-forecast",
  "zink-knowledge",
  "zink-n8n",
  "zink-operations-research",
  "zink-optimization",
  "zink-power-bi",
  "zink-python",
  "zink-simulation",
  "zink-skill",
  "zink-sql",
]);

// Deliberately limited to the checked-in governance schema dialect. Unknown
// assertions fail closed instead of silently behaving as annotations.
export const KEYWORDS = Object.freeze(
  new Set([
    "$schema",
    "$id",
    "$defs",
    "$ref",
    "title",
    "description",
    "type",
    "const",
    "enum",
    "properties",
    "patternProperties",
    "required",
    "additionalProperties",
    "minProperties",
    "maxProperties",
    "items",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "x-zink-contract-version",
  ]),
);
const keywords = KEYWORDS;
const cache = new Map();

export const invalid = (reason = "") => {
  const msg = reason
    ? `SCHEMA_INVALID: ${reason} (SCHEMA_VALIDATION_FAILED)`
    : "SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED";
  const err = new Error(msg);
  err.code = "SCHEMA_VALIDATION_FAILED";
  throw err;
};

// C04: Key-order-independent JSON stringification for const and enum comparison
//
// M12/T9 F-157: the canonical COMPARISON serializer.
//
// ROLE: it answers "are these two JSON values the same?" — key-sorted and
// compact, so a comparison never depends on the order the keys were written
// in. It is deliberately NOT the hash preimage serializer
// (`canonical.mjs`'s `canonicalJson`, which normalizes unicode and rejects
// anything JSON cannot represent) and NOT the config writer
// (`lib/policy.mjs`'s `stableJson`, whose pretty bytes are pinned by the
// admission digests). Three serializers, three roles, each stated where it
// lives.
export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

/**
 * M12/T9 F-303: contract resolution is repository-relative ONLY — the working
 * directory is not a candidate, so a run whose cwd held another `zink-tools/`
 * tree can no longer validate against files outside the repository.
 *
 * A caller that legitimately holds contracts somewhere else (a materialised
 * pointer tree, a packaged install) declares that location HERE, explicitly,
 * instead of relying on where the process happens to be started.
 */
let extraContractRoots = [];

export function setContractResolutionRoots(roots = []) {
  extraContractRoots = (Array.isArray(roots) ? roots : []).filter(
    (root) => typeof root === "string" && root.length > 0,
  );
}

export function resolveContractFilePath(name) {
  let cleanName = String(name || "").trim();
  if (cleanName.startsWith("tools/")) cleanName = cleanName.slice(6);
  if (cleanName.endsWith(".schema.json")) cleanName = cleanName.slice(0, -12);

  const candidatePaths = [
    // 0. Declared roots (M12/T9 F-303): an explicit location, never the cwd.
    ...extraContractRoots.flatMap((root) => [
      path.resolve(
        root,
        "zink-tools/contracts/tools",
        `${cleanName}.schema.json`,
      ),
      path.resolve(root, "zink-tools/contracts", `${cleanName}.schema.json`),
      path.resolve(root, "contracts/tools", `${cleanName}.schema.json`),
      path.resolve(root, "contracts", `${cleanName}.schema.json`),
    ]),
    // 1. Local contracts directory (in plugin or topology)
    path.resolve(__dirname, "../contracts", `${cleanName}.schema.json`),
    path.resolve(__dirname, "../contracts/tools", `${cleanName}.schema.json`),
    path.resolve(
      __dirname,
      "../../topology/contracts",
      `${cleanName}.schema.json`,
    ),
    // 2. Relative to repository zink-tools (from topology/lib)
    path.resolve(
      __dirname,
      "../../../../zink-tools/contracts/tools",
      `${cleanName}.schema.json`,
    ),
    path.resolve(
      __dirname,
      "../../../../zink-tools/contracts",
      `${cleanName}.schema.json`,
    ),
    // M12/T9 F-303: the working directory is NOT a candidate. A run whose cwd
    // held another `zink-tools/` tree silently validated against files
    // outside the repository, so the same contract name could resolve to
    // different bytes depending on where the process was started. Resolution
    // is repository-relative only.
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadContractSchema(name) {
  let cleanName = name;
  if (cleanName.startsWith("tools/")) cleanName = cleanName.slice(6);
  if (cleanName.endsWith(".schema.json")) cleanName = cleanName.slice(0, -12);

  const targetPath = resolveContractFilePath(name);
  if (!targetPath) {
    invalid(`Schema file not found for "${name}"`);
  }

  const raw = readFileSync(targetPath, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  const cached = cache.get(cleanName);
  if (cached && cached.hash === hash) {
    return cached.schema;
  }
  const parsed = JSON.parse(raw);
  cache.set(cleanName, { hash, schema: parsed });
  return parsed;
}

export function schemaFile(name) {
  return loadContractSchema(name);
}

/**
 * M12/T9 F-127: the enum a CONTRACT declares for one payload property of one
 * event type, read from the contract itself.
 *
 * The ledger-event contract states each event's payload in an `allOf` branch
 * guarded by `if: { properties: { type: { const: <event> } } }`. A consumer
 * that must know what a published event can carry reads it here instead of
 * re-listing the values in code — so a contract change cannot leave a
 * hand-maintained copy behind, and the reducer cannot accept a value the
 * contract would refuse at append time.
 *
 * Returns null when the contract declares no such property, which is the
 * fail-closed answer: a caller must treat "no declaration" as "nothing is
 * allowed", never as "anything is allowed".
 */
export function eventPayloadEnum(contractName, eventType, property) {
  const schema = schemaFile(contractName);
  const blocks = Array.isArray(schema?.allOf) ? schema.allOf : [];
  for (const block of blocks) {
    if (block?.if?.properties?.type?.const !== eventType) continue;
    const declared =
      block?.then?.properties?.payload?.properties?.[property]?.enum;
    if (Array.isArray(declared)) return Object.freeze([...declared]);
  }
  return null;
}
function typeMatches(type, value) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    );
  // C01/C02: "number" accepts any finite JS number (including floats).
  // "integer" remains a strict subset: only safe integers.
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (["string", "boolean"].includes(type)) return typeof value === type;
  invalid("type mismatch");
}

function matches(schema, value, file, depth) {
  try {
    check(schema, value, file, depth);
    return true;
  } catch {
    return false;
  }
}
function check(schema, value, file, depth = 0) {
  if (depth > 64 || value === undefined || schema === false) invalid();
  if (schema === true) return;
  if (
    !schema ||
    typeof schema !== "object" ||
    Object.keys(schema).some((key) => !keywords.has(key))
  )
    invalid();
  if (schema.$ref) {
    const [target, pointer = ""] = schema.$ref.split("#");
    const targetFile = target || file;
    let definition = schemaFile(targetFile);
    if (pointer && !pointer.startsWith("/")) invalid();
    for (const part of pointer.split("/").slice(1)) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!Object.hasOwn(definition, key)) invalid();
      definition = definition[key];
    }
    check(definition, value, targetFile, depth + 1);
    return;
  }
  if (
    schema.type &&
    !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) =>
      typeMatches(type, value),
    )
  )
    invalid();
  // C04: key-order independent comparison
  if (
    Object.hasOwn(schema, "const") &&
    stableJson(value) !== stableJson(schema.const)
  )
    invalid("const mismatch");
  if (
    schema.enum &&
    !schema.enum.some((item) => stableJson(item) === stableJson(value))
  )
    invalid("enum mismatch");
  if (schema.allOf)
    for (const rule of schema.allOf) check(rule, value, file, depth + 1);
  if (
    schema.anyOf &&
    !schema.anyOf.some((rule) => matches(rule, value, file, depth + 1))
  )
    invalid();
  if (
    schema.oneOf &&
    schema.oneOf.filter((rule) => matches(rule, value, file, depth + 1))
      .length !== 1
  )
    invalid();
  if (schema.not && matches(schema.not, value, file, depth + 1)) invalid();
  if (schema.if) {
    const branch = matches(schema.if, value, file, depth + 1)
      ? schema.then
      : schema.else;
    if (branch !== undefined) check(branch, value, file, depth + 1);
  }
  if (typeof value === "string") {
    // Governance ceilings are UTF-8 bytes, stricter than JSON Schema characters.
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
      invalid();
    if (
      schema.maxLength !== undefined &&
      Buffer.byteLength(value, "utf8") > schema.maxLength
    )
      invalid();
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      invalid();
    // C03: support RFC 3339 date-time with optional offsets or Z
    if (
      schema.format &&
      (schema.format !== "date-time" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/iu.test(
          value,
        ) ||
        !Number.isFinite(Date.parse(value)))
    )
      invalid("format date-time mismatch");
  }
  // C01/C02: minimum/maximum apply to any numeric value that passed typeMatches.
  // typeMatches already enforces isFinite for "number" and isSafeInteger for "integer".
  if (
    typeof value === "number" &&
    (value < (schema.minimum ?? -Number.MAX_SAFE_INTEGER) ||
      value > (schema.maximum ?? Number.MAX_SAFE_INTEGER))
  )
    invalid();

  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 1024)
    )
      invalid();
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    )
      invalid();
    if (schema.items !== undefined) {
      for (const item of value) check(schema.items, item, file, depth + 1);
    }
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      keys.length < (schema.minProperties ?? 0) ||
      keys.length > (schema.maxProperties ?? 1024)
    )
      invalid();
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key)))
      invalid();
    for (const key of keys) {
      const patterns = Object.entries(schema.patternProperties ?? {}).filter(
        ([pattern]) => new RegExp(pattern, "u").test(key),
      );
      for (const [, rule] of patterns) check(rule, value[key], file, depth + 1);
      const rule = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties[key]
        : patterns.length > 0
          ? undefined
          : schema.additionalProperties;
      if (rule === false) invalid();
      if (rule && typeof rule === "object")
        check(rule, value[key], file, depth + 1);
    }
  }
}

export function validateContract(name, value, maxBytes = 65536) {
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > maxBytes) invalid();
    check(schemaFile(`${name}.schema.json`), value, `${name}.schema.json`);
    return true;
  } catch (err) {
    if (err?.code === "SCHEMA_VALIDATION_FAILED") throw err;
    invalid(err?.message);
  }
}

/**
 * M12/T9 F-272: the envelope budgets, expressed ONCE.
 *
 * The validator used to carry a 64 KiB DEFAULT, and the only production call
 * site used the default — while the published per-tool `$defs.output`
 * contracts allow far more (zink-python alone allows 1 MiB of stdout and 1 MiB
 * of stderr, and the n8n output bounds its synced-table list at about 131 KB).
 * Two independently authored budgets therefore disagreed, and the SMALLER one
 * was enforced at the seam that runs after the work has already happened: the
 * tool succeeded, its side effect was committed, and the governed caller
 * reported a schema failure.
 *
 * The budgets live here, in the module that enforces them, and every call
 * site states which one it uses.
 */
export const TOOL_CALL_ENVELOPE_MAX_BYTES = 65536;
export const TOOL_RESULT_ENVELOPE_MAX_BYTES = 4 * 1024 * 1024;

export function validateContractSchema(schemaName, value, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    invalid("A byte budget is required");
  }
  const rootSchema = loadContractSchema(schemaName);
  if (value !== undefined) {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > maxBytes) {
      invalid("Payload exceeds max bytes");
    }
  }
  check(rootSchema, value, schemaName);
  return true;
}

/**
 * M12/T9 F-128: the version a contract PUBLISHES, derived the same way for
 * every contract.
 *
 * The manifest used to print the literal "1.0.0" for every contract that
 * carried no version marker, so a contract edited without its marker still
 * reported the same version and only the hash moved. A contract that declares
 * no version now reports "unknown" — never a fabricated one.
 */
function readContractVersion(parsed) {
  const declared = parsed?.["x-zink-contract-version"] ?? parsed?.version;
  if (typeof declared !== "string" || declared.trim().length === 0) {
    return "unknown";
  }
  return declared.trim();
}

export function generateSchemaManifest() {
  const manifest = {
    version: "1.0.0",
    generatedAt: "2026-09-23T00:00:00.000Z",
    contracts: {},
    tools: {},
  };
  for (const name of CANONICAL_CONTRACTS) {
    const filePath = resolveContractFilePath(name);
    if (!filePath || !existsSync(filePath)) {
      throw new Error(
        `SCHEMA_MANIFEST_INCOMPLETE: contract ${name} is canonical but no schema file resolves`,
      );
    }
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const parsed = JSON.parse(raw);
    manifest.contracts[name] = {
      file: `${name}.schema.json`,
      hash,
      title: parsed.title || name,
      version: readContractVersion(parsed),
    };
  }
  for (const name of CANONICAL_TOOL_CONTRACTS) {
    const filePath = resolveContractFilePath(name);
    if (!filePath || !existsSync(filePath)) {
      throw new Error(
        `SCHEMA_MANIFEST_INCOMPLETE: tool contract ${name} is canonical but no schema file resolves`,
      );
    }
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const parsed = JSON.parse(raw);
    manifest.tools[name] = {
      file: path.basename(filePath),
      hash,
      title: parsed.title || name,
      version: readContractVersion(parsed),
    };
  }
  const manifestStr = JSON.stringify({
    contracts: manifest.contracts,
    tools: manifest.tools,
  });
  manifest.manifestChecksum = createHash("sha256")
    .update(manifestStr)
    .digest("hex");
  return Object.freeze(manifest);
}

/**
 * M12/T9 F-322: the COMMITTED expectation for the contract manifest.
 *
 * The verifier used to regenerate the manifest it was comparing against, so
 * every hash comparison was disk-versus-disk inside one process and the only
 * property it demonstrated was that hashing is deterministic. Nothing
 * compared the repository's contracts against a committed expectation, so
 * editing a numeric ceiling in any tool contract left every lane green.
 *
 * UPDATE PROCEDURE (owner-visible, one step, same commit as the contract
 * change): run
 *   node -e "import('./integrations/openclaw/topology/lib/schema.mjs').then(m => console.log(m.generateSchemaManifest().manifestChecksum))"
 * and put the printed value below.
 *
 * M12/T9 F-252: the twelve topology contracts now each carry their own
 * `x-zink-contract-version`, so the manifest reports the version each contract
 * publishes instead of "unknown" for all of them, and F-030's pinning of the
 * WORKFLOW_CANCELLED payload moved the ledger-event bytes. The value below is
 * the checksum of THAT state.
 *
 * M12/T9 F-371: the delegation id changed its FORM - the same digest, now
 * rendered as a version-4 UUID - so `ledger-event.schema.json`,
 * `ledger-snapshot.schema.json`, `delegation-envelope.schema.json` and
 * `trusted-result-envelope.schema.json` accept BOTH renderings and publish
 * version 1.1.0. The value below is the checksum of THAT state.
 *
 * M12/T9 F-247: the unwritten task reference-digest slot was removed from
 * `ledger-snapshot.schema.json`, so the contract bytes changed. The value
 * below is the checksum of THAT state.
 *
 * M12/T9 F-249: `result_id` was withdrawn from the four verdict payload
 * branches of `ledger-event.schema.json`, so the contract bytes changed again.
 * The value below is the checksum of THAT state.
 *
 * M12/T9 F-376: `result_id` was admitted AGAIN in those four branches as an
 * optional LEGACY member - the live journal holds two verdicts that carry it,
 * and a contract that refuses its own record makes the ledger unreadable - so
 * the contract bytes changed once more. The value below is the checksum of THAT
 * state.
 */
export const PINNED_SCHEMA_MANIFEST_CHECKSUM =
  "44a38df6b39dd771af815823f60d9146b336ee13f3d3743b0658a24608d34c1b";

export function verifySchemaManifestChecksums(manifest = null) {
  if (manifest === null) {
    // M12/T9 F-322: the generated manifest is compared against the COMMITTED
    // expectation, not against itself.
    const generated = generateSchemaManifest();
    if (generated.manifestChecksum !== PINNED_SCHEMA_MANIFEST_CHECKSUM) {
      return {
        valid: false,
        mismatch: "manifest",
        expected: PINNED_SCHEMA_MANIFEST_CHECKSUM,
        actual: generated.manifestChecksum,
      };
    }
    manifest = generated;
  }
  const target = manifest;
  // Iterating only whatever the manifest happens to contain cannot notice a member that
  // was dropped on the way in, so completeness is checked against the canonical lists.
  const incomplete = [
    ...CANONICAL_CONTRACTS.filter(
      (name) => !(name in (target.contracts ?? {})),
    ),
    ...CANONICAL_TOOL_CONTRACTS.filter(
      (name) => !(name in (target.tools ?? {})),
    ),
  ];
  if (incomplete.length > 0) {
    return { valid: false, incomplete };
  }
  for (const [name, info] of Object.entries(target.contracts || {})) {
    const filePath = resolveContractFilePath(info.file || name);
    if (!filePath || !existsSync(filePath))
      return { valid: false, missing: info.file };
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== info.hash)
      return {
        valid: false,
        mismatch: name,
        expected: info.hash,
        actual: hash,
      };
  }
  for (const [name, info] of Object.entries(target.tools || {})) {
    const filePath = resolveContractFilePath(info.file || name);
    if (!filePath || !existsSync(filePath))
      return { valid: false, missing: info.file };
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== info.hash)
      return {
        valid: false,
        mismatch: name,
        expected: info.hash,
        actual: hash,
      };
  }
  return { valid: true, manifestChecksum: target.manifestChecksum };
}

export { check as checkSchema, typeMatches, matches };
