// F-239 (R7-D3-02) — the live overlay carries the only writable bind and the
// live privilege block, and no enforced lane parsed it.
//
// compose.m4-t5.live.yml is the one overlay that adds `read_only: false` (the
// backup barrier) together with the hardening keys. It was referenced only by
// a manual acceptance script, so deleting `cap_drop: ALL` from it kept every
// enforced lane green.
//
// Acceptance criteria: a verify-lane test parses `compose.m4-t5.live.yml` and
// asserts the privilege hardening plus that the only writable bind targets the
// backup-barrier path, never `/vault`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

function compose(...parts) {
  const document = parseDocument(read(...parts), { merge: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Docker Compose merge semantics: mappings merge key by key, and `volumes`
// APPEND (a later file adds a mount, it does not replace the list).
function mergeCompose(base, overlay) {
  const output = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "volumes" && Array.isArray(value)) {
      output.volumes = [...(base.volumes ?? []), ...value];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(base[key])) {
      output[key] = mergeCompose(base[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function liveKnowledgeService() {
  const core = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.core.yml",
  );
  const knowledge = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.knowledge.yml",
  );
  const live = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.m4-t5.live.yml",
  );
  return mergeCompose(
    mergeCompose(core.services.knowledge, knowledge.services.knowledge),
    live.services.knowledge,
  );
}

test("F-239: the live overlay hardens the Knowledge service", () => {
  const live = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.m4-t5.live.yml",
  );
  const knowledge = live.services.knowledge;

  assert.equal(
    knowledge.read_only,
    true,
    "the live overlay keeps the service root read-only",
  );
  assert.deepEqual(knowledge.cap_drop, ["ALL"], "every capability is dropped");
  assert.deepEqual(knowledge.security_opt, ["no-new-privileges:true"]);
  assert.equal(knowledge.pids_limit, 256);
});

test("F-239: the only writable bind is the backup barrier, never the Vault", () => {
  const knowledge = liveKnowledgeService();
  const volumes = knowledge.volumes ?? [];
  const writable = volumes.filter((volume) => volume.read_only === false);

  assert.equal(
    writable.length,
    1,
    `exactly one bind may be writable, found ${writable.length}`,
  );
  assert.equal(
    writable[0].target,
    "/acceptance-backup-barrier",
    "the writable bind must target the backup-barrier path",
  );
  for (const volume of volumes) {
    if (volume.target === "/vault") {
      assert.equal(
        volume.read_only,
        true,
        "the Vault bind must never be writable",
      );
    }
  }
  assert.ok(
    !writable.some((volume) => volume.target === "/vault"),
    "the Vault must never be a writable bind",
  );
});

// F-INFRA-003 - the NORMAL start path must assemble the same hardening the
// acceptance overlay proves. The shipped hardening overlay is referenced
// unconditionally: a `Test-Path` guard around it would let a missing overlay
// silently downgrade the normal deployment to the unhardened composition,
// which is the exact degradation this row measured.
test("F-INFRA-003: the normal start assembles the hardening overlay unconditionally", () => {
  const start = read("infrastructure", "docker", "scripts", "start.ps1");

  assert.match(
    start,
    /compose[\\/]compose\.knowledge\.hardening\.yml/u,
    "start.ps1 must reference the shipped hardening overlay",
  );
  assert.ok(
    start.includes(
      '$composeArguments += @("-f", $knowledgeHardeningComposeFile)',
    ),
    "start.ps1 must append the hardening overlay to the composed file list",
  );
  assert.ok(
    !start.includes(
      "if (Test-Path -LiteralPath $knowledgeHardeningComposeFile",
    ),
    "a Test-Path guard lets a missing overlay silently skip every control",
  );
});

test("F-INFRA-003: the shipped hardening overlay keeps the five live controls", () => {
  const hardening = compose(
    "infrastructure",
    "docker",
    "compose",
    "compose.knowledge.hardening.yml",
  );
  const knowledge = hardening.services.knowledge;

  assert.equal(
    knowledge.read_only,
    true,
    "the normal deployment keeps the root filesystem read-only",
  );
  assert.deepEqual(
    knowledge.cap_drop,
    ["ALL"],
    "the normal deployment drops every capability",
  );
  assert.deepEqual(knowledge.security_opt, ["no-new-privileges:true"]);
  assert.equal(knowledge.pids_limit, 256);
  assert.deepEqual(
    knowledge.tmpfs,
    ["/tmp:rw,nosuid,nodev,noexec,size=768m,mode=1777"],
    "the /tmp tmpfs must stay the declared hardened shape",
  );
});
