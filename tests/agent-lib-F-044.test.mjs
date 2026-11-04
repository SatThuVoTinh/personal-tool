// F-044 (R1-A07-02) — the write side's containment is resolved, not lexical.
//
// The lexical test (`path.relative`) cannot see a directory JUNCTION inside
// the workspace: the junction's own path is inside the base, but the bytes it
// points at are not. The read side of the tool already resolved its path
// through the filesystem; the write side did not, so a governed call could
// write a workbook outside its sandbox.
//
// The lane builds a real junction inside a sandbox, points the tool at a
// path under it, and asserts the call is refused with ARTIFACT_PATH_ESCAPE
// and that nothing was created outside the base.
//
// Where the platform refuses to create a junction (Windows without the
// privilege), the case SKIPS with the reason — it never passes vacuously.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeExcelOperation } from "../integrations/openclaw/lib/excel-writer.mjs";

function makeJunction(target, link) {
  try {
    symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

test("F-044: a workbook target under a junction inside the sandbox is refused", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f044-"));
  const outside = path.join(root, "outside");
  const sandbox = path.join(root, "sandbox");
  mkdirSync(outside, { recursive: true });
  mkdirSync(sandbox, { recursive: true });
  const junction = path.join(sandbox, "escape");
  try {
    if (!makeJunction(outside, junction)) {
      // F-525 (legacy `R10-L11-1`): this used to call the ROOT-level
      // `test.skip(name)` from inside the case body. That API registers a NEW
      // root case and leaves the running case to hit the bare `return`, so the
      // escape case was reported as a pass with its four containment asserts
      // never executed, and the report gained a phantom sibling. `t.skip()`
      // skips THIS case, which is the only honest verdict when the platform
      // refuses the junction.
      t.skip(
        "the platform refuses to create a directory junction, so the escape case is NOT RUN here",
      );
      return;
    }
    const target = path.join(junction, "proof.xlsx");
    let error = null;
    try {
      executeExcelOperation(
        {
          operation: "create",
          file_path: "escape/proof.xlsx",
          data: [{ a: 1 }],
        },
        sandbox,
      );
    } catch (err) {
      error = err;
    }
    assert.ok(error, "the call must be refused");
    assert.match(
      String(error.message ?? error),
      /ARTIFACT_PATH_ESCAPE/u,
      `the refusal must be named, got ${error?.message ?? error}`,
    );
    assert.deepEqual(
      readdirSync(outside),
      [],
      "nothing may be created outside the base",
    );
    assert.ok(
      !existsSync(target),
      "the workbook must not exist outside the base",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-044: a workbook target inside the sandbox is still allowed", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f044-ok-"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(sandbox, { recursive: true });
  try {
    const result = executeExcelOperation(
      {
        operation: "create",
        file_path: "proof.xlsx",
        data: [{ a: 1 }],
      },
      sandbox,
    );
    assert.equal(result?.status, "success");
    assert.ok(
      existsSync(path.join(sandbox, "proof.xlsx")),
      "the workbook must exist inside the base",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-OC-003: a workbook target that is a dangling symlink or junction pointing outside the sandbox is refused", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-foc003-"));
  const outside = path.join(root, "outside");
  const sandbox = path.join(root, "sandbox");
  mkdirSync(outside, { recursive: true });
  mkdirSync(sandbox, { recursive: true });

  const outsideTarget = path.join(outside, "escaped.xlsx");
  const danglingLink = path.join(sandbox, "dangling.xlsx");
  let filePath = "dangling.xlsx";

  let created = false;
  try {
    symlinkSync(outsideTarget, danglingLink, "file");
    created = true;
  } catch {
    const danglingDir = path.join(sandbox, "dangling_dir");
    try {
      symlinkSync(path.join(outside, "nonexistent_sub"), danglingDir, "junction");
      filePath = "dangling_dir/escaped.xlsx";
      created = true;
    } catch {
      // platform refuses
    }
  }

  if (!created) {
    t.skip("the platform refuses to create symlinks or junctions");
    return;
  }

  try {
    let error = null;
    try {
      executeExcelOperation(
        {
          operation: "create",
          file_path: filePath,
          data: [{ a: 1 }],
        },
        sandbox,
      );
    } catch (err) {
      error = err;
    }

    assert.ok(error, "the call must be refused");
    assert.match(
      String(error.message ?? error),
      /ARTIFACT_PATH_ESCAPE/u,
      `the refusal must be named ARTIFACT_PATH_ESCAPE, got ${error?.message ?? error}`,
    );
    assert.ok(
      !existsSync(outsideTarget),
      "the workbook must not be created outside the sandbox via dangling symlink",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
