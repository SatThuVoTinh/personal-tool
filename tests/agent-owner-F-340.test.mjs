//
// SKIP-FAMILY: uv-toolchain
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// M12/T9 F-340 (R7-OA-03) - the pdf-runtime requirements artifact must carry
// the index its own pins need.
//
// The committed file was a hash-pinned pip artifact with no index directive:
// the two `+cpu` distributions carry `--hash` lines, nothing declared the
// index they live on, and any consumer that treated the file as an install
// contract failed. The only proof that the file equals the lock lived inside
// a manual image build.
//
// The owner ruled ("nhCo dXuAt"): regenerate the artifact WITH the index URL
// and re-pin the two digest readers. The image still proves the export
// equivalence with `uv export ... && cmp`, so the committed bytes and the
// exporter that validates them are the same program.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const pdfRuntimeRoot = path.join(root, "apps", "knowledge", "pdf-runtime");
const artifactPath = path.join(pdfRuntimeRoot, "requirements.txt");
const artifact = readFileSync(artifactPath);
const artifactText = artifact.toString("utf8");
const lockText = readFileSync(path.join(pdfRuntimeRoot, "uv.lock"), "utf8");
const projectText = readFileSync(
  path.join(pdfRuntimeRoot, "pyproject.toml"),
  "utf8",
);
const dockerfile = read("apps", "knowledge", "Dockerfile");
const manifestReader = read(
  "apps",
  "knowledge",
  "pdf-runtime",
  "src",
  "zink_pdf_runtime",
  "manifest.py",
);
const pinsReader = read(
  "apps",
  "knowledge",
  "pdf-runtime",
  "src",
  "zink_pdf_runtime",
  "pins.py",
);
const parentReader = read("apps", "knowledge", "tests", "test_pdf_runtime.py");

const EXPORT_FLAGS = [
  "--frozen",
  "--no-dev",
  "--no-emit-project",
  "--no-header",
  "--format",
  "requirements.txt",
  "--emit-index-url",
];

/** The digest the two readers pin, and the digest of the committed bytes. */
const artifactDigest = createHash("sha256").update(artifact).digest("hex");

/** A source-text assertion that names the rule instead of the whole file. */
function assertSourceHas(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}
function pinnedDigest(source) {
  const found = source.match(
    /EXPECTED_(?:HASHED_REQUIREMENTS|PDF_RUNTIME_REQUIREMENTS)_SHA256\s*=\s*\(?\s*"([0-9a-f]{64})"/u,
  );
  return found ? found[1] : null;
}

/** The package blocks of the artifact: name, version and their hashes. */
function artifactPackages() {
  const packages = new Map();
  for (const block of artifactText.split(/\n(?=[A-Za-z0-9])/u)) {
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)/u.exec(block);
    if (!match) continue;
    const hashes = [...block.matchAll(/--hash=sha256:([0-9a-f]{64})/gu)].map(
      (entry) => entry[1],
    );
    packages.set(`${match[1]}==${match[2]}`, hashes);
  }
  return packages;
}

/** The packages of the lock: name, version and their hashes. */
function lockPackages() {
  const packages = new Map();
  for (const block of lockText.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/mu.exec(block)?.[1];
    const version = /^version = "([^"]+)"/mu.exec(block)?.[1];
    if (!name || !version) continue;
    const hashes = [...block.matchAll(/hash = "sha256:([0-9a-f]{64})"/gu)].map(
      (entry) => entry[1],
    );
    packages.set(`${name}==${version}`, hashes);
  }
  return packages;
}

test("F-340: the artifact carries the index its own pins need", () => {
  const indexBlock =
    /\[\[tool\.uv\.index\]\]([\s\S]*?)(?=\n\[|$)/u.exec(projectText)?.[1] ?? "";
  const indexUrl = /url = "([^"]+)"/u.exec(indexBlock)?.[1];
  assert.ok(indexUrl, "the project must declare the index its pins need");
  assert.ok(
    artifactText.includes(`--index-url https://pypi.org/simple`),
    "the artifact must declare the default index",
  );
  assert.ok(
    artifactText.includes(`--extra-index-url ${indexUrl}`),
    `the artifact must declare the ${indexUrl} index its +cpu pins need`,
  );
  assert.ok(
    lockText.includes(indexUrl),
    "the lock must resolve the same index the artifact declares",
  );
  for (const pinned of ["torch==2.13.0+cpu", "torchvision==0.28.0+cpu"]) {
    assert.ok(
      artifactText.includes(pinned),
      `the artifact must keep the ${pinned} pin`,
    );
  }
});

