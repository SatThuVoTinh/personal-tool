// M12/T2.2-R2 B-4 — `R5-E08-05` ("an empty live list printed as PASS") is unreachable,
// and this file is the executable statement of WHY (`ACTIVE.md` §0.5-C).
//
// The finding asked for a guard on `--live` with `result.live.length === 0`. Measured
// against source, that branch cannot be reached:
//
//   1. the probe list at `verify.mjs:571` always declares at least one configured-free
//      probe, so `items` is never empty;
//   2. `runInBatches` produces exactly one entry per item, in order — it cannot drop a
//      probe while the list is non-empty;
//   3. `runLiveAsync` returns a verdict for both outcomes — an entry is never
//      verdict-less, and `main()` exits non-zero on any `FAIL`.
//
// Adding `if (result.live.length === 0) throw` would therefore be dead code that reads
// like a control. What this item ships instead is the three properties themselves, so
// that a future change which makes the degenerate shape reachable reddens a test rather
// than printing `{"static":"PASS","live":[]}` and being trusted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";

import {
  runInBatches,
  runLiveAsync,
} from "../integrations/openclaw/verify.mjs";

const VERIFY_SOURCE = readFileSync(
  new URL("../integrations/openclaw/verify.mjs", import.meta.url),
  "utf8",
);

test("B-4-1: the --live probe list always declares a probe that needs no configuration", () => {
  const at = VERIFY_SOURCE.indexOf("const commands = [");
  assert.notEqual(at, -1, "the live probe list must still be declared");
  const list = VERIFY_SOURCE.slice(at, VERIFY_SOURCE.indexOf("\n    ];", at));
  assert.match(
    list,
    /\[\s*"config",\s*"validate"\s*\]/u,
    "at least one entry must be unconditional: an empty `commands` array is the only way `--live` prints `live: []`",
  );
});

test("B-4-2: runInBatches yields exactly one result per item, in order", async () => {
  const items = [0, 1, 2, 3, 4, 5, 6];
  const results = await runInBatches(items, 2, async (item) => ({
    command: `probe-${item}`,
    status: "PASS",
  }));
  assert.deepEqual(
    results.map((result) => result.command),
    items.map((item) => `probe-${item}`),
    "a probe that did not run must not be able to disappear from the result the operator reads as PASS",
  );
});

test("B-4-3: every live probe answers with a verdict, including the ones that fail", async () => {
  const failed = await runLiveAsync(
    process.execPath,
    ["-e", "process.exit(3)"],
    process.env,
  );
  const passed = await runLiveAsync(process.execPath, ["-e", ""], process.env);
  for (const entry of [failed, passed]) {
    assert.ok(
      ["PASS", "FAIL"].includes(entry.status),
      `a verdict is mandatory, got ${JSON.stringify(entry)}`,
    );
  }
  assert.equal(failed.status, "FAIL");
  assert.equal(passed.status, "PASS");
});
