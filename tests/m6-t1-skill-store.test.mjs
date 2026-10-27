// SKIP-FAMILY: symlink
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyCliError,
  executeCli,
} from "../zink-skill-store/bin/skill-store.mjs";
import { recoverSkillStoreLock } from "../zink-skill-store/bin/skill-store-lock-recovery.mjs";
import {
  promoteApprovedSkillWithLock,
  scanCatalog,
  skillStoreWriterLockDir,
} from "../zink-skill-store/src/catalog.mjs";

async function temporaryStore(callback) {
  const root = mkdtempSync(path.join(tmpdir(), "zink-skill-store-"));
  try {
    await callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function manifest(overrides = {}) {
  const { markdown = Buffer.from("# Skill\n", "utf8"), ...fields } = overrides;
  return {
    markdown,
    value: {
      schema_version: 1,
      identity: {
        namespace: ["supply-chain", "inventory"],
        capability: "safety-stock",
        version: "1.0.0",
      },
      content: { path: "SKILL.md", sha256: digest(markdown) },
      provenance: { source_type: "research", references: [] },
      lifecycle: [
        { status: "CANDIDATE", at: "2026-09-03T01:00:00Z", actor: "owner" },
        {
          status: "ACTIVE",
          at: "2026-09-03T04:00:00Z",
          actor: "owner",
          decision_ref: "PLAN:M6/T1-R4",
        },
      ],
      ...fields,
    },
  };
}

function writeSkill(root, options = {}) {
  const namespace = options.namespace ?? ["supply-chain", "inventory"];
  const capability = options.capability ?? "safety-stock";
  const version = options.version ?? "1.0.0";
  const directory = path.join(root, ...namespace, capability, version);
  mkdirSync(directory, { recursive: true });
  const data = manifest({ markdown: options.markdown });
  const value = options.value ?? data.value;
  if (!options.value) {
    value.identity.namespace = namespace;
    value.identity.capability = capability;
    value.identity.version = version;
  }
  writeFileSync(
    path.join(directory, "manifest.json"),
    options.manifestBytes ?? JSON.stringify(value),
  );
  writeFileSync(path.join(directory, "SKILL.md"), data.markdown);
  return directory;
}

async function catalog(root) {
  return scanCatalog(root);
}

test("accepts an empty catalog and has byte-exact validation output", async () => {
  await temporaryStore(async (root) => {
    const result = await executeCli(["validate"], root);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"status":"valid","manifest_count":0}\n');
    assert.equal(result.stderr, "");
  });
});

test("retrieves the exact active manifest and preserves CRLF Markdown", async () => {
  await temporaryStore(async (root) => {
    const markdown = Buffer.from("# Skill\r\n\r\nContent\r\n", "utf8");
    writeSkill(root, { markdown });
    const result = await executeCli(
      [
        "get",
        "--capability",
        "safety-stock",
        "--namespace",
        "supply-chain/inventory",
      ],
      root,
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.endsWith("\n"), true);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.skill.markdown, markdown.toString("utf8"));
    assert.equal(parsed.skill.manifest.identity.version, "1.0.0");
  });
});

test("rejects every invalid lifecycle history and lifecycle time violation", async () => {
  const histories = [
    [],
    [
      {
        status: "ACTIVE",
        at: "2026-09-03T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M6/T1-R4",
      },
    ],
    [
      { status: "CANDIDATE", at: "2026-09-03T01:00:00Z", actor: "owner" },
      { status: "CANDIDATE", at: "2026-09-03T01:00:00Z", actor: "owner" },
    ],
    [
      { status: "CANDIDATE", at: "2026-09-03T04:00:00Z", actor: "owner" },
      {
        status: "ACTIVE",
        at: "2026-09-03T01:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M6/T1-R4",
      },
    ],
  ];
  for (const lifecycle of histories) {
    await temporaryStore(async (root) => {
      writeSkill(root, { value: { ...manifest().value, lifecycle } });
      assert.notEqual((await catalog(root)).errors.length, 0);
    });
  }
});

