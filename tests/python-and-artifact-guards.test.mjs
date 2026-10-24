import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { validateContractSchema } from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_RESULT_ENVELOPE_MAX_BYTES } from "../integrations/openclaw/topology/lib/schema.mjs";
import {
  validatePythonFileContent,
  assertNoPythonViolations,
  findPythonViolations,
} from "../zink-tools/python/python-validator.mjs";
import {
  R2StorageAdapter,
  toArtifactReference,
} from "../zink-tools/adapters/storage/r2-adapter.mjs";

/**
 * F-236 (R7-D5-02) — `python-validator.mjs` enforced no invariant while the
 * README and the CHANGELOG published it as the AST safety gate for
 * `zink_python`.
 *
 * F-273 (R7-C1-03) — the envelope's artifact vocabulary had no producer, so
 * results had to ship an empty artifacts array.
 */

describe("F-236 (R7-D5-02) — the Python summariser reports what it observes", () => {
  test("F-236: the dangerous constructs are flagged", () => {
    const cases = [
      ["exec('print(1)')", "PYTHON_EXEC"],
      ["eval('1 + 1')", "PYTHON_EVAL"],
      ["import os\nos.system('rm -rf /')", "PYTHON_OS_SYSTEM"],
      ["import subprocess\nsubprocess.run(['ls'])", "PYTHON_SUBPROCESS"],
      ["with open('/etc/passwd') as handle:\n    pass", "PYTHON_OPEN"],
    ];
    for (const [source, rule] of cases) {
      const analysis = validatePythonFileContent(source);
      const rules = analysis.violations.map((violation) => violation.rule);
      assert.ok(
        rules.includes(rule),
        `${rule} must be flagged, got ${JSON.stringify(rules)}`,
      );
      assert.ok(
        analysis.violations.every((violation) => violation.line >= 1),
        "every violation must name the line it was seen on",
      );
    }
  });

  test("F-236: a benign script is not flagged", () => {
    const analysis = validatePythonFileContent(
      "import pandas as pd\n\n\ndef main():\n    return pd.DataFrame()\n",
    );
    assert.deepEqual(analysis.violations, []);
    assert.doesNotThrow(() => assertNoPythonViolations("x = 1\n"));
  });

  test("F-236: the governed path can refuse a violating file", () => {
    assert.throws(() => assertNoPythonViolations("exec('boom')"), {
      message: /PYTHON_POLICY_VIOLATION: PYTHON_EXEC at line 1/u,
    });
    assert.deepEqual(findPythonViolations("x = 1"), []);
  });

  test("F-236: the summary keeps the fields the preview renderer reads", () => {
    const analysis = validatePythonFileContent(
      "import os\nimport pandas as pd\n\nclass A:\n    pass\n\ndef f():\n    pass\n",
    );
    assert.equal(analysis.importCount, 2);
    assert.equal(analysis.classCount, 1);
    assert.equal(analysis.functionCount, 1);
    assert.ok(analysis.dataModules.includes("pandas"));
    assert.ok(Array.isArray(analysis.firstLines));
  });
});

