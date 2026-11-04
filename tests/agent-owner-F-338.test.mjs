// M12/T9 F-338 (R7-OA-01) - one canonical `uv`.
//
// The same tool was pinned at three places by three different surfaces: the
// image base, the CI installer and the Windows driver. Each pin was frozen by
// its own test, so nothing needed to agree with anything else - and the
// `uv export ... && cmp` equivalence that proves pdf-runtime/requirements.txt
// equals the lock could be exercised by a DIFFERENT exporter than the one
// that produced the file, while every lane still read green.
//
// The owner ruled ("nhCo dXuAt"): 0.12.0 is canonical - the version the image
// and the Windows driver already pin - and CI is corrected to it. This lane
// reads all three pins and fails when any of them diverges.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const dockerfile = read("apps", "knowledge", "Dockerfile");
const ciWorkflow = read(".github", "workflows", "ci.yml");
const windowsDriver = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t2-windows.ps1",
);

/** The canonical version: the image and the Windows driver already pin it. */
const CANONICAL_UV_VERSION = "0.12.0";

function matchOrNull(source, pattern) {
  const found = source.match(pattern);
  return found ? found[1] : null;
}

const pins = {
  image: matchOrNull(
    dockerfile,
    /FROM ghcr\.io\/astral-sh\/uv:(\d+\.\d+\.\d+)@sha256:([0-9a-f]{64})/u,
  ),
  ci: matchOrNull(
    ciWorkflow,
    /pip install --disable-pip-version-check "uv==(\d+\.\d+\.\d+)"/u,
  ),
  windowsDriver: matchOrNull(windowsDriver, /\$uvVersion = "(\d+\.\d+\.\d+)"/u),
};

test("F-338: all three surfaces pin the same uv version", () => {
  assert.ok(pins.image, "the image must pin a uv version");
  assert.ok(pins.ci, "CI must install a pinned uv version");
  assert.ok(pins.windowsDriver, "the Windows driver must pin a uv version");
  assert.deepEqual(
    { ...pins },
    {
      image: CANONICAL_UV_VERSION,
      ci: CANONICAL_UV_VERSION,
      windowsDriver: CANONICAL_UV_VERSION,
    },
    "the image, CI and the Windows driver must pin the canonical uv version",
  );
});

test("F-338: the canonical uv version is the one the export equivalence is proved with", () => {
  // The equivalence check lives in the image build, so the exporter that
  // produces pdf-runtime/requirements.txt and the exporter that validates it
  // are the same program only while the pins agree.
  assert.match(
    dockerfile,
    /uv export --frozen --no-dev --no-emit-project --no-header/u,
    "the image must still prove the requirements export with uv",
  );
  assert.match(
    dockerfile,
    /cmp \/tmp\/pdf-requirements\.lock\.txt requirements\.txt/u,
    "the export must still be compared with the committed artifact",
  );
});