test("accepts all four legal lifecycle histories", async () => {
  const histories = [
    [{ status: "CANDIDATE", at: "2026-09-03T01:00:00Z", actor: "owner" }],
    manifest().value.lifecycle,
    [
      ...manifest().value.lifecycle,
      {
        status: "DEPRECATED",
        at: "2026-09-03T04:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M6/T1-R4",
      },
    ],
    [
      { status: "CANDIDATE", at: "2026-09-03T01:00:00Z", actor: "owner" },
      {
        status: "REJECTED",
        at: "2026-09-03T04:00:00Z",
        actor: "owner",
        decision_ref: "PLAN:M6/T1-R4",
      },
    ],
  ];
  for (const lifecycle of histories) {
    await temporaryStore(async (root) => {
      writeSkill(root, { value: { ...manifest().value, lifecycle } });
      assert.deepEqual((await catalog(root)).errors, []);
    });
  }
});

test("detects duplicate JSON keys at top-level and nested levels", async () => {
  for (const bytes of [
    '{"schema_version":1,"schema_version":1}',
    '{"schema_version":1,"identity":{"namespace":[],"namespace":[]}}',
  ]) {
    await temporaryStore(async (root) => {
      writeSkill(root, { manifestBytes: bytes });
      assert.equal(
        (await catalog(root)).errors[0].code,
        "MANIFEST_JSON_DUPLICATE_KEY",
      );
    });
  }
  await temporaryStore(async (root) => {
    writeSkill(root, {
      manifestBytes: '{"private-value":1,"private-value":2}',
    });
    const result = await executeCli(["validate"], root);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.includes("private-value"), false);
  });
});

test("rejects malformed JSON, schema errors, unsafe provenance, and bad UTF-8", async () => {
  await temporaryStore(async (root) => {
    writeSkill(root, { manifestBytes: "{" });
    assert.equal((await catalog(root)).errors[0].code, "MANIFEST_JSON_INVALID");
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.statuz = "ACTIVE";
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "MANIFEST_SCHEMA_INVALID",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.lifecycle = {};
    writeSkill(root, { value });
    const result = await executeCli(["validate"], root);
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stderr).error.code, "CATALOG_INVALID");
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.provenance.references = [{ type: "repository", ref: "../secret" }];
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "UNSAFE_PROVENANCE_REFERENCE",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.provenance.references = [
      { type: "repository", ref: "mailto:owner@example.test" },
    ];
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "UNSAFE_PROVENANCE_REFERENCE",
      ),
    );
  });
  await temporaryStore(async (root) => {
    writeSkill(root, { manifestBytes: Buffer.from([0xff]) });
    assert.equal((await catalog(root)).errors[0].code, "INVALID_UTF8");
  });
  await temporaryStore(async (root) => {
    writeSkill(root, { markdown: Buffer.from([0xff]) });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "INVALID_UTF8",
      ),
    );
  });
});

test("keeps malformed top-level JSON values catalog-invalid", async () => {
  await temporaryStore(async (root) => {
    writeSkill(root, { manifestBytes: "null" });
    const result = await catalog(root);
    assert.ok(
      result.errors.some((error) => error.code === "MANIFEST_SCHEMA_INVALID"),
    );
    assert.equal(
      result.errors.some((error) => error.code === "SKILLS_ROOT_MISSING"),
      false,
    );
  });
});

test("rejects path mismatch, digest mismatch, and multiple active versions", async () => {
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.identity.version = "2.0.0";
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "IDENTITY_PATH_MISMATCH",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.content.sha256 = "0".repeat(64);
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "CONTENT_DIGEST_MISMATCH",
      ),
    );
  });
  await temporaryStore(async (root) => {
    writeSkill(root);
    writeSkill(root, { version: "2.0.0" });
    const result = await catalog(root);
    const clash = result.errors.find(
      (error) => error.code === "MULTIPLE_ACTIVE_VERSIONS",
    );
    assert.ok(clash, "the two ACTIVE versions must be diagnosed");
    //
    //
    // F-222: the diagnostic must name BOTH offending records, and the healthy
    // records must survive instead of the whole catalog collapsing to `[]`.
    assert.match(
      clash.message,
      /1\.0\.0/u,
      `the diagnostic must name the first offending record: ${clash.message}`,
    );
    assert.match(
      clash.message,
      /2\.0\.0/u,
      `the diagnostic must name the second offending record: ${clash.message}`,
    );
    assert.equal(
      result.records.length,
      2,
      "the healthy records must survive an unrelated diagnostic",
    );
  });
  // F-222: the sanctioned writer still refuses to create the two-ACTIVE state
  // the reader detects, so the invariant stays unreachable through the writer.
  await temporaryStore(async (root) => {
    writeSkill(root);
    await assert.rejects(
      () =>
        promoteApprovedSkillWithLock({
          skillsRoot: root,
          namespace: ["supply-chain", "inventory"],
          capability: "safety-stock",
          version: "2.0.0",
          content: "# Second\n\nAnother version.",
          requestingActor: "excel",
          decisionRef: "PLAN:M6/T1-R4",
        }),
      (error) => {
        assert.equal(error.code, "SKILL_ACTIVE_CONFLICT");
        return true;
      },
    );
  });
});

