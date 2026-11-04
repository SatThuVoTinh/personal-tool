// M12/T9-R4 — F-554 (legacy R10-T06-6): a swallowed child exit status made the
// Python artifact validator return valid:true when the interpreter never
// answered (ENOENT / timeout overrun arrive with status:null and empty stderr).
// The fix separates "the interpreter refused" from "the interpreter never
// answered" (PYTHON_INTERPRETER_UNAVAILABLE, never valid:true) and the caller
// must never stamp checks.pythonSyntax true over a non-answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { validatePythonSyntax, validateTechnicalArtifact } = await import(
  new URL(
    "../integrations/openclaw/lib/artifact-validator.mjs",
    import.meta.url,
  ).href
);

const BAD_SOURCE = "x = 1 +\ny = 2\n";
const GOOD_SOURCE = "x = 1 + 1\n";

function makeDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === null) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

function hostHasPython() {
  try {
    execFileSync("python", ["--version"], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

test("F-554: a missing python binary (ENOENT) yields valid:false, never the structural counter", () => {
  const dir = makeDir("l8-f554-enoent-");
  try {
    const file = path.join(dir, "bad.py");
    writeFileSync(file, BAD_SOURCE);
    // Inject the missing binary: with PATH empty, `python` resolves to nothing.
    const result = withEnv("PATH", "", () =>
      validatePythonSyntax(file, BAD_SOURCE),
    );
    assert.equal(
      result.valid,
      false,
      "a non-answering interpreter is not a pass",
    );
    assert.equal(result.method, "interpreter_unavailable");
    assert.match(result.error, /PYTHON_INTERPRETER_UNAVAILABLE/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-554: the artifact tier never stamps checks.pythonSyntax true over a non-answer", () => {
  const dir = makeDir("l8-f554-tier-");
  try {
    const file = path.join(dir, "artifact.py");
    writeFileSync(file, BAD_SOURCE);
    const result = withEnv("PATH", "", () =>
      validateTechnicalArtifact({ filePath: file }),
    );
    assert.equal(result.status, "FAIL");
    assert.equal(result.checks.pythonSyntax, false);
    assert.ok(
      result.errors.some((e) => /PYTHON_INTERPRETER_UNAVAILABLE/u.test(e)),
      `errors must name the unavailable validator, got: ${JSON.stringify(result.errors)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-554: a timeout overrun (status:null, SIGTERM) yields valid:false, not valid:true", (t) => {
  const dir = makeDir("l8-f554-timeout-");
  try {
    const file = path.join(dir, "bad.py");
    writeFileSync(file, BAD_SOURCE);

    let result;
    if (hostHasPython()) {
      // Real interpreter, forced to hang past the 5000 ms execFileSync
      // timeout: site imports sitecustomize.py from PYTHONPATH at startup.
      const hangDir = path.join(dir, "hang");
      mkdirSync(hangDir, { recursive: true });
      writeFileSync(
        path.join(hangDir, "sitecustomize.py"),
        "import time\ntime.sleep(30)\n",
      );
      const savedPath = process.env.PYTHONPATH;
      result = withEnv(
        "PYTHONPATH",
        savedPath ? `${hangDir}${path.delimiter}${savedPath}` : hangDir,
        () => validatePythonSyntax(file, BAD_SOURCE),
      );
    } else if (process.platform !== "win32") {
      // POSIX shim: a `python` that sleeps forever.
      const shimDir = path.join(dir, "shim");
      mkdirSync(shimDir, { recursive: true });
      const shim = path.join(shimDir, "python");
      writeFileSync(shim, "#!/bin/sh\nsleep 30\n");
      chmodSync(shim, 0o755);
      const savedPath = process.env.PATH;
      result = withEnv(
        "PATH",
        `${shimDir}${path.delimiter}${savedPath ?? ""}`,
        () => validatePythonSyntax(file, BAD_SOURCE),
      );
    } else {
      t.skip(
        "timeout injection NOT RUN: host carries no python executable and win32 cannot shim one",
      );
      return;
    }

    assert.equal(result.valid, false, "a timed-out interpreter never answered");
    assert.equal(result.method, "interpreter_unavailable");
    assert.match(result.error, /PYTHON_INTERPRETER_UNAVAILABLE/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F-554 control: with the interpreter answering, py_compile still distinguishes bad from good", (t) => {
  if (!hostHasPython()) {
    t.skip("control NOT RUN: host carries no python executable");
    return;
  }
  const dir = makeDir("l8-f554-control-");
  try {
    const bad = path.join(dir, "bad.py");
    const good = path.join(dir, "good.py");
    writeFileSync(bad, BAD_SOURCE);
    writeFileSync(good, GOOD_SOURCE);
    const badResult = validatePythonSyntax(bad, BAD_SOURCE);
    const goodResult = validatePythonSyntax(good, GOOD_SOURCE);
    assert.equal(badResult.valid, false);
    assert.equal(badResult.method, "py_compile");
    assert.match(badResult.error, /INVALID_PYTHON_SYNTAX/u);
    assert.equal(goodResult.valid, true);
    assert.equal(goodResult.method, "py_compile");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
