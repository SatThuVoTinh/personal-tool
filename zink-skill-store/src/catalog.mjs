import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
// M11/T1-R1 2.3: the store-wide writer lock reuses the exact acquisition,
// owner-token and release protocol already adopted by the ledger, guard and
// queue sites (`integrations/openclaw/lib/file-lock.mjs`). A second mkdir-lock
// implementation here would be a parallel policy that can diverge from the
// holder protocol (owner.json token) those sites release against. The async
// seam (`withFileLock`) is used rather than `withFileLockSync` because the
// promotion critical section is async: the sync seam runs a synchronous
// callback, so wrapping an async body in it would release the lock while the
// writes were still in flight. It keeps the same busy semantics with bounded
// waiting (10 ms retry, 5 s default deadline, FILE_LOCK_TIMEOUT after that).
import {
  withFileLock,
  lockDirFor,
} from "../../integrations/openclaw/lib/file-lock.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const DIGEST = /^[0-9a-f]{64}$/;
const DECISION = /^PLAN:M(?:0|[1-9][0-9]*)\/(?:T|S)[1-9][0-9]*-R[1-9][0-9]*$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const PLAN_REF = /^M(?:0|[1-9][0-9]*)\/(?:T|S)[1-9][0-9]*-R[1-9][0-9]*$/;
const SOURCE_TYPES = new Set([
  "owner-authored",
  "demonstration",
  "execution",
  "correction",
  "research",
]);
const REFERENCE_TYPES = new Set(["repository", "url", "plan", "git"]);
const STATUSES = new Set(["CANDIDATE", "ACTIVE", "DEPRECATED", "REJECTED"]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });

class StrictJsonError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class JsonParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  parse() {
    this.#space();
    const value = this.#value();
    this.#space();
    if (this.index !== this.text.length)
      this.#invalid("Unexpected trailing data.");
    return value;
  }

  #invalid(message) {
    throw new StrictJsonError("MANIFEST_JSON_INVALID", message);
  }

  #space() {
    while (/[\t\n\r ]/.test(this.text[this.index])) this.index += 1;
  }

  #value() {
    this.#space();
    const character = this.text[this.index];
    if (character === "{") return this.#object();
    if (character === "[") return this.#array();
    if (character === '"') return this.#string();
    if (
      character === "t" &&
      this.text.slice(this.index, this.index + 4) === "true"
    ) {
      this.index += 4;
      return true;
    }
    if (
      character === "f" &&
      this.text.slice(this.index, this.index + 5) === "false"
    ) {
      this.index += 5;
      return false;
    }
    if (
      character === "n" &&
      this.text.slice(this.index, this.index + 4) === "null"
    ) {
      this.index += 4;
      return null;
    }
    if (character === "-" || /[0-9]/.test(character)) return this.#number();
    this.#invalid("Expected a JSON value.");
  }

  #object() {
    const result = Object.create(null);
    const names = new Set();
    this.index += 1;
    this.#space();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (this.text[this.index] !== '"')
        this.#invalid("Expected an object member name.");
      const name = this.#string();
      if (names.has(name)) {
        throw new StrictJsonError(
          "MANIFEST_JSON_DUPLICATE_KEY",
          "Duplicate object member name.",
        );
      }
      names.add(name);
      this.#space();
      if (this.text[this.index] !== ":") this.#invalid("Expected a colon.");
      this.index += 1;
      result[name] = this.#value();
      this.#space();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.#invalid("Expected a comma.");
      this.index += 1;
      this.#space();
    }
  }

  #array() {
    const result = [];
    this.index += 1;
    this.#space();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.#value());
      this.#space();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.#invalid("Expected a comma.");
      this.index += 1;
      this.#space();
    }
  }

  #string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.text.slice(start, this.index));
        } catch {
          this.#invalid("Invalid JSON string.");
        }
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.text[this.index];
        if (!'"\\/bfnrtu'.includes(escape ?? ""))
          this.#invalid("Invalid string escape.");
        if (escape === "u") {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!/[0-9a-fA-F]/.test(this.text[this.index + offset] ?? "")) {
              this.#invalid("Invalid Unicode escape.");
            }
          }
          this.index += 4;
        }
      } else if (character < " ") {
        this.#invalid("Unescaped control character in string.");
      }
      this.index += 1;
    }
    this.#invalid("Unterminated string.");
  }

  #number() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.index),
    );
    if (!match) this.#invalid("Invalid number.");
    const value = match[0];
    this.index += value.length;
    return Number(value);
  }
}

function diagnostic(code, message, relativePath) {
  return { code, message, path: relativePath };
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function skillPath(parts = []) {
  return ["skills", ...parts].join("/");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, allowed = required) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.includes(key))
  );
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validRepositoryReference(value) {
  if (
    !nonEmpty(value) ||
    value.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  )
    return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString() === value.replace("Z", ".000Z")
  );
}

function schemaError(errors, relativePath, message) {
  errors.push(diagnostic("MANIFEST_SCHEMA_INVALID", message, relativePath));
}

