// F-293 (R7-C4-06) — model-service response text was interpolated unescaped
// into the acceptance SQL literals.
//
// The acceptance scripts took fields straight out of the local model service's
// response and spliced them into single-quoted SQL literals inside a
// here-string passed to the database client. The strongest validation
// anywhere on these paths was a truthiness test at one site, and the value's
// shape was never constrained: a tags response carrying a quote in its digest
// terminates the literal and produces two statements where one was intended.
//
// Acceptance criteria: every provider-derived value is validated against its
// documented shape before use and passed to the database client as a parameter
// rather than interpolated, and a fixture with a quote-bearing value proves
// the statement cannot be split.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const t1 = read("infrastructure", "docker", "scripts", "knowledge-t1.ps1");
const t3 = read("infrastructure", "docker", "scripts", "knowledge-t3.ps1");
const t5 = read("infrastructure", "docker", "scripts", "knowledge-t5.ps1");
const t5Common = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-common.ps1",
);

// The file in which each driver's provider digest is validated, and the file
// in which it reaches the database client.
const drivers = [
  {
    name: "knowledge-t1.ps1",
    statement: t1,
    validation: t1,
    parameter: t1,
  },
  {
    name: "knowledge-t3.ps1",
    statement: t3,
    validation: t3,
    parameter: t3,
  },
  {
    // The t5 driver reads its digest from the shared model-identity helper.
    name: "knowledge-t5.ps1",
    statement: t5,
    validation: t5Common,
    parameter: t5,
  },
];

test("F-293: no provider digest is interpolated into SQL text", () => {
  for (const driver of drivers) {
    assert.doesNotMatch(
      driver.statement,
      /'\$\(\$model\.digest\)'/,
      `${driver.name}: the provider digest must not be a quoted SQL literal`,
    );
    assert.doesNotMatch(
      driver.statement,
      /'\$\(\$candidate\.embedding\.digest\)'/,
      `${driver.name}: the provider digest must not be a quoted SQL literal`,
    );
    assert.doesNotMatch(
      driver.statement,
      /'\(\$model\.digest\)'/,
      `${driver.name}: the provider digest must not be a quoted SQL literal`,
    );
  }
});

test("F-293: every provider digest is validated against its documented shape", () => {
  for (const driver of drivers) {
    assert.match(
      driver.validation,
      /\[0-9a-f\]\{64\}/,
      `${driver.name}: the digest must be validated against the shape the column accepts`,
    );
  }
});

test("F-293: the digest reaches the database client as a parameter", () => {
  for (const driver of drivers) {
    assert.match(
      driver.statement,
      /:'model_digest'/,
      `${driver.name}: the statement must reference the client variable, not a literal`,
    );
  }
  assert.match(
    t1,
    /--set=model_digest=/,
    "knowledge-t1.ps1 must pass the digest to the client as a variable",
  );
  assert.match(
    t3,
    /--set=model_digest=/,
    "knowledge-t3.ps1 must pass the digest to the client as a variable",
  );
  assert.match(
    t5,
    /-Variables\s*@\{\s*model_digest\s*=\s*\$candidate\.embedding\.digest\s*\}/,
    "knowledge-t5.ps1 must pass the digest to the client as a variable",
  );
});

test("F-293: a quote-bearing provider value can never reach the statement", () => {
  // The gate is the shape check the script applies before the value is used.
  // Executing that gate against a hostile fixture is what proves the value
  // cannot split the statement: it never gets past the gate.
  const match = t1.match(/\$model\.digest\s+-notmatch\s+'([^']+)'/);
  assert.ok(match, "the script must validate the digest shape");
  const shape = new RegExp(match[1]);
  assert.equal(
    shape.test("a".repeat(64)),
    true,
    "a well-formed digest must pass the gate",
  );
  for (const hostile of [
    `${"a".repeat(63)}'`,
    `${"a".repeat(63)}'; DROP TABLE knowledge.indexes; --`,
    "a".repeat(65),
    "",
  ]) {
    assert.equal(
      shape.test(hostile),
      false,
      `a quote-bearing value must be refused by the gate: ${hostile}`,
    );
  }
});
