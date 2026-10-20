// M12/T9 F-035 - the state root's own files must be private.
//
// The builder's named-path checks judge the files the builder OWNS: the
// config, the identity key, the backup manifest, the two auth plans, the
// password-store resolver and the gemini-stream hotfix. An operator-made COPY
// of the credential-bearing config is not one of them, so nothing ever judged
// it. The live host carried
// `/home/hoang_vinh/.openclaw-zink/openclaw.json.bak-mobile-1789615159090`
// with mode 0644 - readable by every account on the machine - and no gate
// refused it.
//
// This module is the ENUMERATION: it lists every regular file under the state
// root whose mode carries group or other permission bits. The refusal itself
// lives in the builder (`configure.mjs`), which is the operator-facing surface
// for it.
//
// The enumeration is the state root's own top level, exactly as the finding's
// reproduction reads it (`find <state root> -maxdepth 1 -type f ! -perm 600`).
// Only REGULAR files are judged: a directory is not a file, and a symlink is
// never followed, so a link cannot be used to smuggle a readable body past the
// check.
import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** The named refusal the builder reports. */
export const STATE_ROOT_FILE_MODE_DRIFT = "STATE_ROOT_FILE_MODE_DRIFT";

/** The permission bits that make a file readable by someone other than its owner. */
const GROUP_OR_OTHER_BITS = 0o077;

function defaultModeOf(_target, stat) {
  return stat.mode & 0o777;
}

/**
 * Every regular file under the state root whose mode carries group or other
 * permission bits.
 *
 * `modeOf` is injectable so the enumeration itself is testable on a platform
 * that has no POSIX modes; the production path reads the real mode.
 */
export function stateRootFileModeFindings(stateDir, modeOf = defaultModeOf) {
  if (!existsSync(stateDir)) return [];
  const findings = [];
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const target = path.join(stateDir, entry.name);
    const stat = lstatSync(target);
    if (!stat.isFile()) continue;
    const mode = modeOf(target, stat);
    if ((mode & GROUP_OR_OTHER_BITS) !== 0)
      findings.push({ name: entry.name, mode });
  }
  return findings.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Refuse the state root when one of its files is group- or other-accessible.
 *
 * Windows has no POSIX permission bits, so the check is a no-op there - the
 * same rule every other mode check in this builder follows.
 */
export function assertStateRootFileModes(
  stateDir,
  { platform = process.platform, modeOf = defaultModeOf } = {},
) {
  if (platform === "win32") return [];
  const findings = stateRootFileModeFindings(stateDir, modeOf);
  if (findings.length === 0) return findings;
  const summary = findings
    .map((finding) => `${finding.name} (${finding.mode.toString(8)})`)
    .join(", ");
  const error = new Error(
    `${STATE_ROOT_FILE_MODE_DRIFT}: ${findings.length} file(s) under the state root carry group or other permission bits: ${summary}`,
  );
  error.code = STATE_ROOT_FILE_MODE_DRIFT;
  throw error;
}