test("rejects malformed trees, version extras, and symbolic links", async () => {
  await temporaryStore(async (root) => {
    mkdirSync(path.join(root, "supply-chain", "inventory"), {
      recursive: true,
    });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "DIRECTORY_GRAMMAR_INVALID",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const directory = writeSkill(root);
    writeFileSync(path.join(directory, "extra.txt"), "extra\n");
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "VERSION_DIRECTORY_CONTENT_INVALID",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const target = path.join(root, "target");
    mkdirSync(target);
    symlinkSync(
      target,
      path.join(root, "supply-chain"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "DIRECTORY_GRAMMAR_INVALID",
      ),
    );
  });
});

test("enforces exact byte and collection limits without truncation", async () => {
  await temporaryStore(async (root) => {
    const markdown = Buffer.alloc(262_144, 0x61);
    const value = manifest({ markdown }).value;
    const serialized = Buffer.from(JSON.stringify(value), "utf8");
    const manifestBytes = Buffer.concat([
      serialized,
      Buffer.alloc(65_536 - serialized.length, 0x20),
    ]);
    writeSkill(root, { manifestBytes, markdown });
    assert.deepEqual((await catalog(root)).errors, []);
  });
  await temporaryStore(async (root) => {
    const bytes = Buffer.alloc(65_537, 0xff);
    writeSkill(root, { manifestBytes: bytes });
    assert.deepEqual(
      (await catalog(root)).errors.map((error) => error.code),
      ["MANIFEST_SIZE_LIMIT_EXCEEDED"],
    );
  });
  await temporaryStore(async (root) => {
    const markdown = Buffer.alloc(262_145, 0xff);
    writeSkill(root, { markdown });
    assert.deepEqual(
      (await catalog(root)).errors.map((error) => error.code),
      ["MARKDOWN_SIZE_LIMIT_EXCEEDED"],
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.provenance.references = Array.from({ length: 32 }, () => ({
      type: "plan",
      ref: "M6/T1-R4",
    }));
    writeSkill(root, { value });
    assert.deepEqual((await catalog(root)).errors, []);
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.provenance.references = Array.from({ length: 33 }, () => ({
      type: "plan",
      ref: "M6/T1-R4",
    }));
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "PROVENANCE_REFERENCE_LIMIT_EXCEEDED",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.lifecycle = Array.from({ length: 64 }, (_, index) => ({
      status: "CANDIDATE",
      at: `2026-09-03T01:00:${String(index % 60).padStart(2, "0")}Z`,
      actor: "owner",
    }));
    writeSkill(root, { value });
    assert.equal(
      (await catalog(root)).errors.some(
        (error) => error.code === "LIFECYCLE_EVENT_LIMIT_EXCEEDED",
      ),
      false,
    );
  });
  await temporaryStore(async (root) => {
    const value = manifest().value;
    value.lifecycle = Array.from({ length: 65 }, (_, index) => ({
      status: "CANDIDATE",
      at: `2026-09-03T01:00:${String(index % 60).padStart(2, "0")}Z`,
      actor: "owner",
    }));
    writeSkill(root, { value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "LIFECYCLE_EVENT_LIMIT_EXCEEDED",
      ),
    );
  });
});

test("accepts 1,000 manifests and rejects manifest 1,001", async () => {
  await temporaryStore(async (root) => {
    for (let index = 0; index < 1000; index += 1) {
      const version = `1.0.${index}`;
      const value = manifest().value;
      value.identity.version = version;
      value.lifecycle = [
        {
          status: "CANDIDATE",
          at: "2026-09-03T01:00:00Z",
          actor: "owner",
        },
      ];
      writeSkill(root, { version, value });
    }
    assert.deepEqual((await catalog(root)).errors, []);
    const value = manifest().value;
    value.identity.version = "1.0.1000";
    value.lifecycle = [
      {
        status: "CANDIDATE",
        at: "2026-09-03T01:00:00Z",
        actor: "owner",
      },
    ];
    writeSkill(root, { version: "1.0.1000", value });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "MANIFEST_LIMIT_EXCEEDED",
      ),
    );
  });
});