function validateManifest(manifest, expected, relativePath, errors) {
  if (
    !exactKeys(manifest, [
      "schema_version",
      "identity",
      "content",
      "provenance",
      "lifecycle",
    ])
  ) {
    schemaError(errors, relativePath, "Manifest fields or types are invalid.");
    return;
  }
  if (
    !Number.isInteger(manifest.schema_version) ||
    manifest.schema_version !== 1
  ) {
    schemaError(errors, relativePath, "schema_version must be integer 1.");
  }
  const identity = manifest.identity;
  if (
    !exactKeys(identity, ["namespace", "capability", "version"]) ||
    !Array.isArray(identity.namespace) ||
    identity.namespace.length < 1 ||
    identity.namespace.length > 8 ||
    !identity.namespace.every(
      (segment) => typeof segment === "string" && SLUG.test(segment),
    ) ||
    typeof identity.capability !== "string" ||
    !SLUG.test(identity.capability) ||
    typeof identity.version !== "string" ||
    !VERSION.test(identity.version)
  ) {
    schemaError(errors, relativePath, "identity is invalid.");
  } else if (
    identity.namespace.join("/") !== expected.namespace.join("/") ||
    identity.capability !== expected.capability ||
    identity.version !== expected.version
  ) {
    errors.push(
      diagnostic(
        "IDENTITY_PATH_MISMATCH",
        "Manifest identity does not match directory identity.",
        relativePath,
      ),
    );
  }
  const content = manifest.content;
  if (
    !exactKeys(content, ["path", "sha256"]) ||
    content.path !== "SKILL.md" ||
    typeof content.sha256 !== "string" ||
    !DIGEST.test(content.sha256)
  ) {
    schemaError(errors, relativePath, "content is invalid.");
  }
  const provenance = manifest.provenance;
  if (
    !exactKeys(provenance, ["source_type", "references"]) ||
    !SOURCE_TYPES.has(provenance.source_type) ||
    !Array.isArray(provenance.references)
  ) {
    schemaError(errors, relativePath, "provenance is invalid.");
  } else if (provenance.references.length > 32) {
    errors.push(
      diagnostic(
        "PROVENANCE_REFERENCE_LIMIT_EXCEEDED",
        "Provenance exceeds 32 references.",
        relativePath,
      ),
    );
  } else {
    for (const reference of provenance.references) {
      if (
        !exactKeys(reference, ["type", "ref"]) ||
        !REFERENCE_TYPES.has(reference.type) ||
        !nonEmpty(reference.ref)
      ) {
        schemaError(errors, relativePath, "A provenance reference is invalid.");
      } else if (
        (reference.type === "repository" &&
          !validRepositoryReference(reference.ref)) ||
        (reference.type === "url" && !validUrl(reference.ref)) ||
        (reference.type === "plan" && !PLAN_REF.test(reference.ref)) ||
        (reference.type === "git" && !GIT_SHA.test(reference.ref))
      ) {
        errors.push(
          diagnostic(
            "UNSAFE_PROVENANCE_REFERENCE",
            "Provenance reference is invalid for its type.",
            relativePath,
          ),
        );
      }
    }
  }
  const lifecycle = manifest.lifecycle;
  if (!Array.isArray(lifecycle) || lifecycle.length < 1) {
    schemaError(errors, relativePath, "lifecycle is invalid.");
    return;
  }
  if (lifecycle.length > 64) {
    errors.push(
      diagnostic(
        "LIFECYCLE_EVENT_LIMIT_EXCEEDED",
        "Lifecycle exceeds 64 events.",
        relativePath,
      ),
    );
    return;
  }
  let previousTime = -Infinity;
  const statuses = [];
  for (const event of lifecycle) {
    const requiresDecision = isObject(event) && event.status !== "CANDIDATE";
    const expectedKeys = requiresDecision
      ? ["status", "at", "actor", "decision_ref"]
      : ["status", "at", "actor"];
    if (
      !exactKeys(event, expectedKeys) ||
      !STATUSES.has(event.status) ||
      !nonEmpty(event.actor) ||
      typeof event.at !== "string" ||
      !validTimestamp(event.at) ||
      (requiresDecision &&
        (!nonEmpty(event.decision_ref) || !DECISION.test(event.decision_ref)))
    ) {
      schemaError(errors, relativePath, "A lifecycle event is invalid.");
      continue;
    }
    const timestamp = Date.parse(event.at);
    if (timestamp < previousTime)
      errors.push(
        diagnostic(
          "LIFECYCLE_TIMESTAMP_INVALID",
          "Lifecycle timestamps must be non-decreasing.",
          relativePath,
        ),
      );
    previousTime = timestamp;
    statuses.push(event.status);
  }
  const legal = [
    "CANDIDATE",
    "CANDIDATE,ACTIVE",
    "CANDIDATE,ACTIVE,DEPRECATED",
    "CANDIDATE,REJECTED",
  ];
  if (!legal.includes(statuses.join(",")))
    errors.push(
      diagnostic(
        "LIFECYCLE_SEQUENCE_INVALID",
        "Lifecycle sequence is invalid.",
        relativePath,
      ),
    );
}

