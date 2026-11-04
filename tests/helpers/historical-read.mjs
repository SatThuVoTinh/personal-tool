// Reachability precondition for the tests that read a pinned historical
// commit out of the local Git object store and unpack it with the external
// `tar` binary.
//
// On a shallow clone, after a squash-merge to main, or after `git gc` prunes
// the object, that read fails for a NON-CODE reason. An unconditional
// status-0 assertion then turns a checkout artefact into a red suite nobody
// can explain, and a suite that skips by accident is as bad as one that
// fails by accident. The precondition is measured once per commit and the
// affected cases skip with a named reason; a full-history checkout with
// `tar` present still executes every status-0 assertion.
import { spawnSync } from "node:child_process";

/** Is the commit object present in this checkout's object store? */
export function gitCommitReachable(repositoryRoot, sha) {
  return (
    spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: repositoryRoot,
      windowsHide: true,
    }).status === 0
  );
}

/** Is the external `tar` binary usable on this host? */
export function tarAvailable(repositoryRoot) {
  return (
    spawnSync("tar", ["--version"], {
      cwd: repositoryRoot,
      windowsHide: true,
    }).status === 0
  );
}

/**
 * A declarative skip value for a case that reads a historical commit.
 *
 * `false` means "run the case"; a string is the named reason the case is
 * skipped, so a reader can tell a checkout limitation from a pass.
 */
export function skipWhenUnreachable(repositoryRoot, sha) {
  if (gitCommitReachable(repositoryRoot, sha) && tarAvailable(repositoryRoot)) {
    return false;
  }
  return `the historical object ${sha} or the tar binary is not reachable in this checkout`;
}
