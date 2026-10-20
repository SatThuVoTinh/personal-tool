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

// The lane half of this row's acceptance criterion is owned by the gate
// tooling: `package.json` (format/format:check/lint targets) and
// `.markdownlint-cli2.mjs` (globs) are outside this lane's write scope. The
// control is stated here so it is not lost, and it stays `NOT RUN` until the
// tooling owner adds the glob — it is deliberately not weakened into a pass.
test(
  "F-355: the governance layer is inside an enforced lane",
  {
    skip: "NOT RUN — owned by the gate tooling: add `.agents/**/*.md` to the `format`/`format:check` globs in package.json (and to the markdownlint globs in .markdownlint-cli2.mjs only after the MD004/MD022/MD025/MD031 findings there are fixed). Outside this lane's write scope.",
  },
  () => {
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
  },
);
