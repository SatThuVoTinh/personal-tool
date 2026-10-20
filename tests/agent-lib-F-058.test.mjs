// M12/T9 F-058 (R1-A02-03): the Skill Store imports the plugin's internal
// file-lock.mjs by relative path, so the deployed tree loaded TWO instances of
// the same source. Each instance had its own `heldTokens` map, so the instance
// that released the lock never saw the acquisition, refused with
// FILE_LOCK_NOT_OWNER, and `withFileLock`'s `finally` swallowed that refusal:
// the lock directory stayed behind and every later writer hit FILE_LOCK_BUSY.
//
// The mechanism is proved here by loading the module TWICE - from its own path
// and from a copy - which is what the deployed dual root does.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import * as original from "../integrations/openclaw/lib/file-lock.mjs";

const LOCK_SOURCE = new URL(
  "../integrations/openclaw/lib/file-lock.mjs",
  import.meta.url,
);

test("F-058: the holder registry is process-global, not per module instance", () => {
  const registry = globalThis[Symbol.for("zink.file-lock.heldTokens")];
  assert.ok(
    registry instanceof Map,
    "one holder map must live on the process, not on a module instance",
  );
});

test("F-058: two loaded copies of the lock module share ONE holder map", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "f058-"));
  const copy = path.join(dir, "file-lock-copy.mjs");
  copyFileSync(LOCK_SOURCE, copy);
  const second = await import(pathToFileURL(copy).href);
  assert.notEqual(
    second,
    original,
    "the copy must be a second module instance, or this proves nothing",
  );

  const lockDir = path.join(dir, "writer.lock");
  assert.equal(original.tryAcquire(lockDir), true);

  // The RELEASE is issued by the OTHER instance. With one holder map it
  // recognises the token this process recorded; with per-instance maps it never
  // saw the acquisition, refused with FILE_LOCK_NOT_OWNER, and stranded the
  // lock directory.
  second.release(lockDir);
  assert.equal(
    existsSync(lockDir),
    false,
    "the lock directory must be released, never stranded",
  );
});
