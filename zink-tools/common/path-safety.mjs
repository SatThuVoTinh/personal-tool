const WINDOWS_RESERVED_DEVICE_NAMES =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9_.-]+$/u;

/**
 * Validates a logical artifact path according to canonical Zink safety invariants.
 * Throws SCHEMA_VALIDATION_FAILED on any violation.
 *
 * @param {string} logicalPath - Pure logical relative path to validate
 * @returns {string} - The validated path
 */
export function validateArtifactLogicalPath(logicalPath) {
  if (typeof logicalPath !== "string") {
    throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  // 1. Length bounds: between 1 and 512 characters
  if (logicalPath.length < 1 || logicalPath.length > 512) {
    throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  // 2. Reject NUL bytes and control characters
  // The control range is the point of the pattern, not an accident of it.
  // eslint-disable-next-line no-control-regex
  if (/[\0\x01-\x1F\x7F]/u.test(logicalPath)) {
    throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  // 3. Reject absolute Windows drive letters, UNC paths, and leading slashes
  if (
    logicalPath.startsWith("/") ||
    logicalPath.startsWith("\\") ||
    /^[a-zA-Z]:/u.test(logicalPath)
  ) {
    throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  // 4. Split on / and \
  const segments = logicalPath.split(/[/\\]/u);

  // 5. No segment may be empty, "." or "..". A `split` call always yields at
  //    least one element, so an empty `segments` is not a state this function
  //    can be in; the empty-segment test below is what catches `a//b` and `a/`.
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }

    // 6. Assert segment matches allowed characters
    if (!SAFE_SEGMENT_PATTERN.test(segment)) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }

    // 7. Reject Windows reserved device names (case-insensitive)
    if (WINDOWS_RESERVED_DEVICE_NAMES.test(segment)) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
  }

  // The validated form. The split above accepts both separators, so returning
  // `logicalPath` verbatim handed the caller back the backslash spelling it had
  // only half-checked — README's "normalized path" promise named this return.
  return segments.join("/");
}

export function isArtifactLogicalPathValid(logicalPath) {
  try {
    validateArtifactLogicalPath(logicalPath);
    return true;
  } catch {
    return false;
  }
}
