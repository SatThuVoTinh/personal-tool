/**
 * Zink Python Script Static Analyzer
 *
 * Provides static content inspection for Python `.py` files without executing them.
 * Used by the artifact validator and preview generator to summarize script structure.
 *
 * No execution, no subprocess, no eval — purely string pattern analysis.
 */

// ---------------------------------------------------------------------------
// Python keyword sets for classification
// ---------------------------------------------------------------------------

/** Common standard-library and data-science imports to classify script purpose */
const DATA_SCIENCE_MODULES = new Set([
  "pandas",
  "numpy",
  "scipy",
  "sklearn",
  "matplotlib",
  "seaborn",
  "plotly",
  "statsmodels",
  "xgboost",
  "lightgbm",
  "tensorflow",
  "torch",
  "keras",
]);

const DB_MODULES = new Set([
  "sqlalchemy",
  "psycopg2",
  "pymysql",
  "sqlite3",
  "duckdb",
  "pyarrow",
  "fastparquet",
]);

const FILE_IO_MODULES = new Set([
  "csv",
  "json",
  "openpyxl",
  "xlrd",
  "xlwt",
  "xlsxwriter",
  "pdfplumber",
  "pdfminer",
  "pypdf",
  "docx",
  "python-docx",
]);

// ---------------------------------------------------------------------------
// Deny rules (F-236 / R7-D5-02)
// ---------------------------------------------------------------------------

/**
 * The constructs a governed Python artifact must not contain.
 *
 * Measured at HEAD: `validatePythonFileContent` was a regex line/classifier
 * that counted definitions, classes and imports and tagged the imported
 * modules. It had no deny rule and returned no violation field, so nothing it
 * observed could be refused, while the README and the CHANGELOG published it
 * as the AST safety gate for `zink_python`.
 *
 * These rules are the observable half of that gate: each one is a construct
 * the summariser can see without executing anything, and each one is reported
 * with the line it was seen on so a caller can refuse the file.
 */
