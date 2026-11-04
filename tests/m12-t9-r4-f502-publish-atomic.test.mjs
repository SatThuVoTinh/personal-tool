// M12/T9-R4 — F-502 (legacy R10-L02-1): publishArtifactAtomic must follow the
// "wx" + assertNoSymlinkComponents + own-temp-removal discipline of
// queue-manager.mjs:375-399 instead of adopting a foreign file at its
// predictable `.tmp-<pid>-<ms>` path. The row is LATENT (declared-but-unwired
// export), so this is the fault-injection probe test required by ACTIVE.md §5.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { publishArtifactAtomic } = await import(
  new URL(
    "../integrations/openclaw/lib/artifact-validator.mjs",
    import.meta.url,
  ).href
);

const FIXED_NOW = 1700000000000;

function withFrozenClock(fn) {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

test("F-502: a foreign file pre-created at the predictable temp path is refused, not adopted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f502-foreign-"));
  try {
    const source = path.join(dir, "source.bin");
    writeFileSync(source, "MINE");
    const target = path.join(dir, "out", "artifact.bin");
    mkdirSync(path.dirname(target), { recursive: true });
    const tempPath = `${target}.tmp-${process.pid}-${FIXED_NOW}`;
    writeFileSync(tempPath, "FOREIGN-ATTACKER-BYTES");

    withFrozenClock(() => {
      assert.throws(
        () => publishArtifactAtomic({ sourcePath: source, targetPath: target }),
        (err) => err?.code === "EEXIST",
        "openSync must use 'wx' so an existing temp path refuses with EEXIST",
      );
    });

    assert.equal(
      readFileSync(tempPath, "utf8"),
      "FOREIGN-ATTACKER-BYTES",
      "the foreign temp file must survive untouched (not truncated, not renamed)",
    );
    assert.equal(
      existsSync(target),
      false,
      "no target may be published from a foreign temp file",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-502: a symlinked ancestor of the temp path is refused before anything is created", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f502-symlink-"));
  try {
    const realDir = path.join(dir, "real");
    mkdirSync(realDir, { recursive: true });
    const linkDir = path.join(dir, "link");
    try {
      // junctions need no privilege on Windows; dir symlinks elsewhere.
      symlinkSync(realDir, linkDir, "junction");
    } catch {
      try {
        symlinkSync(realDir, linkDir, "dir");
      } catch {
        console.log(
          "# F-502 symlink case skipped: host refuses symlink creation",
        );
        return;
      }
    }
    const source = path.join(dir, "source.bin");
    writeFileSync(source, "MINE");
    const target = path.join(linkDir, "artifact.bin");

    withFrozenClock(() => {
      assert.throws(
        () => publishArtifactAtomic({ sourcePath: source, targetPath: target }),
        /Symlink path component is not allowed/u,
        "assertNoSymlinkComponents must refuse before mkdir/write",
      );
    });
    assert.equal(
      existsSync(path.join(realDir, "artifact.bin")),
      false,
      "nothing may be materialized through the symlinked ancestor",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-502: a failed publish removes only its own temp residue", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f502-residue-"));
  try {
    const source = path.join(dir, "source.bin");
    writeFileSync(source, "MINE");
    // target path occupied by a DIRECTORY: the rename step must fail.
    const target = path.join(dir, "out", "artifact.bin");
    mkdirSync(target, { recursive: true });
    const tempPath = `${target}.tmp-${process.pid}-${FIXED_NOW}`;

    withFrozenClock(() => {
      assert.throws(
        () => publishArtifactAtomic({ sourcePath: source, targetPath: target }),
        "a rename onto an existing directory must fail",
      );
    });
    assert.equal(
      existsSync(tempPath),
      false,
      "the temp file this call created must be removed after the failure",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-502: the ordinary publish path still works and leaves no temp behind", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "l8-f502-ok-"));
  try {
    const source = path.join(dir, "source.bin");
    writeFileSync(source, "PAYLOAD");
    const target = path.join(dir, "nested", "artifact.bin");

    const result = withFrozenClock(() =>
      publishArtifactAtomic({ sourcePath: source, targetPath: target }),
    );
    assert.equal(result.success, true);
    assert.equal(readFileSync(target, "utf8"), "PAYLOAD");
    assert.equal(
      existsSync(`${target}.tmp-${process.pid}-${FIXED_NOW}`),
      false,
      "no own temp residue after a successful rename",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
