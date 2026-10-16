import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  hostEnforcesPosixModes,
  requireMode,
} from "../integrations/openclaw/verify.mjs";

// R5-E08-04: verify.mjs asserted POSIX modes unconditionally, so the operator-facing gate
// could not produce evidence on the host the evidence was produced on. configure.mjs already
// skipped them (configure.mjs:985-995); this pins that verify.mjs does the same, and that the
// POSIX branch is still a real assertion rather than a second skip path.

test("win32 cannot express 0600/0700, so the mode assertions do not apply there", () => {
  assert.equal(hostEnforcesPosixModes("win32"), false);
});

test("a POSIX host still enforces modes", () => {
  assert.equal(hostEnforcesPosixModes("linux"), true);
  assert.equal(hostEnforcesPosixModes("darwin"), true);
});

test("requireMode skips an unsatisfiable mode on win32 and still throws on POSIX", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "m12-t2.2-b3-mode-"));
  try {
    const filePath = path.join(directory, "identity.key");
    writeFileSync(filePath, "placeholder-not-a-secret");
    chmodSync(filePath, 0o644);
    if (process.platform === "win32") {
      requireMode(filePath, 0o600);
    } else {
      assert.throws(() => requireMode(filePath, 0o600), /Unexpected mode/u);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a conforming mode still passes on every host", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "m12-t2.2-b3-mode-"));
  try {
    const filePath = path.join(directory, "identity.key");
    writeFileSync(filePath, "placeholder-not-a-secret");
    chmodSync(filePath, 0o600);
    requireMode(filePath, 0o600);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