test("orders diagnostics deterministically and validates reference variants", async () => {
  await temporaryStore(async (root) => {
    const first = manifest().value;
    first.content.sha256 = "0".repeat(64);
    writeSkill(root, { capability: "zeta", value: first });
    const second = manifest().value;
    second.provenance.references = [
      { type: "url", ref: "http://example.test" },
    ];
    writeSkill(root, { capability: "alpha", value: second });
    const errors = (await catalog(root)).errors;
    assert.deepEqual(
      [...errors].sort(
        (left, right) =>
          compareStrings(left.path, right.path) ||
          compareStrings(left.code, right.code),
      ),
      errors,
    );
    assert.ok(
      errors.some((error) => error.code === "UNSAFE_PROVENANCE_REFERENCE"),
    );
  });
});

test("uses locale-independent lexical diagnostic ordering", async () => {
  await temporaryStore(async (root) => {
    writeFileSync(path.join(root, "ä"), "invalid\n");
    writeFileSync(path.join(root, "z"), "invalid\n");
    assert.deepEqual(
      (await catalog(root)).errors.map((error) => error.path),
      ["skills/z", "skills/ä"],
    );
  });
});

test("rejects links at root and content-file boundaries", async () => {
  await temporaryStore(async (root) => {
    const target = mkdtempSync(path.join(tmpdir(), "zink-skill-target-"));
    try {
      rmSync(root, { force: true, recursive: true });
      symlinkSync(
        target,
        root,
        process.platform === "win32" ? "junction" : "dir",
      );
      assert.ok(
        (await catalog(root)).errors.some(
          (error) => error.code === "UNSAFE_PATH",
        ),
      );
    } finally {
      rmSync(target, { force: true, recursive: true });
    }
  });
});

// The file-symlinked SKILL.md scenario used to live inside the case above and
// to return early on Windows, so the reporter printed a plain PASS for a
// scenario that never ran. It is its own case now and carries the same
// declarative skip its siblings use, so a Windows run reports it as skipped
// instead of silently inflating the pass count.
test(
  "rejects a file symlinked over a skill content file",
  { skip: process.platform === "win32" },
  async () => {
    await temporaryStore(async (root) => {
      const directory = writeSkill(root);
      const target = path.join(root, "target.md");
      writeFileSync(target, "# target\n");
      rmSync(path.join(directory, "SKILL.md"));
      symlinkSync(target, path.join(directory, "SKILL.md"), "file");
      assert.ok(
        (await catalog(root)).errors.some(
          (error) => error.code === "UNSAFE_PATH",
        ),
      );
    });
  },
);