describe("F-273 (R7-C1-03) — the envelope's artifact reference has a producer", () => {
  test("F-273: the storage path emits the canonical artifact reference", async () => {
    const adapter = new R2StorageAdapter();
    const stored = await adapter.putLandingArtifact({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "orders",
      data: "payload",
      content_type: "text/csv",
    });
    assert.deepEqual(stored.artifact_ref, {
      logical_path: "landing/orders",
      type: "text/csv",
      size_bytes: 7,
    });
    assert.deepEqual(Object.keys(stored.artifact_ref).sort(), [
      "logical_path",
      "size_bytes",
      "type",
    ]);
  });

  test("F-273: an envelope with a non-empty artifact list passes the contract", async () => {
    const adapter = new R2StorageAdapter();
    const stored = await adapter.putLandingArtifact({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "orders",
      data: "payload",
      content_type: "text/csv",
    });
    const envelope = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_n8n",
      specialist: "o2",
      status: "success",
      output: {
        workflow_id: "data_plant_ingest",
        data: { ingest_id: "i-1", status: "completed" },
      },
      artifacts: [stored.artifact_ref],
    };
    assert.equal(
      validateContractSchema(
        "tool-result",
        envelope,
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
    );
  });

  test("F-273: the silver promotion emits the same canonical shape", async () => {
    const adapter = new R2StorageAdapter();
    const promoted = await adapter.promoteToSilver({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id: "orders",
      version: 1,
      data: "cleaned",
      content_type: "application/json",
    });
    assert.deepEqual(promoted.artifact_ref, {
      logical_path: "silver/orders/v1",
      type: "application/json",
      size_bytes: 7,
    });
  });

  test("F-273: the reference helper is the only shape the envelope accepts", () => {
    const reference = toArtifactReference("landing/x", "text/csv", 3);
    assert.equal(
      validateContractSchema(
        "tool-result",
        {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_n8n",
          specialist: "o2",
          status: "success",
          output: {
            workflow_id: "data_plant_ingest",
            data: { ingest_id: "i-1", status: "completed" },
          },
          artifacts: [reference],
        },
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
    );
  });
});

// ===========================================================================
// F-462 (R9-T08-4) — the Python deny scan reads code, not prose
// ===========================================================================
describe("F-462 (R9-T08-4) — the deny scan skips comment and literal text", () => {
  /**
   * The orphaned deny set was a per-line raw-text regex with no comment or
   * string state, so it refused benign prose while the published invariant
   * claimed it was the enforced gate. Measured at HEAD on these very inputs:
   * comment -> `PYTHON_SUBPROCESS`, docstring -> `PYTHON_EXEC`, prose `open()`
   * -> `PYTHON_OPEN`. A construct that lives only inside a comment or a string
   * literal cannot execute, so refusing it teaches a caller to route around the
   * gate; the constructs that DO execute must keep being refused, on the right
   * line.
   */
  test("F-462: comment, docstring and string-literal text are not refused", () => {
    const prose = [
      ["a `#` comment", "# use subprocess for host commands\nx = 1\n"],
      ["a comment naming exec()", "# call exec() later\nx = 1\n"],
      [
        "a module docstring",
        '"""\nThis helper never calls exec().\n"""\nx = 1\n',
      ],
      [
        "a single-quoted docstring",
        "'''\nDocumented as open() form.\n'''\nx = 1\n",
      ],
      ["a string literal", 'msg = "run exec() at runtime"\n'],
      ["an apostrophe in prose", "# don't drop anything\nx = 1\n"],
    ];
    for (const [label, source] of prose) {
      assert.deepEqual(
        findPythonViolations(source),
        [],
        `prose text must not be refused: ${label}`,
      );
      assert.doesNotThrow(
        () => assertNoPythonViolations(source),
        `a benign file must not be refused: ${label}`,
      );
    }
  });

  test("F-462: the observable effects are still refused, on the line they sit on", () => {
    const effects = [
      ["exec('print(1)')\n", "PYTHON_EXEC", 1],
      ["# noqa\nvalue = eval('1 + 1')\n", "PYTHON_EVAL", 2],
      ["import os\nos.system('ls')\n", "PYTHON_OS_SYSTEM", 2],
      [
        '"""\nopen() is documented.\n"""\nimport subprocess\n',
        "PYTHON_SUBPROCESS",
        4,
      ],
      [
        "def helper():\n    with open('/etc/passwd') as h:\n        pass\n",
        "PYTHON_OPEN",
        2,
      ],
    ];
    for (const [source, rule, line] of effects) {
      const rules = findPythonViolations(source).map((v) => v.rule);
      assert.ok(
        rules.includes(rule),
        `${rule} must stay refused, got ${JSON.stringify(rules)}`,
      );
      const found = findPythonViolations(source).find((v) => v.rule === rule);
      assert.equal(
        found.line,
        line,
        `${rule} must name the executable line, not the masked prose above it`,
      );
    }
  });
});
