import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCli } from "../zink-skill-store/bin/skill-store.mjs";
import { scanCatalog } from "../zink-skill-store/src/catalog.mjs";

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
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "MULTIPLE_ACTIVE_VERSIONS",
      ),
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
    const bytes = Buffer.alloc(65_537, 0x20);
    writeSkill(root, { manifestBytes: bytes });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "MANIFEST_SIZE_LIMIT_EXCEEDED",
      ),
    );
  });
  await temporaryStore(async (root) => {
    const markdown = Buffer.alloc(262_145, 0x61);
    writeSkill(root, { markdown });
    assert.ok(
      (await catalog(root)).errors.some(
        (error) => error.code === "MARKDOWN_SIZE_LIMIT_EXCEEDED",
      ),
    );
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
        (error) => error.code === "MANIFEST_SCHEMA_INVALID",
      ),
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
        (error) => error.code === "MANIFEST_SCHEMA_INVALID",
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
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code),
      ),
      errors,
    );
    assert.ok(
      errors.some((error) => error.code === "UNSAFE_PROVENANCE_REFERENCE"),
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
  await temporaryStore(async (root) => {
    if (process.platform === "win32") return;
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
});

test(
  "treats a Windows junction as a separately covered rejected link",
  { skip: process.platform !== "win32" },
  async () => {
    await temporaryStore(async (root) => {
      const target = path.join(root, "target");
      mkdirSync(target);
      symlinkSync(target, path.join(root, "supply-chain"), "junction");
      assert.notEqual((await catalog(root)).errors.length, 0);
    });
  },
);

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
  });
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
  });
});
