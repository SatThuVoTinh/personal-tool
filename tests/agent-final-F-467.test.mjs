// M12/T9 F-467 (legacy `R9-L05-5`): `verify.mjs` published
// `deploymentEvidence: "PASS"` from the static inspection record, before the
// live battery ran, and a live FAIL only set the process exit code. The
// verdict string therefore read PASS whether the live controls failed or
// were never invoked at all.
//
// The verdict must be derived from the live outcome: PASS is possible only
// when the live lane was requested, every live entry is non-FAIL and the
// host inspection itself is PASS. A stubbed live FAIL must not read PASS,
// and a non-live run must not either.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deploymentEvidenceFor } from "../integrations/openclaw/verify.mjs";

const SOURCE = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "integrations",
    "openclaw",
    "verify.mjs",
  ),
  "utf8",
);

test("F-467: the CLI derives the verdict after the live battery, not from the inspection", () => {
  // The helper is only load-bearing if `main()` calls it: the defect was an
  // assignment that published the inspection's verdict before any live entry
  // existed, so a unit test of the helper alone would stay green if the
  // assignment were restored.
  assert.doesNotMatch(
    SOURCE,
    /deploymentEvidence:\s*inspection\.deploymentEvidence/u,
    "the run record must not republish the inspection's verdict as deployment evidence",
  );
  assert.match(
    SOURCE,
    /result\.deploymentEvidence = deploymentEvidenceFor\(/u,
    "the CLI must derive the deployment verdict through the helper",
  );
  const liveBattery = SOURCE.indexOf("if (options.live) {");
  const derived = SOURCE.lastIndexOf(
    "result.deploymentEvidence = deploymentEvidenceFor(",
  );
  assert.ok(liveBattery !== -1, "the live battery branch must exist");
  assert.ok(
    derived > liveBattery,
    "the verdict must be assigned after the live battery has run",
  );
});

test("F-467: a stubbed live FAIL is not deployment evidence", () => {
  const verdict = deploymentEvidenceFor({
    liveRequested: true,
    live: [
      { command: "openclaw doctor", status: "PASS" },
      { command: "openclaw gateway status --deep", status: "FAIL" },
    ],
    inspection: { deploymentEvidence: "PASS" },
  });
  assert.notEqual(
    verdict,
    "PASS",
    "a live battery that failed must not be published as deployment evidence",
  );
  assert.equal(
    verdict,
    "FAIL",
    "the failed live lane must make the verdict FAIL",
  );
});

test("F-467: a run that never invoked the live battery cannot report PASS", () => {
  const verdict = deploymentEvidenceFor({
    liveRequested: false,
    live: [],
    inspection: { deploymentEvidence: "PASS" },
  });
  assert.equal(
    verdict,
    "NOT RUN",
    "a static-only run inspected a copy, not the live deployment",
  );
});

test("F-467: a live run on a host that cannot prove the tree is NOT RUN", () => {
  const verdict = deploymentEvidenceFor({
    liveRequested: true,
    live: [{ command: "openclaw doctor", status: "PASS" }],
    inspection: { deploymentEvidence: "NOT RUN" },
  });
  assert.equal(
    verdict,
    "NOT RUN",
    "the live lane does not upgrade a host that cannot prove the governed tree",
  );
});

test("F-467: only a live, all-non-FAIL battery on a proven host is PASS", () => {
  const verdict = deploymentEvidenceFor({
    liveRequested: true,
    live: [
      { command: "openclaw doctor", status: "PASS" },
      { command: "openclaw agents list", status: "PASS" },
    ],
    inspection: { deploymentEvidence: "PASS" },
  });
  assert.equal(verdict, "PASS");
});