async function readRegularFile(filePath, relativePath, errors, limits = null) {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      errors.push(
        diagnostic(
          "UNSAFE_PATH",
          "Expected a regular non-link file.",
          relativePath,
        ),
      );
      return null;
    }
    // R25: bound the read BEFORE it is allocated.
    //
    // The ceilings were only ever checked against `bytes.length` after
    // readFile had already buffered the whole file, so they bounded nothing
    // about memory: scanCatalog runs on every discover, getActiveSkill and
    // syncSkillsToVectorStore, so peak resident size scaled with the size of
    // whatever was on disk. Above Node's buffer limit the read throws and the
    // catch relabels it MISSING_REQUIRED_FILE, which points the operator at a
    // missing file rather than an oversized one.
    if (limits && info.size > limits.maxBytes) {
      errors.push(diagnostic(limits.code, limits.message, relativePath));
      return null;
    }
    return await readFile(filePath);
  } catch {
    errors.push(
      diagnostic(
        "MISSING_REQUIRED_FILE",
        "Required file is missing.",
        relativePath,
      ),
    );
    return null;
  }
}

async function validateVersion(directory, parts, errors, records, count) {
  const relativeDirectory = skillPath(parts);
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort(compareStrings);
  if (names.includes("manifest.json")) {
    count.value += 1;
    if (count.value > 1000)
      errors.push(
        diagnostic(
          "MANIFEST_LIMIT_EXCEEDED",
          "Catalog exceeds 1,000 manifests.",
          skillPath([...parts, "manifest.json"]),
        ),
      );
  }
  if (
    names.length !== 2 ||
    names[0] !== "SKILL.md" ||
    names[1] !== "manifest.json"
  ) {
    errors.push(
      diagnostic(
        "VERSION_DIRECTORY_CONTENT_INVALID",
        "Version directory must contain only manifest.json and SKILL.md.",
        relativeDirectory,
      ),
    );
    return;
  }
  const manifestPath = path.join(directory, "manifest.json");
  const markdownPath = path.join(directory, "SKILL.md");
  const manifestRelative = skillPath([...parts, "manifest.json"]);
  const markdownRelative = skillPath([...parts, "SKILL.md"]);
  const manifestBytes = await readRegularFile(
    manifestPath,
    manifestRelative,
    errors,
    {
      maxBytes: 65_536,
      code: "MANIFEST_SIZE_LIMIT_EXCEEDED",
      message: "manifest.json exceeds 65,536 bytes.",
    },
  );
  const markdownBytes = await readRegularFile(
    markdownPath,
    markdownRelative,
    errors,
    {
      maxBytes: 262_144,
      code: "MARKDOWN_SIZE_LIMIT_EXCEEDED",
      message: "SKILL.md exceeds 262,144 bytes.",
    },
  );
  if (!manifestBytes || !markdownBytes) return;
  // R25: the pre-read stat is the memory bound; this length check is kept as
  // a second line of defence, because the file can grow between the stat and
  // the read and only the bytes actually read can be judged.
  const manifestTooLarge = manifestBytes.length > 65_536;
  const markdownTooLarge = markdownBytes.length > 262_144;
  if (manifestTooLarge)
    errors.push(
      diagnostic(
        "MANIFEST_SIZE_LIMIT_EXCEEDED",
        "manifest.json exceeds 65,536 bytes.",
        manifestRelative,
      ),
    );
  if (markdownTooLarge)
    errors.push(
      diagnostic(
        "MARKDOWN_SIZE_LIMIT_EXCEEDED",
        "SKILL.md exceeds 262,144 bytes.",
        markdownRelative,
      ),
    );
  if (manifestTooLarge || markdownTooLarge) return;
  let manifest;
  try {
    manifest = new JsonParser(textDecoder.decode(manifestBytes)).parse();
  } catch (error) {
    const code =
      error instanceof TypeError
        ? "INVALID_UTF8"
        : (error.code ?? "MANIFEST_JSON_INVALID");
    errors.push(
      diagnostic(
        code,
        code === "INVALID_UTF8"
          ? "manifest.json is not valid UTF-8."
          : error.message,
        manifestRelative,
      ),
    );
    return;
  }
  let markdown;
  try {
    markdown = textDecoder.decode(markdownBytes);
  } catch {
    errors.push(
      diagnostic(
        "INVALID_UTF8",
        "SKILL.md is not valid UTF-8.",
        markdownRelative,
      ),
    );
    return;
  }
  const expected = {
    namespace: parts.slice(0, -2),
    capability: parts.at(-2),
    version: parts.at(-1),
  };
  validateManifest(manifest, expected, manifestRelative, errors);
  if (
    manifest?.content?.sha256 &&
    createHash("sha256").update(markdownBytes).digest("hex") !==
      manifest.content.sha256
  ) {
    errors.push(
      diagnostic(
        "CONTENT_DIGEST_MISMATCH",
        "SKILL.md digest does not match manifest content.sha256.",
        markdownRelative,
      ),
    );
  }
  records.push({
    manifest,
    markdown,
    relativePath: manifestRelative,
    expected,
  });
}