// This scenario used to be Windows-only (`{ skip: process.platform !== "win32" }`),
// which meant no enforced lane ever executed it: the CI lane runs on ubuntu,
// where the case was reported as a skip. The link this case exercises is a
// symlinked skill directory, and the catalog refuses one through `lstat`
// (`isSymbolicLink()`), which is the same check on every platform — so the
// scenario is expressible everywhere with the platform's directory-link type.
// Running it on every lane is the lane-independent equivalent the finding
// asks for: the ubuntu CI lane now executes the case instead of skipping it.
test("treats a symlinked skill directory as a separately covered rejected link", async () => {
  await temporaryStore(async (root) => {
    const target = mkdtempSync(path.join(tmpdir(), "zink-skill-target-"));
    try {
      // The link points at a VALID skill tree, so the same tree copied in
      // place would be accepted and the only reason for a refusal is the
      // link itself. A refusal that any invalid directory also produces
      // would prove nothing about link coverage.
      writeSkill(target, {});
      symlinkSync(
        path.join(target, "supply-chain"),
        path.join(root, "supply-chain"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const errors = (await catalog(root)).errors;
      assert.notEqual(errors.length, 0);
      assert.ok(
        errors.some((error) => error.path.endsWith("supply-chain")),
        `the refusal must name the symlinked entry, got: ${JSON.stringify(errors)}`,
      );
    } finally {
      rmSync(target, { force: true, recursive: true });
    }
  });
});

test("fails closed when another catalog record is invalid", async () => {
  await temporaryStore(async (root) => {
    writeSkill(root);
    const value = manifest().value;
    value.identity.capability = "other";
    value.content.sha256 = "0".repeat(64);
    writeSkill(root, { capability: "other", value });
    const result = await executeCli(
      [
        "get",
        "--namespace",
        "supply-chain/inventory",
        "--capability",
        "safety-stock",
      ],
      root,
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "CATALOG_INVALID");
    // F-222: the CLI still fails closed, but the scan no longer blanks the
    // healthy records — the owner is shown the named repair instead of an
    // empty store.
    const scanned = await catalog(root);
    assert.ok(
      scanned.errors.length > 0,
      "the invalid record is still diagnosed",
    );
    assert.equal(
      scanned.records.length,
      2,
      "the record set must no longer be blanked by an unrelated diagnostic",
    );
    assert.ok(
      scanned.records.some(
        (record) => record.manifest.identity.capability === "safety-stock",
      ),
      "the healthy record must survive the unrelated diagnostic",
    );
  });
});

// M12/T9-R1 F-358 — the module README must not document vocabularies the
// shipped code does not define.
//
// The README named `DUPLICATE_VERSION` (no shipped file raises it: the reader
// raises `MULTIPLE_ACTIVE_VERSIONS` and the writer raises
// `SKILL_VERSION_CONFLICT`) and `CATALOG_ERROR` (the CLI answers
// `CATALOG_INVALID`), and its `validate` example could not occur on the
// tracked tree. A reader who copied any of it got an error message naming
// something the code never says.
//
// The lane below makes the README checkable: every error name it documents
// must exist in the shipped code, and the documented output must be the
// output the CLI really prints.
// M12/T9-R1 F-067 — the Skill Store ships its own guarded lock recovery.
//
// The operator tool that exists today recovers ONE governed lock root (the
// ledger's `writer.lock`). The Skill Store's writer lock is a DIFFERENT root,
// so a stranded one froze every later promotion with `FILE_LOCK_TIMEOUT` and
// no operator action could clear it.
//
// The guard is the point: a LIVE holder is refused, an unreadable owner
// record is inspected rather than reclaimed, a stray entry is refused, and
// nothing is removed without the typed confirmation.
test("the Skill Store's own lock recovery is guarded", async () => {
  await temporaryStore(async (root) => {
    const lockDir = skillStoreWriterLockDir(root);
    mkdirSync(lockDir, { recursive: true });

    // (1) A lock held by a LIVE process (this test) is never reclaimed.
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, token: "a".repeat(32) }),
    );
    const live = recoverSkillStoreLock({ root });
    assert.equal(live.exitCode, 1);
    assert.equal(live.report.action, "REFUSED_LIVE_HOLDER");
    assert.equal(live.report.holder_alive, true);
    assert.equal(live.report.recovered, false);
    assert.ok(existsSync(lockDir), "a live holder's lock must survive");

    // (2) A lock whose holder is gone is reported, read-only by default.
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: 2147483646, token: "b".repeat(32) }),
    );
    const reported = recoverSkillStoreLock({ root });
    assert.equal(reported.exitCode, 0);
    assert.equal(reported.report.action, "REPORT");
    assert.equal(reported.report.holder_alive, false);
    assert.equal(reported.report.mutated, false);
    assert.ok(existsSync(lockDir), "the default mode must not remove anything");

    // (3) Recovery without the typed confirmation is refused.
    const unconfirmed = recoverSkillStoreLock({ root, recover: true });
    assert.equal(unconfirmed.exitCode, 1);
    assert.equal(unconfirmed.report.action, "REFUSED_UNCONFIRMED");
    assert.ok(
      existsSync(lockDir),
      "an unconfirmed recovery must change nothing",
    );

    // (4) Recovery WITH the confirmation clears the stranded lock.
    const recovered = recoverSkillStoreLock({
      root,
      recover: true,
      confirm: "ORPHAN_LOCK_RECOVERY",
    });
    assert.equal(recovered.exitCode, 0);
    assert.equal(recovered.report.action, "RECOVERED");
    assert.equal(recovered.report.recovered, true);
    assert.equal(existsSync(lockDir), false);

    // (5) A lock with an unreadable owner record is inspected, not reclaimed.
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, "owner.json"), "not json");
    const malformed = recoverSkillStoreLock({
      root,
      recover: true,
      confirm: "ORPHAN_LOCK_RECOVERY",
    });
    assert.equal(malformed.exitCode, 1);
    assert.equal(malformed.report.action, "INSPECT");
    assert.equal(malformed.report.reason, "OWNER_ENTRY_UNREADABLE");
    assert.ok(existsSync(lockDir), "an unverifiable lock must survive");

    // (6) A stray entry in the lock directory is refused.
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: 2147483646, token: "c".repeat(32) }),
    );
    writeFileSync(path.join(lockDir, "stray.txt"), "stray");
    const stray = recoverSkillStoreLock({
      root,
      recover: true,
      confirm: "ORPHAN_LOCK_RECOVERY",
    });
    assert.equal(stray.exitCode, 1);
    assert.equal(stray.report.action, "INSPECT");
    assert.equal(stray.report.reason, "STRAY_LOCK_ENTRY");
    assert.ok(existsSync(lockDir), "a lock with a stray entry must survive");
  });
});