export const PYTHON_DENY_RULES = Object.freeze([
  {
    rule: "PYTHON_EXEC",
    description: "exec() executes arbitrary code at runtime.",
    pattern: /(^|[^.\w])exec\s*\(/,
  },
  {
    rule: "PYTHON_EVAL",
    description: "eval() executes arbitrary code at runtime.",
    pattern: /(^|[^.\w])eval\s*\(/,
  },
  {
    rule: "PYTHON_OS_SYSTEM",
    description: "os.system() runs a host command.",
    pattern: /\bos\s*\.\s*system\s*\(/,
  },
  {
    rule: "PYTHON_SUBPROCESS",
    description: "the subprocess module runs a host command.",
    pattern: /(^|[^.\w])subprocess\b/,
  },
  {
    rule: "PYTHON_OPEN",
    description: "open() reaches the host filesystem.",
    pattern: /(^|[^.\w])open\s*\(/,
  },
]);

/**
 * The deny rules a piece of Python content violates.
 *
 * @param {string} content
 * @returns {Array<{rule: string, description: string, line: number}>}
 */
export function findPythonViolations(content) {
  if (typeof content !== "string") return [];
  const lines = content.split(/\r?\n/);
  const violations = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { rule, description, pattern } of PYTHON_DENY_RULES) {
      if (pattern.test(line)) {
        violations.push({ rule, description, line: index + 1 });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Statically analyzes the content of a Python script file.
 *
 * F-236 (R7-D5-02): the analysis now carries a violation set, so the
 * observations it makes can be refused instead of only described.
 *
 * @param {string} content - Raw Python file content
 * @returns {{
 *   lineCount: number,
 *   nonEmptyLineCount: number,
 *   importCount: number,
 *   functionCount: number,
 *   classCount: number,
 *   asyncFunctionCount: number,
 *   dataModules: string[],
 *   dbModules: string[],
 *   fileIoModules: string[],
 *   hasMainBlock: boolean,
 *   firstLines: string[],
 *   violations: Array<{rule: string, description: string, line: number}>,
 * }}
 */
export function validatePythonFileContent(content) {
  if (typeof content !== "string") {
    throw new Error("PYTHON_CONTENT_INVALID: content must be a string");
  }

  const allLines = content.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim().length > 0);

  // Count definitions — functionCount includes all def declarations (sync + async)
  const functionCount = (content.match(/\bdef\s+[a-zA-Z_]/gm) || []).length;
  const asyncFunctionCount = (
    content.match(/^\s*async\s+def\s+[a-zA-Z_]/gm) || []
  ).length;
  const classCount = (content.match(/^\s*class\s+[a-zA-Z_]/gm) || []).length;

  // Collect import lines
  const importLines = allLines.filter((l) =>
    /^\s*(import\s+\S|from\s+\S+\s+import)/.test(l),
  );
  const importCount = importLines.length;

  // Identify imported module names
  const importedModules = new Set();
  for (const line of importLines) {
    // "import foo", "import foo as bar", "from foo import ..."
    const m1 = line.match(/^\s*import\s+([\w.]+)/);
    const m2 = line.match(/^\s*from\s+([\w.]+)\s+import/);
    const moduleName = (m1?.[1] ?? m2?.[1] ?? "").split(".")[0].toLowerCase();
    if (moduleName) importedModules.add(moduleName);
  }

  const dataModules = [...DATA_SCIENCE_MODULES].filter((m) =>
    importedModules.has(m),
  );
  const dbModules = [...DB_MODULES].filter((m) => importedModules.has(m));
  const fileIoModules = [...FILE_IO_MODULES].filter((m) =>
    importedModules.has(m),
  );

  // Detect main guard
  const hasMainBlock = /if\s+__name__\s*==\s*['""]__main__['""]/.test(content);

  return {
    lineCount: allLines.length,
    nonEmptyLineCount: nonEmpty.length,
    importCount,
    functionCount,
    classCount,
    asyncFunctionCount,
    dataModules,
    dbModules,
    fileIoModules,
    hasMainBlock,
    firstLines: nonEmpty.slice(0, 10),
    // F-236 (R7-D5-02): the deny rules the summary observed, reported with
    // the line each was seen on.
    violations: findPythonViolations(content),
  };
}

/**
 * F-236 (R7-D5-02): refuses a Python file that violates a deny rule.
 *
 * The summariser itself never throws on a violation, because a preview of a
 * refused file is still useful to an operator. This is the refusal the
 * governed path calls.
 *
 * @param {string} content - Raw Python file content
 * @returns {void}
 */
export function assertNoPythonViolations(content) {
  const violations = findPythonViolations(content);
  if (violations.length === 0) return;
  const summary = violations
    .map((violation) => `${violation.rule} at line ${violation.line}`)
    .join("; ");
  throw new Error(`PYTHON_POLICY_VIOLATION: ${summary}`);
}

/**
 * Formats a structured human-readable summary of a Python script analysis.
 * @param {string} fileName  Basename of the file
 * @param {ReturnType<typeof validatePythonFileContent>} analysis
 * @returns {string}
 */
export function formatPythonPreview(fileName, analysis) {
  const tags = [];
  if (analysis.dataModules.length > 0)
    tags.push(`📊 Data: ${analysis.dataModules.join(", ")}`);
  if (analysis.dbModules.length > 0)
    tags.push(`🗄️ DB: ${analysis.dbModules.join(", ")}`);
  if (analysis.fileIoModules.length > 0)
    tags.push(`📁 File I/O: ${analysis.fileIoModules.join(", ")}`);
  if (analysis.hasMainBlock) tags.push("▶️ Có __main__");

  const header =
    `🐍 **Python Script:** \`${fileName}\` — ` +
    `${analysis.lineCount} dòng, ${analysis.functionCount} hàm` +
    (analysis.asyncFunctionCount > 0
      ? ` (${analysis.asyncFunctionCount} async)`
      : "") +
    `, ${analysis.classCount} class, ${analysis.importCount} import` +
    (tags.length > 0 ? `\n${tags.join(" · ")}` : "");

  const codeBlock = "```python\n" + analysis.firstLines.join("\n") + "\n```";

  return `${header}\n${codeBlock}`;
}
