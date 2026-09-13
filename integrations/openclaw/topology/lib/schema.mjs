import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

// Deliberately limited to the checked-in governance schema dialect. Unknown
// assertions fail closed instead of silently behaving as annotations.
const keywords = new Set([
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
]);
const cache = new Map();
const invalid = () => {
  throw new Error("SCHEMA_INVALID");
};
function schemaFile(name) {
  if (!/^[a-z][a-z-]+\.schema\.json$/u.test(name)) invalid();
  if (!cache.has(name))
    cache.set(
      name,
      JSON.parse(
        readFileSync(new URL(`../contracts/${name}`, import.meta.url), "utf8"),
      ),
    );
  return cache.get(name);
}
function typeMatches(type, value) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  if (type === "integer") return Number.isSafeInteger(value);
  if (["string", "boolean"].includes(type)) return typeof value === type;
  invalid();
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
  }
  if (
    schema.type &&
    !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) =>
      typeMatches(type, value),
    )
  )
    invalid();
  if (
    Object.hasOwn(schema, "const") &&
    JSON.stringify(value) !== JSON.stringify(schema.const)
  )
    invalid();
  if (
    schema.enum &&
    !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
  )
    invalid();
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
    if (
      schema.format &&
      (schema.format !== "date-time" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().replace(".000Z", "Z") !==
          value.replace(".000Z", "Z"))
    )
      invalid();
  }
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) ||
      value < (schema.minimum ?? -Number.MAX_SAFE_INTEGER) ||
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
    for (const item of value)
      check(schema.items ?? false, item, file, depth + 1);
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
  } catch {
    invalid();
  }
}
