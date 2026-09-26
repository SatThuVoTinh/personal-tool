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
export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

export function resolveContractFilePath(name) {
  let cleanName = String(name || "").trim();
  if (cleanName.startsWith("tools/")) cleanName = cleanName.slice(6);
  if (cleanName.endsWith(".schema.json")) cleanName = cleanName.slice(0, -12);

  const candidatePaths = [
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
    // 3. Current working directory zink-tools
    path.resolve(
      process.cwd(),
      "zink-tools/contracts/tools",
      `${cleanName}.schema.json`,
    ),
    path.resolve(
      process.cwd(),
      "zink-tools/contracts",
      `${cleanName}.schema.json`,
    ),
    // 4. WSL repo mount
    path.resolve(
      "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool/zink-tools/contracts/tools",
      `${cleanName}.schema.json`,
    ),
    path.resolve(
      "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool/zink-tools/contracts",
      `${cleanName}.schema.json`,
    ),
    // 5. Windows repo path
    path.resolve(
      "C:/Users/HOANG VINH/OneDrive/Documents/personal-tool/zink-tools/contracts/tools",
      `${cleanName}.schema.json`,
    ),
    path.resolve(
      "C:/Users/HOANG VINH/OneDrive/Documents/personal-tool/zink-tools/contracts",
      `${cleanName}.schema.json`,
    ),
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

export function validateContractSchema(schemaName, value, maxBytes = 65536) {
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

export function generateSchemaManifest() {
  const manifest = {
    version: "1.0.0",
    generatedAt: "2026-09-23T00:00:00.000Z",
    contracts: {},
    tools: {},
  };
  for (const name of CANONICAL_CONTRACTS) {
    const filePath = resolveContractFilePath(name);
    if (!filePath || !existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const parsed = JSON.parse(raw);
    manifest.contracts[name] = {
      file: `${name}.schema.json`,
      hash,
      title: parsed.title || name,
      version: parsed["x-zink-contract-version"] || parsed.version || "1.0.0",
    };
  }
  for (const name of CANONICAL_TOOL_CONTRACTS) {
    const filePath = resolveContractFilePath(name);
    if (!filePath || !existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const parsed = JSON.parse(raw);
    manifest.tools[name] = {
      file: path.basename(filePath),
      hash,
      title: parsed.title || name,
      version: parsed["x-zink-contract-version"] || "1.0.0",
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

export function verifySchemaManifestChecksums(manifest = null) {
  const target = manifest || generateSchemaManifest();
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