test("F-340: the artifact carries the lock's own hashes, distribution by distribution", () => {
  const locked = lockPackages();
  const published = artifactPackages();
  let checked = 0;
  for (const [identity, hashes] of locked) {
    if (hashes.length === 0) continue;
    const carried = published.get(identity);
    assert.ok(
      carried,
      `the artifact must carry the ${identity} pin the lock holds`,
    );
    assert.deepEqual(
      [...carried].sort(),
      [...hashes].sort(),
      `the ${identity} hashes must be the lock's own`,
    );
    checked += 1;
  }
  assert.ok(checked >= 100, `every locked distribution must be checked`);
  for (const identity of published.keys()) {
    assert.ok(
      locked.has(identity),
      `the artifact must not carry a distribution the lock does not hold: ${identity}`,
    );
  }
});

test("F-340: the image exports the artifact in the form it is committed in", () => {
  const exportCommand = /uv export ([\s\S]*?)&&/u.exec(dockerfile)?.[1] ?? "";
  for (const flag of EXPORT_FLAGS) {
    assert.ok(
      exportCommand.includes(flag),
      `the image export must carry ${flag}, so the committed bytes and the export agree`,
    );
  }
  assert.match(
    dockerfile,
    /cmp \/tmp\/pdf-requirements\.lock\.txt requirements\.txt/u,
    "the image must still compare the export with the committed artifact",
  );
});

test("F-340: both digest readers pin the committed artifact", () => {
  // F-548 moved the literal into `pins.py` so the pin has exactly one carrier:
  // the image-side guard imports it and the parent lane reads it from that
  // module. The intent of this test is unchanged — both readers must pin the
  // committed bytes — but the carrier is now the module, not two copies.
  const canonicalPin = pinnedDigest(pinsReader);
  assert.ok(
    canonicalPin,
    "the canonical pin must name the artifact it digests",
  );
  assert.equal(
    canonicalPin,
    artifactDigest,
    "the pinned digest must be the digest of the committed artifact",
  );
  assert.match(
    manifestReader,
    /from \.pins import EXPECTED_HASHED_REQUIREMENTS_SHA256/u,
    "the image-side digest reader must import the canonical pin",
  );
  assert.match(
    manifestReader,
    /if digest != EXPECTED_HASHED_REQUIREMENTS_SHA256:/u,
    "the image-side digest reader must compare the artifact against the canonical pin",
  );
  assert.match(
    parentReader,
    /pins\.EXPECTED_HASHED_REQUIREMENTS_SHA256/u,
    "the parent-side digest reader must read the canonical pin",
  );
  // Neither reader may quietly re-declare its own copy again.
  assert.equal(
    pinnedDigest(manifestReader),
    null,
    "the image-side reader must not re-declare the pin",
  );
  assert.equal(
    pinnedDigest(parentReader),
    null,
    "the parent-side reader must not re-declare the pin",
  );
});
/** The canonical export command, in the order the Dockerfile uses it. */
function exportArguments() {
  return [
    "export",
    "--frozen",
    "--no-dev",
    "--no-emit-project",
    "--no-header",
    "--format",
    "requirements.txt",
    "--emit-index-url",
  ];
}

/** The uv binary this environment can run, or null. */
function findUv() {
  const candidates = [process.env.UV_EXECUTABLE, "uv"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && /uv \d+\.\d+\.\d+/u.test(probe.stdout ?? "")) {
      return { executable: candidate, version: probe.stdout.trim() };
    }
  }
  return null;
}

test("F-340: the committed artifact is byte-identical to what the export produces", (t) => {
  const uv = findUv();
  if (!uv) {
    t.skip(
      "no uv binary is available in this environment; the same export equivalence is proved by the Knowledgebase Python lane (apps/knowledge/tests/test_pdf_runtime.py), which runs in the CI job that installs the canonical uv.",
    );
    return;
  }
  const exported = spawnSync(uv.executable, exportArguments(), {
    cwd: pdfRuntimeRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    exported.status,
    0,
    `the export must succeed: ${exported.stderr?.toString() ?? ""}`,
  );
  assert.deepEqual(
    exported.stdout,
    artifact,
    `the committed artifact must be byte-identical to the export (uv: ${uv.version})`,
  );
});

test("F-340: the export equivalence is proved where uv is installed", () => {
  // The CI job that installs the canonical uv runs the Knowledgebase Python
  // suite, so the byte-identity is proved there on every push.
  for (const flag of EXPORT_FLAGS) {
    assertSourceHas(
      parentReader,
      new RegExp(`"${flag}"`, "u"),
      `the Python lane must export with ${flag}`,
    );
  }
  assertSourceHas(
    parentReader,
    /--emit-index-url/u,
    "the Python lane must export the artifact with its index",
  );
  assert.ok(
    existsSync(path.join(pdfRuntimeRoot, "requirements.txt")),
    "the committed artifact must exist",
  );
});
