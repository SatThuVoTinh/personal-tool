// F-341 (R7-OA-04) — the T5 acceptance nginx overlay defined the same
// location as `default.conf` without its three proxy timeouts.
//
// The acceptance conf was written as a parallel copy of the production
// location block instead of a superseding fragment, so the directives added
// to `default.conf` later never reached it, and nginx's 60 s default then
// applied to the very run that exercises the long index/embed paths.
//
// Acceptance criteria: one source of truth for the `/knowledge/` proxy
// settings (a shared fragment, or a test that asserts the acceptance conf
// carries every directive the production conf declares).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const production = read("infrastructure", "nginx", "conf.d", "default.conf");
const acceptance = read(
  "infrastructure",
  "nginx",
  "conf.d",
  "t5-acceptance.conf",
);

function knowledgeLocation(source, name) {
  const match = source.match(/location \/knowledge\/ \{[\s\S]*?\n {4}\}/);
  assert.ok(match, `${name} must declare the /knowledge/ location`);
  return match[0];
}

test("F-341: the production conf declares the three proxy timeouts", () => {
  const block = knowledgeLocation(production, "default.conf");
  for (const directive of [
    "proxy_connect_timeout",
    "proxy_read_timeout",
    "proxy_send_timeout",
  ]) {
    assert.match(
      block,
      new RegExp(`${directive}\\s+\\d+s`),
      `default.conf must declare ${directive}`,
    );
  }
});

test("F-341: the acceptance conf carries every directive the production conf declares", () => {
  const productionBlock = knowledgeLocation(production, "default.conf");
  const acceptanceBlock = knowledgeLocation(acceptance, "t5-acceptance.conf");
  const directives = [
    ...productionBlock.matchAll(/^\s*([a-z_]+)\s+[^;]+;/gm),
  ].map((entry) => entry[1]);
  assert.ok(
    directives.length >= 5,
    "the production block must declare directives",
  );
  for (const directive of directives) {
    assert.match(
      acceptanceBlock,
      new RegExp(`\\b${directive}\\b`),
      `t5-acceptance.conf must declare ${directive}: the acceptance run must not fall back to nginx's defaults`,
    );
  }
});

test("F-341: the acceptance timeouts are the production values", () => {
  const productionBlock = knowledgeLocation(production, "default.conf");
  const acceptanceBlock = knowledgeLocation(acceptance, "t5-acceptance.conf");
  for (const directive of [
    "proxy_connect_timeout",
    "proxy_read_timeout",
    "proxy_send_timeout",
  ]) {
    const expected = productionBlock.match(
      new RegExp(`${directive}\\s+(\\d+s)`),
    )[1];
    assert.match(
      acceptanceBlock,
      new RegExp(`${directive}\\s+${expected}\\b`),
      `t5-acceptance.conf must use the production ${directive} value (${expected})`,
    );
  }
});
