// F-349 (R7-OC1-02) — the routed validation procedure demands "every required
// gate" while naming none, and the gate registry is unreachable from the
// authority chain.
//
// The closeout/validation procedure must state where the gate list lives, and the
// governance chain must route to that registry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (...segments) =>
  readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

const VALIDATING_SKILL = read(".agents", "skills", "validating", "SKILL.md");
const AGENTS = read("AGENTS.md");

test("F-349: the validation procedure names the gate registry", () => {
  assert.ok(
    VALIDATING_SKILL.includes("docs/development/conventions.md"),
    "the validation procedure must state where the required gate list lives",
  );
  assert.match(
    VALIDATING_SKILL,
    /required affected gate/iu,
    "the procedure must keep its requirement for every affected gate",
  );
});

test("F-349: the authority chain routes to the gate registry", () => {
  assert.ok(
    AGENTS.includes("docs/development/"),
    "AGENTS.md §1 must carry a `docs/development/` responsibility row so the " +
      "gate registry is reachable from the authority chain",
  );
  assert.ok(
    AGENTS.includes("docs/development/conventions.md"),
    "AGENTS.md must name the gate registry file itself",
  );
});

test("F-349: the registry the procedure names is the one the gate checks", () => {
  const registry = read("docs", "development", "conventions.md");
  assert.match(
    registry,
    /Gate registry/iu,
    "docs/development/conventions.md must own the gate registry table",
  );
  assert.match(
    registry,
    /`verify`/u,
    "the registry must enumerate the verify gate",
  );
});