async function walk(directory, parts, errors, records, count) {
  let info;
  try {
    info = await lstat(directory);
  } catch {
    errors.push(
      diagnostic(
        "SKILLS_ROOT_MISSING",
        "Skills root is missing.",
        skillPath(parts),
      ),
    );
    return;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    errors.push(
      diagnostic(
        "UNSAFE_PATH",
        "Expected a non-link directory.",
        skillPath(parts),
      ),
    );
    return;
  }
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => compareStrings(left.name, right.name),
  );
  if (parts.length === 0 && entries.length === 0) return;
  if (parts.length === 0) {
    for (const entry of entries) {
      if (entry.name === "README.md") {
        if (!entry.isFile() || entry.isSymbolicLink())
          errors.push(
            diagnostic(
              "UNSAFE_PATH",
              "Root README.md must be a regular non-link file.",
              skillPath([entry.name]),
            ),
          );
      } else if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !SLUG.test(entry.name)
      ) {
        errors.push(
          diagnostic(
            "DIRECTORY_GRAMMAR_INVALID",
            "Skills root contains an invalid entry.",
            skillPath([entry.name]),
          ),
        );
      } else {
        await walk(
          path.join(directory, entry.name),
          [entry.name],
          errors,
          records,
          count,
        );
      }
    }
    return;
  }
  const currentName = parts.at(-1);
  const isVersion =
    VERSION.test(currentName) && parts.length >= 3 && parts.length <= 10;
  if (isVersion) {
    await validateVersion(directory, parts, errors, records, count);
    return;
  }
  if (!SLUG.test(currentName) || parts.length > 9 || entries.length === 0) {
    errors.push(
      diagnostic(
        "DIRECTORY_GRAMMAR_INVALID",
        "Intermediate namespace or capability directory is invalid.",
        skillPath(parts),
      ),
    );
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      errors.push(
        diagnostic(
          "DIRECTORY_GRAMMAR_INVALID",
          "Intermediate directories may contain only non-link directories.",
          skillPath([...parts, entry.name]),
        ),
      );
      continue;
    }
    await walk(
      path.join(directory, entry.name),
      [...parts, entry.name],
      errors,
      records,
      count,
    );
  }
}

function sortDiagnostics(errors) {
  return errors.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.code, right.code),
  );
}

export async function scanCatalog(skillsRoot) {
  const errors = [];
  const records = [];
  let rootInfo;
  try {
    rootInfo = await lstat(skillsRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    errors.push(
      diagnostic("SKILLS_ROOT_MISSING", "Skills root is missing.", "skills"),
    );
    return { errors, records };
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    errors.push(
      diagnostic(
        "UNSAFE_PATH",
        "Skills root must be a non-link directory.",
        "skills",
      ),
    );
  } else {
    const resolvedRoot = await realpath(skillsRoot);
    await walk(resolvedRoot, [], errors, records, { value: 0 });
  }
  const active = new Map();
  for (const record of records) {
    const identity = record.manifest?.identity;
    const lifecycle = record.manifest?.lifecycle;
    if (
      !isObject(identity) ||
      !Array.isArray(identity.namespace) ||
      typeof identity.capability !== "string" ||
      !Array.isArray(lifecycle) ||
      lifecycle.at(-1)?.status !== "ACTIVE"
    )
      continue;
    const key = `${identity.namespace.join("/")}\u0000${identity.capability}`;
    if (active.has(key)) {
      errors.push(
        diagnostic(
          "MULTIPLE_ACTIVE_VERSIONS",
          "Namespace and capability have multiple ACTIVE versions.",
          record.relativePath,
        ),
      );
    } else active.set(key, record);
  }
  const sortedErrors = sortDiagnostics(errors);
  const sortedRecords = records.sort((left, right) =>
    compareStrings(left.relativePath, right.relativePath),
  );
  return {
    errors: sortedErrors,
    records: sortedErrors.length === 0 ? sortedRecords : [],
  };
}

export async function getActiveSkill(skillsRoot, namespace, capability) {
  const catalog = await scanCatalog(skillsRoot);
  if (catalog.errors.length > 0) return { ...catalog, skill: null };
  const skill =
    catalog.records.find(
      (record) =>
        record.manifest.identity.namespace.join("/") === namespace &&
        record.manifest.identity.capability === capability &&
        record.manifest.lifecycle.at(-1).status === "ACTIVE",
    ) ?? null;
  return { ...catalog, skill };
}

export function catalogError(details) {
  return {
    error: {
      code: "CATALOG_INVALID",
      message: "Skill Store catalog is invalid.",
      details,
    },
  };
}

function canonicalTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

/**
 * The writer's own refusals. `details` is the machine-readable cause list that
 * accompanies a code: for `SKILL_IDENTITY_INVALID` it names the single rule the
 * input broke, and for `CATALOG_INVALID` it names the stage that refused plus
 * every diagnostic code the catalog reported. Callers that must branch on WHY
 * read `error.details` instead of parsing the message prose.
 */
function writerError(code, message, details = []) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  throw error;
}

async function writeFileAtomic(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
}

