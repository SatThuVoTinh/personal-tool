// M12/T9-R4 B6 — F-427 (legacy R9-L06-1).
//
// A legal heading longer than the segment budget used to set the byte counter
// and `continue`, bypassing both the budget flush and the byte split. The whole
// heading was emitted as one segment, so every embedding call for that skill
// failed with EMBEDDING_INPUT_TOO_LARGE.
import test from "node:test";
import assert from "node:assert/strict";

import { chunkSkillContent } from "../zink-skill-store/src/vector-sync.mjs";
import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
} from "../zink-tools/common/semantic-contract.mjs";

const MAX_SEGMENT_CONTENT_BYTES = 16 * 1024;

test("F-427: an over-long heading is split under the segment budget", () => {
  const heading = `# ${"h".repeat(40000)}`;
  assert.equal(
    Buffer.byteLength(heading, "utf8"),
    40002,
    "the fixture is the 40,002-byte heading measured in the finding",
  );

  const segments = chunkSkillContent(heading);
  assert.ok(
    segments.length > 1,
    `the 40,002-byte heading must be split, got ${segments.length} segment(s)`,
  );

  for (const segment of segments) {
    assert.ok(
      Buffer.byteLength(segment.content, "utf8") <= MAX_SEGMENT_CONTENT_BYTES,
      `segment ${segment.segment_ordinal} is ${Buffer.byteLength(segment.content, "utf8")} bytes`,
    );
    assert.deepEqual(
      segment.heading_path,
      ["h".repeat(40000)],
      "every piece stays under the heading that produced it",
    );
    assert.doesNotThrow(
      () =>
        renderEmbeddingEnvelope({
          ...deriveSemanticMetadata({
            namespace: ["office"],
            capability: "long-heading",
            tags: [],
          }),
          content: segment.content,
        }),
      `segment ${segment.segment_ordinal} must be embeddable`,
    );
  }

  const kept = segments.reduce(
    (total, segment) => total + segment.content.length,
    0,
  );
  assert.ok(
    kept >= heading.length * 0.98,
    `splitting must not drop heading content: kept ${kept} of ${heading.length}`,
  );
});
