// F-084 (R1-A09-08) — the release-gate cell records the pre-deployment build,
// so a reader concludes the deployment never happened.
//
// Every digest claim about the installed build must agree across §3, §4 and §8
// — and across the operator-facing README, which told the operator the pre-
// deployment build was still the running one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAN = readFileSync(path.join(REPO_ROOT, "PLAN.md"), "utf8");
const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

const INSTALLED_BUILD_PREFIX = "18fbb077";
const PRE_DEPLOYMENT_BUILD_PREFIX = "e0a755bb";

function planSection(heading) {
  const lines = PLAN.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert.ok(start >= 0, `PLAN.md must carry ${heading}`);
  const end = lines.findIndex(
    (line, index) => index > start && /^## /u.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function releaseGateMilestoneRow() {
  const section = planSection("## 3. Current release gate");
  const row = section.split("\n").find((line) => line.startsWith("| M12 "));
  assert.ok(row, "the release-gate table must carry the M12 row");
  return row;
}

test("F-084: the §3 release-gate row names the deployment that installed the build", () => {
  const row = releaseGateMilestoneRow();
  assert.match(
    row,
    /Deployment B/u,
    "a reader bootstrapping from the release-gate table must see that the " +
      "deployment happened",
  );
  const digests = row.match(/(?<![0-9a-z])[0-9a-f]{8}(?![0-9a-z])/gu) ?? [];
  assert.deepEqual(
    digests.filter((digest) => digest !== INSTALLED_BUILD_PREFIX),
    [],
    "the release-gate row must not carry a digest other than the installed build",
  );
});

test("F-084: §4 and §8 name the same installed build", () => {
  const focus = planSection("## 4. Current focus");
  const delivery = planSection("## 8. Delivery sequence");
  assert.ok(
    focus.includes(INSTALLED_BUILD_PREFIX),
    "§4 must record the digest the Deployment B apply installed",
  );
  assert.ok(
    delivery.includes(`${INSTALLED_BUILD_PREFIX}`),
    "§8 must record the same installed build",
  );
  assert.match(
    delivery,
    /the remediation build is the installed build/u,
    "§8 must state that the remediation build is the installed build",
  );
});

test("F-084: no section states the pre-deployment build as the current installed build", () => {
  const sections = [
    ["## 3. Current release gate", planSection("## 3. Current release gate")],
    ["## 4. Current focus", planSection("## 4. Current focus")],
    ["## 8. Delivery sequence", planSection("## 8. Delivery sequence")],
  ];
  const offenders = [];
  for (const [name, contents] of sections) {
    for (const paragraph of contents.split(/\n\s*\n/u)) {
      if (!paragraph.includes(PRE_DEPLOYMENT_BUILD_PREFIX)) continue;
      const historical =
        /rollback|still carries|still `e0a755bb|predecessor|replaced|superseded|historical|Deployment A|2026-10-1[34]/u.test(
          paragraph,
        );
      if (!historical) offenders.push(`${name}: ${paragraph.slice(0, 120)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a paragraph states the pre-deployment build as the current installed build: ${offenders.join(" | ")}`,
  );
});

test("F-084: the operator README does not call the pre-deployment build the running one", () => {
  const paragraphs = README.split(/\n\s*\n/u);
  const offenders = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.includes(PRE_DEPLOYMENT_BUILD_PREFIX)) continue;
    if (
      !paragraph.includes(INSTALLED_BUILD_PREFIX) ||
      !paragraph.includes("Deployment B")
    ) {
      offenders.push(paragraph.slice(0, 160));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the operator guide must say which build is installed (Deployment B, ${INSTALLED_BUILD_PREFIX}…), not that the pre-deployment build is still running: ${offenders.join(" | ")}`,
  );
});