function stagingName(version) {
  return `${version}.pending-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/**
 * The grammar `stagingName()` produces, for any version. Writer residue is
 * identified by its own shape rather than by the promoting caller's version:
 * a killed publisher leaves `<semver>.pending-*` beside the real version
 * directories, and `walk` reports every such sibling as
 * `DIRECTORY_GRAMMAR_INVALID`, which nulls `records` for the whole store.
 * Names that do not carry the marker after a valid version are deliberately
 * left alone so a genuinely malformed directory still surfaces as an error.
 */
function isStagingResidue(name) {
  const marker = ".pending-";
  const at = name.indexOf(marker);
  return at > 0 && VERSION.test(name.slice(0, at));
}

/**
 * M11/T1-R1 2.3: the store-wide writer lock seam.
 *
 * The lock lives BESIDE `skillsRoot` (its parent directory), never inside it:
 * `scanCatalog` requires every root entry to be a slug directory, so a
 * `writer.lock` under the scanned root would poison the very catalog the lock
 * protects. It is named after the root it guards (`<root>.writer.lock`) rather
 * than the bare `writer.lock` convention: sibling catalogs — two mkdtemp test
 * trees sharing a parent — would otherwise contend on one lock, and one
 * stranded lock file from a crashed run would fail-close every unrelated
 * catalog forever. (dirname, basename) identifies the guarded root exactly, so
 * distinct roots can never collide on the same lock path.
 */
export function skillStoreWriterLockDir(skillsRoot) {
  if (typeof skillsRoot !== "string" || skillsRoot.trim() === "") {
    writerError(
      "SKILLS_ROOT_REQUIRED",
      "a canonical skillsRoot is required to address the store writer lock.",
    );
  }
  const resolved = path.resolve(skillsRoot);
  return lockDirFor(
    path.dirname(resolved),
    `${path.basename(resolved)}.writer.lock`,
  );
}

export async function withSkillStoreWriterLock(skillsRoot, fn, options = {}) {
  return withFileLock(skillStoreWriterLockDir(skillsRoot), fn, options);
}

/**
 * Validates one complete staged version directory before it may be
 * published. Returns the catalog diagnostics; only an empty error list
 * admits the pair to canonical state.
 */
export async function validateStagedVersion(directory, parts) {
  const errors = [];
  const records = [];
  await validateVersion(directory, parts, errors, records, { value: 0 });
  return { errors, records };
}

async function fsyncDirectoryBestEffort(dir) {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* durability hint only; the rename is what makes the entry atomic */
  }
}

/**
 * States what a rejected version's rollback left behind, read from the path
 * itself rather than from `rm`'s outcome.
 *
 * `rm(..., { force: true })` swallows ENOENT, so `rm` returning quietly cannot
 * distinguish "removed" from "was never there", and a recursive delete that
 * fails partway (EBUSY/EPERM/ESTALE on a drvfs root) can leave a version
 * directory the next `scanCatalog` rejects again. Only three answers are
 * honest there — clean, residue, and unknown — and `R5-E04-03` is the case
 * where the store reported none of them.
 */
export async function describeVersionRollbackState(versionDir, removalError) {
  const details = [];
  if (removalError) {
    details.push(`removal failed with ${removalError?.code ?? "unknown"}`);
  }
  let entries;
  try {
    entries = await readdir(versionDir);
  } catch (error) {
    const code = error?.code ?? "unknown";
    if (code === "ENOENT") {
      details.push("the version directory is absent");
      return `canonical state is clean (${details.join("; ")})`;
    }
    details.push(`the version directory could not be read with ${code}`);
    return `canonical state is UNKNOWN (${details.join("; ")})`;
  }
  details.push(
    entries.length === 0
      ? "the version directory remains and is empty"
      : `the version directory still holds ${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        }`,
  );
  return `canonical state is NOT clean (${details.join("; ")})`;
}

/**
 * Removes writer residue: stale `<semver>.pending-*` staging directories under
 * the capability parent — any version's, not only the promoting caller's,
 * because one killed publisher otherwise blocks every other — and an
 * incomplete version directory that holds no manifest at all. Neither is ever
 * canonical: the catalog recognizes only complete validated pairs, so removing
 * them cannot destroy canonical truth.
 */
async function healWriterResidue(skillsRoot, parentDir, versionDir) {
  try {
    const entries = await readdir(parentDir);
    let swept = false;
    for (const entry of entries) {
      if (isStagingResidue(entry)) {
        await rm(path.join(parentDir, entry), {
          recursive: true,
          force: true,
        });
        swept = true;
      }
    }
    // A capability directory left empty by the sweep is itself invalid to the
    // scanner ("intermediate directories may not be empty"), so pruning it is
    // part of healing, not an extra cleanup. The promotion recreates it before
    // it stages (`mkdir(parentDir, { recursive: true })`).
    if (swept) await pruneEmptyParents(parentDir, skillsRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const info = await lstat(versionDir);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    // The scanner recognizes only a complete pair, so an incomplete pair is
    // residue by the same argument that makes staging residue non-canonical —
    // whichever of the two members is the missing one. Judging only
    // `manifest.json` left a directory that held a manifest without content
    // unhealable: the replay probe read it, failed, and reported
    // `SKILL_VERSION_CONFLICT` ("already exists with different content") for a
    // state this writer created and could never re-enter.
    let missingMembers = 0;
    for (const member of ["manifest.json", "SKILL.md"]) {
      try {
        await lstat(path.join(versionDir, member));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        missingMembers += 1;
      }
    }
    if (missingMembers > 0) {
      await rm(versionDir, { recursive: true, force: true });
      await pruneEmptyParents(parentDir, skillsRoot);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/**
 * Removes directories left empty by healing, walking up from `fromDir`
 * toward (and excluding) `stopDir`. Only empty directories are removed;
 * the first non-empty directory stops the walk.
 */
async function pruneEmptyParents(fromDir, stopDir) {
  // The walk removes directories, so it must have a real boundary. An
  // unset/relative root never authorizes upward pruning.
  if (typeof stopDir !== "string" || stopDir === "") return;
  let cursor = fromDir;
  while (cursor !== stopDir && cursor.startsWith(stopDir)) {
    let entries;
    try {
      entries = await readdir(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (entries.length > 0) return;
    try {
      await rmdir(cursor);
    } catch (error) {
      // Filled concurrently after the emptiness check: no longer ours to
      // prune. Anything else is a real filesystem failure.
      if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") return;
      throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

/**
 * Trusted canonical Skill Store promotion.
 *
 * This is the ONLY writer that may create or update canonical
 * `SKILL.md` / `manifest.json` records. It is internal/trusted code:
 * agents may propose candidates, but only an owner approval may invoke
 * this path (via the governed approval handler). It is never exposed as
 * a model-visible tool.
 *
 * Semantics:
 * - validates identity grammar before touching the filesystem, so no
 *   model-supplied string can become an arbitrary write target;
 * - content_sha256 is the raw SHA-256 of the exact bytes written;
 * - lifecycle is CANDIDATE then ACTIVE in one governed transition;
 * - an identical repeat promotion is idempotent (ALREADY_ACTIVE) only when the
 *   governed decision and provenance being asked about are the ones the record
 *   already carries; same bytes under a second decision is a conflict, not a
 *   silent no-op;
 * - same version with different bytes, or another ACTIVE version of the
 *   same capability, is a fail-closed conflict;
 * - the written record is re-validated through scanCatalog and rolled
 *   back when invalid.
 *
 * M11/T1-R1 2.3: acquires the store-wide `writer.lock` around the whole
 * heal → validate → clash-check → staging write → rename → re-verify
 * section, so two concurrent promotions (same or different versions) can
 * never interleave. Callers that must combine promotion with adjacent
 * proposal-state writes in ONE critical section (the governed approval
 * transaction) run them inside `withSkillStoreWriterLock` and call
 * `promoteApprovedSkillUnlocked` — never both.
 */
export async function promoteApprovedSkill(params) {
  return withSkillStoreWriterLock(params.skillsRoot, () =>
    promoteApprovedSkillUnlocked(params),
  );
}

export async function promoteApprovedSkillUnlocked({
  skillsRoot,
  namespace,
  capability,
  version,
  content,
  requestingActor = "unknown",
  ownerActor = "owner",
  decisionRef,
  sourceType = "demonstration",
  references = [{ type: "plan", ref: "M8/T3-R1" }],
  at = null,
}) {
  const nsArray = Array.isArray(namespace) ? namespace : [namespace];
  if (
    !Array.isArray(nsArray) ||
    nsArray.length < 1 ||
    nsArray.length > 8 ||
    !nsArray.every(
      (segment) => typeof segment === "string" && SLUG.test(segment),
    ) ||
    typeof capability !== "string" ||
    !SLUG.test(capability) ||
    typeof version !== "string" ||
    !VERSION.test(version)
  ) {
    writerError(
      "SKILL_IDENTITY_INVALID",
      "namespace/capability/version do not satisfy catalog grammar.",
      ["IDENTITY_GRAMMAR"],
    );
  }
  if (typeof content !== "string" || content.length === 0) {
    writerError("SKILL_IDENTITY_INVALID", "content must be non-empty.", [
      "CONTENT_EMPTY",
    ]);
  }
  const contentBytes = Buffer.from(content, "utf8");
  if (contentBytes.length > 262_144) {
    writerError(
      "SKILL_IDENTITY_INVALID",
      "content exceeds the 262,144-byte catalog ceiling.",
      ["CONTENT_CEILING_EXCEEDED"],
    );
  }
  if (typeof decisionRef !== "string" || !DECISION.test(decisionRef)) {
    writerError(
      "DECISION_REF_INVALID",
      "decision_ref must be a governed PLAN:M../T..-R.. reference.",
    );
  }
  if (!SOURCE_TYPES.has(sourceType)) {
    writerError(
      "SKILL_IDENTITY_INVALID",
      "provenance source_type is invalid.",
      ["PROVENANCE_SOURCE_TYPE_INVALID"],
    );
  }
  if (!Array.isArray(references) || references.length > 32) {
    writerError(
      "SKILL_IDENTITY_INVALID",
      "provenance references are invalid.",
      ["PROVENANCE_REFERENCES_INVALID"],
    );
  }
  for (const reference of references) {
    if (
      !isObject(reference) ||
      !REFERENCE_TYPES.has(reference.type) ||
      !nonEmpty(reference.ref) ||
      Object.keys(reference).length !== 2 ||
      (reference.type === "repository" &&
        !validRepositoryReference(reference.ref)) ||
      (reference.type === "url" && !validUrl(reference.ref)) ||
      (reference.type === "plan" && !PLAN_REF.test(reference.ref)) ||
      (reference.type === "git" && !GIT_SHA.test(reference.ref))
    ) {
      writerError(
        "SKILL_IDENTITY_INVALID",
        "a provenance reference is invalid for its type.",
        ["PROVENANCE_REFERENCE_ITEM_INVALID"],
      );
    }
  }
  if (!nonEmpty(requestingActor) || !nonEmpty(ownerActor)) {
    writerError(
      "SKILL_IDENTITY_INVALID",
      "lifecycle actors must be non-empty.",
      ["LIFECYCLE_ACTOR_EMPTY"],
    );
  }

  const contentSha256 = createHash("sha256").update(contentBytes).digest("hex");
  const versionDir = path.join(skillsRoot, ...nsArray, capability, version);
  const manifestPath = path.join(versionDir, "manifest.json");
  const markdownPath = path.join(versionDir, "SKILL.md");
  const parentDir = path.join(skillsRoot, ...nsArray, capability);

  // Heal interrupted publications first, so residue from a killed publisher
  // can neither poison the health check below nor masquerade as canonical.
  //
  // M11/T1-R1 2.3: deleting another live writer's `*.pending-*` staging
  // directory is safe precisely because this section runs under the store-wide
  // writer lock — no other publisher can be staging while we hold it. That is
  // why the heal needs no PID parsing: cross-process residue can only be
  // orphaned, never in flight.
  await healWriterResidue(skillsRoot, parentDir, versionDir);

  let versionDirPresent = false;
  try {
    const info = await lstat(versionDir);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      writerError(
        "SKILL_VERSION_CONFLICT",
        "version path is not a regular directory.",
      );
    }
    versionDirPresent = true;
    for (const file of [manifestPath, markdownPath]) {
      const fileInfo = await lstat(file);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        writerError(
          "SKILL_VERSION_CONFLICT",
          "version files must be regular non-link files.",
        );
      }
    }
    const [manifestBytes, markdownBytes] = await Promise.all([
      readFile(manifestPath),
      readFile(markdownPath),
    ]);
    // M11/T1-R1 2.6: the replay probe must judge the existing manifest with
    // the SAME strict parser the scanner uses. Lax `JSON.parse` silently kept
    // the last value of a duplicate member, so a tampered manifest that
    // scanCatalog rejects as MANIFEST_JSON_DUPLICATE_KEY could still answer
    // ALREADY_ACTIVE here — the idempotency probe accepting a record the
    // catalog refuses. A StrictJsonError (or non-UTF-8 bytes) falls into the
    // catch below as an unreadable-version conflict: fail closed.
    const existingManifest = new JsonParser(
      textDecoder.decode(manifestBytes),
    ).parse();
    const currentHash = createHash("sha256")
      .update(markdownBytes)
      .digest("hex");
    const recordedHash = existingManifest?.content?.sha256;
    const lastLifecycle = Array.isArray(existingManifest?.lifecycle)
      ? existingManifest.lifecycle.at(-1)
      : null;
    const lastStatus = lastLifecycle?.status ?? null;
    // R3-3: two owner decisions over the same bytes are not the same governed
    // act. `ALREADY_ACTIVE` used to be decided by content alone, so a repeat
    // promotion carrying a second `decision_ref` reported success while the
    // first record — and its provenance — stayed on disk with no signal that
    // the new decision had been dropped. Identity is the version; this is the
    // check that the record being confirmed is the record being asked for.
    const sameDecision = lastLifecycle?.decision_ref === decisionRef;
    const sameProvenance =
      JSON.stringify(existingManifest?.provenance ?? null) ===
      JSON.stringify({ source_type: sourceType, references });
    if (
      recordedHash === contentSha256 &&
      currentHash === contentSha256 &&
      lastStatus === "ACTIVE" &&
      sameDecision &&
      sameProvenance
    ) {
      return {
        status: "ALREADY_ACTIVE",
        content_sha256: contentSha256,
        namespace: nsArray,
        capability,
        version,
      };
    }
    if (recordedHash !== currentHash) {
      writerError(
        "SKILL_SOURCE_DRIFT",
        "existing canonical bytes do not match their manifest digest.",
      );
    }
    writerError(
      "SKILL_VERSION_CONFLICT",
      "version already exists with different content or state.",
    );
  } catch (error) {
    if (error?.code === "ENOENT" && !versionDirPresent) {
      /* absent version directory: proceed to promotion below */
    } else if (
      error?.code === "SKILL_VERSION_CONFLICT" ||
      error?.code === "SKILL_SOURCE_DRIFT"
    ) {
      throw error;
    } else {
      writerError(
        "SKILL_VERSION_CONFLICT",
        `existing version is unreadable: ${error?.message ?? error}`,
      );
    }
  }

  await mkdir(skillsRoot, { recursive: true });
  const catalog = await scanCatalog(skillsRoot);
  const catalogUsable =
    catalog.errors.length === 0 ||
    (catalog.errors.length === 1 &&
      catalog.errors[0]?.code === "SKILLS_ROOT_MISSING");
  if (!catalogUsable) {
    const first = catalog.errors[0];
    writerError(
      "CATALOG_INVALID",
      `catalog has pre-existing errors; promotion refused (first: ${first?.code ?? "UNKNOWN"} at ${first?.path ?? "unreported path"}).`,
      [
        "PREEXISTING_CATALOG_ERRORS",
        ...catalog.errors.map((entry) => entry?.code ?? "UNKNOWN"),
      ],
    );
  }
  const clash = (catalog.records ?? []).find(
    (record) =>
      record.manifest?.identity?.namespace?.join("/") === nsArray.join("/") &&
      record.manifest?.identity?.capability === capability &&
      record.manifest?.lifecycle?.at(-1)?.status === "ACTIVE",
  );
  if (clash) {
    writerError(
      "SKILL_ACTIVE_CONFLICT",
      `capability already has ACTIVE version ${clash.manifest.identity.version}; deprecate it before promoting ${version}.`,
    );
  }

  const stamp =
    typeof at === "string" && validTimestamp(at) ? at : canonicalTimestamp();
  const manifest = {
    schema_version: 1,
    identity: { namespace: nsArray, capability, version },
    content: { path: "SKILL.md", sha256: contentSha256 },
    provenance: { source_type: sourceType, references },
    lifecycle: [
      { status: "CANDIDATE", at: stamp, actor: String(requestingActor) },
      {
        status: "ACTIVE",
        at: stamp,
        actor: String(ownerActor),
        decision_ref: decisionRef,
      },
    ],
  };

  // SKILL.md + manifest.json are ONE logical publication. They are staged
  // as a complete pair, validated as a pair, and published by one atomic
  // rename — never written into the canonical directory file by file.
  await mkdir(parentDir, { recursive: true });
  const stagingDir = path.join(parentDir, stagingName(version));
  await mkdir(stagingDir, { recursive: true });
  try {
    await writeFileAtomic(path.join(stagingDir, "SKILL.md"), contentBytes);
    await writeFileAtomic(
      path.join(stagingDir, "manifest.json"),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );
    const staged = await validateStagedVersion(stagingDir, [
      ...nsArray,
      capability,
      version,
    ]);
    if (staged.errors.length > 0) {
      writerError(
        "CATALOG_INVALID",
        `staged record failed validation: ${staged.errors[0]?.code ?? "unknown"}.`,
        [
          "STAGED_VALIDATION_FAILED",
          ...staged.errors.map((entry) => entry?.code ?? "UNKNOWN"),
        ],
      );
    }
    // M10/T2-R22: make the staging directory's own entries durable BEFORE it is
    // renamed into the canonical location.
    //
    // `writeFileAtomic` fsyncs each file's BYTES, and the `fsyncDirectoryBestEffort(parentDir)`
    // below makes the RENAME itself durable — but neither persists the two
    // directory entries inside `stagingDir`. So a crash after the rename could
    // leave a canonical `versionDir` that exists yet is missing `SKILL.md` or
    // `manifest.json`: a published skill the catalog rejects, and one whose
    // disappearance is silent because the directory name is present. Reuses the
    // existing helper; this path already established the parity pattern in
    // `topology/lib/ledger.mjs`, `lib/queue-manager.mjs` (M7-066),
    // `lib/decision-ledger.mjs` and `lib/artifact-validator.mjs`.
    await fsyncDirectoryBestEffort(stagingDir);
    await rename(stagingDir, versionDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    if (error?.code === "SKILL_IDENTITY_INVALID") throw error;
    if (error?.code === "CATALOG_INVALID") throw error;
    writerError(
      "SKILL_PUBLISH_FAILED",
      `canonical publication failed: ${error?.message ?? error}`,
    );
  }
  await fsyncDirectoryBestEffort(parentDir);

  const reverified = await scanCatalog(skillsRoot);
  if (reverified.errors.length > 0) {
    let removalError = null;
    try {
      await rm(versionDir, { recursive: true, force: true });
    } catch (error) {
      removalError = error;
    }
    const rollback = await describeVersionRollbackState(
      versionDir,
      removalError,
    );
    writerError(
      "CATALOG_INVALID",
      `promoted record failed re-validation: ${
        reverified.errors[0]?.code ?? "unknown"
      }; rollback: ${rollback}.`,
      [
        "PROMOTED_REVALIDATION_FAILED",
        ...reverified.errors.map((entry) => entry?.code ?? "UNKNOWN"),
      ],
    );
  }

  return {
    status: "ACTIVE",
    content_sha256: contentSha256,
    namespace: nsArray,
    capability,
    version,
  };
}
