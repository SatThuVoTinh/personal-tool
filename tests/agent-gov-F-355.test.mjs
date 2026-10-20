// F-355 (R7-OC1-08) — the routed `SKILL.md` files live outside every enforced
// lane, and each skill's leading heading is not the skill's own name.
//
// The heading half of the acceptance criterion is enforceable here; the lane
// half (`.agents/**` inside a lint or format target) is owned by the gate
// tooling, and the second case below states the exact requirement for it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS_DIRECTORY = path.join(REPO_ROOT, ".agents", "skills");

const skillNames = readdirSync(SKILLS_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function firstHeading(contents) {
  const match = /^(#{1,6}) +(.*)$/mu.exec(contents);
  return match ? match[2].trim() : null;
}

test("F-355: each skill's leading heading is its own declared name", () => {
  const offenders = [];
  for (const name of skillNames) {
    const relative = `.agents/skills/${name}/SKILL.md`;
    const contents = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    const heading = firstHeading(contents);
    if (!heading) {
      offenders.push(`${relative} — no heading`);
      continue;
    }
    const expected = name.replaceAll("-", " ");
    if (!heading.toLowerCase().includes(expected)) {
      offenders.push(`${relative} — leading heading "${heading}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the first heading a router reads must be the skill's own name: ${offenders.join(" | ")}`,
  );
});

// The lane half of this row's acceptance criterion: the governance layer is
// now inside the FORMAT lane. `package.json` carries `.agents/**/*.md` in
// both the `format` and the `format:check` globs, and the seven routed files
// are prettier-clean, so a broken or mis-formatted procedure is caught.
//
// The markdownlint half is NOT RUN and stays NOT RUN: its globs still do not
// name `.agents/**`, because the routed files carry MD004 (list style), MD022
// (headings surrounded by blank lines), MD025 (more than one level-one
// heading per file - `execution/SKILL.md` opens with `# Execution` and
// `# Mandatory preflight`) and MD031 (fenced code blocks surrounded by blank
// lines). Adding that glob is the owner's call, not this lane's.
test("F-355: the governance layer is inside an enforced lane", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const scripts = packageJson.scripts;
  const enforced = [
    scripts.format,
    scripts["format:check"],
    scripts.lint,
    scripts.test,
  ].join("\n");
  const markdownlintConfig = readFileSync(
    path.join(REPO_ROOT, ".markdownlint-cli2.mjs"),
    "utf8",
  );
  const covered =
    enforced.includes(".agents") || markdownlintConfig.includes(".agents");
  assert.ok(
    covered,
    "the governance layer is routed as authority by AGENTS.md §5 but is not a " +
      "member of any enforced lane: no format/lint/test target and no " +
      "markdownlint glob names .agents/**",
  );
});