test("the documented error names and the documented output match the shipped code", async () => {
  const readme = readFileSync(
    new URL("../zink-skill-store/README.md", import.meta.url),
    "utf8",
  );
  const shipped = [
    "../zink-skill-store/src/catalog.mjs",
    "../zink-skill-store/src/vector-sync.mjs",
    "../zink-skill-store/src/migrations.mjs",
    "../zink-skill-store/index.mjs",
    "../zink-skill-store/bin/skill-store.mjs",
  ]

    .map((rel) => readFileSync(new URL(rel, import.meta.url), "utf8"))
    .join("\n");

  // (1) Every error/identifier name the README documents must be defined by
  // the shipped code.
  const documented = [
    ...readme.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/gu),
  ].map((match) => match[1]);
  assert.ok(
    documented.length > 0,
    "the README must document at least one error name",
  );
  for (const name of new Set(documented)) {
    assert.ok(
      shipped.includes(name),
      `the README documents ${name}, which no shipped file defines`,
    );
  }

  // (2) The documented `validate` output must be the output the CLI prints.
  // The blocks are compared as parsed JSON, so the README's formatting (and
  // the formatter's) cannot make the comparison drift.
  const documentedOutput = [...readme.matchAll(/```json\n([\s\S]*?)\n```/gu)]
    .map((match) => JSON.parse(match[1]))
    .find((value) => value && "manifest_count" in value);
  assert.ok(
    documentedOutput,
    "the README must document the validate output in a json block",
  );
  await temporaryStore(async (root) => {
    const result = await executeCli(["validate"], root);
    assert.deepEqual(JSON.parse(result.stdout), documentedOutput);
  });

  // (3) The documented exit codes must be the ones the CLI can return.
  const table = readme.slice(
    readme.indexOf("## 5. Chi tiết Lệnh CLI"),
    readme.indexOf("## 6. Quản trị"),
  );
  for (const exitCode of ["0", "1", "2", "3", "4"]) {
    assert.ok(
      table.includes(`**\`${exitCode}\`**`),
      `the exit-code table must document exit code ${exitCode}`,
    );
  }
});

