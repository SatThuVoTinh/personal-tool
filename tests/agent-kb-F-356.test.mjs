// F-356 (R7-OC2-01) — the operator-facing Vault rule documented three topic
// tags, none of which the ingest path accepted.
//
// The guidance was written from the topic list rather than from the tag map,
// so it presented slug and invented names as ingest tags. A note that follows
// the rule exactly is refused with a missing-topic error, and the guidance is
// the reason anyone would ever write an alias form.
//
// Acceptance criteria: every tag example in operator documentation is a member
// of the write-side tag map (a test iterates the documented examples), or the
// guidance points at the literal set by name.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const readme = read("platforms", "knowledge-platform", "README.md");
const adapter = read("apps", "knowledge", "app", "markdown_adapter.py");

function writeSideTags() {
  const topics = [...adapter.matchAll(/\("([^"]+)",\s*"(#[a-z0-9-]+)"\)/g)].map(
    (entry) => entry[2],
  );
  assert.ok(topics.length >= 13, "the write-side tag map must be readable");
  const slugs = [...adapter.matchAll(/^\s*"([a-z0-9-]+)":\s*"[^"]+",$/gm)].map(
    (entry) => entry[1],
  );
  return new Set([...topics, ...slugs.map((slug) => `#${slug}`)]);
}

function documentedTags() {
  return [...readme.matchAll(/#[A-Za-z][A-Za-z0-9_-]*/g)].map(
    (entry) => entry[0],
  );
}

test("F-356: every tag example in the operator README is an accepted ingest tag", () => {
  const accepted = writeSideTags();
  const examples = documentedTags();
  assert.ok(examples.length >= 1, "the README must show tag examples");
  for (const example of examples) {
    assert.ok(
      accepted.has(example.toLowerCase()),
      `the README documents '${example}', which the write-side tag map does not accept`,
    );
  }
});

test("F-356: the README names the literal set the ingest path accepts", () => {
  assert.match(
    readme,
    /TOPIC_TAGS|tag map|tập thẻ/i,
    "the README must point at the literal set by name",
  );
});