test("enforces CLI exit codes and output channels", async () => {
  await temporaryStore(async (root) => {
    const invalid = await executeCli(["validate", "extra"], root);
    assert.equal(invalid.exitCode, 4);
    assert.equal(invalid.stdout, "");
    assert.equal(JSON.parse(invalid.stderr).error.code, "CLI_INPUT_INVALID");
    const absent = await executeCli(
      [
        "get",
        "--namespace",
        "supply-chain/inventory",
        "--capability",
        "safety-stock",
      ],
      root,
    );
    assert.equal(absent.exitCode, 3);
    assert.equal(absent.stdout, "");
    assert.equal(
      JSON.parse(absent.stderr).error.code,
      "ACTIVE_SKILL_NOT_FOUND",
    );
    const operational = await executeCli(["validate"], null);
    assert.equal(operational.exitCode, 1);
    assert.equal(operational.stdout, "");
    assert.equal(
      JSON.parse(operational.stderr).error.code,
      "OPERATIONAL_FAILURE",
    );

    // M12/T9-R1 F-096: a fault the writer already classified must reach the
    // caller as THAT classification — with its machine-readable details — and
    // not as the blanket OPERATIONAL_FAILURE. The catch used to have no
    // binding, so `error.code` and `error.details` were unreachable by
    // construction.
    const classified = classifyCliError({
      code: "SKILL_ACTIVE_CONFLICT",
      message: "capability already has ACTIVE version 1.0.0",
      details: ["SKILL_ACTIVE_CONFLICT"],
    });
    assert.equal(classified.code, "SKILL_ACTIVE_CONFLICT");
    assert.deepEqual(classified.details, ["SKILL_ACTIVE_CONFLICT"]);
    // An unexpected fault keeps the blanket class.
    const unclassified = classifyCliError(new Error("boom"));
    assert.equal(unclassified.code, "OPERATIONAL_FAILURE");
    assert.deepEqual(unclassified.details, []);

    // And a poisoned catalog reaches the caller as one classifiable outcome,
    // not as prose to be parsed.
    await temporaryStore(async (root) => {
      writeSkill(root, { manifestBytes: "{" });
      const poisoned = await executeCli(["validate"], root);
      assert.equal(poisoned.exitCode, 2);
      assert.equal(poisoned.stdout, "");
      const parsed = JSON.parse(poisoned.stderr);
      assert.equal(parsed.error.code, "CATALOG_INVALID");
      assert.ok(
        parsed.error.details.length > 0,
        "the details must name the cause",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// M12/T9 F-094 (R5-E03-07) / H5 - the Skill Store owns its `skills.*` schema
// ---------------------------------------------------------------------------
//
// The Skill-Store vector schema was filed under apps/knowledge/migrations/ for
// convenience, so the Knowledgebase's migration runner applied a PEER module's
// DDL on every boot. This case pins the ownership the owner's decision `H5`
// asked for: the Knowledgebase's migration set creates `knowledge.*` objects
// only, and the Skill Store owns its `skills.*` DDL, its migration runner and
// its own migration ledger.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const KNOWLEDGE_MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "apps",
  "knowledge",
  "migrations",
);
const SKILL_STORE_MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "zink-skill-store",
  "migrations",
);
// Every `CREATE <kind> [schema.]name` a migration file carries.
const CREATED_OBJECT =
  /CREATE\s+(?:UNIQUE\s+INDEX|INDEX|TABLE|TYPE|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/giu;

test("F-094: the Knowledgebase applies zero statements against skills.* and the Skill Store owns the DDL, the runner and the ledger", async () => {
  // (1) The Knowledgebase's migration set may only create `knowledge.*`
  // objects. The runner applies exactly the files in its own directory, so
  // this IS the set of statements a Knowledgebase deployment issues.
  const knowledgeMigrations = readdirSync(KNOWLEDGE_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(
    knowledgeMigrations.length > 0,
    "the Knowledgebase keeps its own migrations",
  );
  for (const name of knowledgeMigrations) {
    const sql = readFileSync(path.join(KNOWLEDGE_MIGRATIONS_DIR, name), "utf8");
    for (const match of sql.matchAll(CREATED_OBJECT)) {
      const schema = match[1] ?? null;
      assert.ok(
        schema === null || schema === "knowledge",
        `the Knowledgebase migration ${name} creates an object outside the knowledge schema: ${match[0].trim()}`,
      );
    }
  }
  assert.ok(
    !knowledgeMigrations.includes("003_skills_vector_schema.sql"),
    "the skills.* DDL must not live in the Knowledgebase's migration set",
  );

  // (2) The Skill Store owns the `skills.*` DDL.
  const skillStoreMigrations = readdirSync(SKILL_STORE_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(
    skillStoreMigrations.includes("003_skills_vector_schema.sql"),
    "the Skill Store must own the skills.* DDL",
  );
  const ddl = readFileSync(
    path.join(SKILL_STORE_MIGRATIONS_DIR, "003_skills_vector_schema.sql"),
    "utf8",
  );
  assert.match(ddl, /CREATE SCHEMA IF NOT EXISTS skills;/u);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS skills\.catalog_index \(/u);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS skills\.segments \(/u);

  // (3) The Skill Store owns the migration runner and its own ledger.
  const { applySkillStoreMigrations, SKILL_STORE_LEDGER } =
    await import("../zink-skill-store/src/migrations.mjs");
  assert.equal(SKILL_STORE_LEDGER, "skills.schema_migrations");

  const ledger = new Map();
  const statements = [];
  const dbExecutor = async (sql) => {
    statements.push(sql);
    const selected = sql.match(
      /SELECT sha256 FROM skills\.schema_migrations WHERE version = '([^']+)'/u,
    );
    if (selected) return ledger.get(selected[1]) ?? "";
    const inserted = sql.match(
      /INSERT INTO skills\.schema_migrations \(version, sha256\) VALUES \('([^']+)', '([0-9a-f]{64})'\)/u,
    );
    if (inserted) {
      ledger.set(inserted[1], inserted[2]);
      return "";
    }
    return "";
  };

  const applied = await applySkillStoreMigrations({ dbExecutor });
  assert.deepEqual(
    applied.applied,
    skillStoreMigrations,
    "every migration applies",
  );
  assert.deepEqual(applied.skipped, []);
  assert.deepEqual(
    [...ledger.keys()],
    skillStoreMigrations,
    "every applied migration is recorded in the Skill Store's OWN ledger",
  );
  assert.ok(
    statements.every((sql) => !sql.includes("knowledge.schema_migrations")),
    "the Skill Store must never write the Knowledgebase's ledger",
  );

  // A second run applies nothing: the runner is idempotent.
  const second = await applySkillStoreMigrations({ dbExecutor });
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, skillStoreMigrations);

  // An applied migration whose bytes changed is refused, never re-applied.
  const tampered = new Map(ledger);
  tampered.set("004_skill_retirement_state.sql", "0".repeat(64));
  await assert.rejects(
    () =>
      applySkillStoreMigrations({
        dbExecutor: async (sql) => {
          const selected = sql.match(
            /SELECT sha256 FROM skills\.schema_migrations WHERE version = '([^']+)'/u,
          );
          if (selected) return tampered.get(selected[1]) ?? "";
          return "";
        },
      }),
    (error) => error.code === "SKILL_STORE_MIGRATION_DIGEST_MISMATCH",
    "an edited applied migration must be refused, not silently re-applied",
  );
});

test("F-094: the plugin applies the Skill Store's own migrations before it syncs", () => {
  // The `skills.*` schema moved into the Skill Store, so a deployment that
  // never applied the store's migrations has no schema to sync into. The
  // plugin's sync call site therefore applies them through the same public
  // door, and the runner is idempotent.
  const source = readFileSync(
    new URL(
      "../integrations/openclaw/plugins/zink-governance/index.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const sync = source.slice(
    source.indexOf("async function syncSkillsThroughDoor"),
    source.indexOf("async function getDuckDbBridge"),
  );
  assert.match(
    sync,
    /applySkillStoreMigrations/u,
    "the plugin's sync must apply the Skill Store's migrations",
  );
  assert.ok(
    sync.indexOf("await skillStore.applySkillStoreMigrations") <
      sync.indexOf("return skillStore.syncSkillsToVectorStore"),
    "the migrations must be applied BEFORE the derived index is synced",
  );
});
