const MUTATION_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
]);

// The one forbidden-keyword vocabulary both exported gates use. `NOT` is a
// member; the tokenizer admits it only in the `IS NOT NULL` grammar the
// statement validator supports, so a bare NOT is refused by BOTH gates.
export const SQL_FORBIDDEN_KEYWORDS = Object.freeze([
  "JOIN",
  "INNER",
  "OUTER",
  "LEFT",
  "RIGHT",
  "CROSS",
  "NATURAL",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "CTE",
  "WITH",
  "GROUP",
  "HAVING",
  "WINDOW",
  "OVER",
  "EXPLAIN",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "SIMILAR",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "INTO",
  "FOR",
  "LOCK",
  "SET",
  "VALUES",
]);
const FORBIDDEN_KEYWORDS = new Set(SQL_FORBIDDEN_KEYWORDS);

/**
 * F-276 (R7-C2-01): the token-level half of the governed read-only subset,
 * exported so that a provider adapter delegates its statement gate HERE
 * instead of re-implementing it.
 *
 * Measured at HEAD: the BigQuery adapter re-implemented the mutation check as
 * an uppercased word-boundary regex over the whole query string, with seven
 * keywords instead of the canonical eleven (MERGE, REPLACE, GRANT and REVOKE
 * were absent) and no string-literal awareness (so a read whose literal text
 * merely mentioned a blocked word was refused). This function is the
 * repository's own tokenizer applied to the same question, so the keyword set,
 * the literal handling and the refusal codes are the canonical ones.
 *
 * The STATEMENT SHAPE (a required FROM clause, alias rules, the projection
 * grammar) stays with `validateSqlQuery`, which the DuckDB bridge applies in
 * full. This gate answers the narrower question "does this statement carry a
 * mutating or reserved token", and it never looks inside a string literal.
 *
 * @param {string} query - A single statement
 * @returns {boolean} true when the statement carries no refused token
 */
export function assertReadOnlyStatement(query) {
  if (typeof query !== "string") {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }
  const tokens = tokenizeSql(query);
  for (const tok of tokens) {
    if (tok.type === "MUTATION_KEYWORD") {
      throw new Error("SQL_MUTATION_NOT_PERMITTED");
    }
    if (tok.type === "FORBIDDEN_KEYWORD") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
  }
  return true;
}

/**
 * Validates a SQL query and parameters according to the Lean Option B minimum safe subset.
 * Throws SQL_MUTATION_NOT_PERMITTED or SQL_UNSUPPORTED_SYNTAX on any violation.
 *
 * @param {string} query - Single SELECT statement to validate
 * @param {Array<object>} [parameters=[]] - Canonical parameter bindings
 * @returns {boolean} - true if query and parameters strictly comply
 */
export function validateSqlQuery(query, parameters = []) {
  if (typeof query !== "string") {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // Reject whitespace-only queries
  if (query.trim().length === 0) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // Tokenize the query
  const tokens = tokenizeSql(query);

  if (tokens.length === 0) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // If any token outside string literal is a mutation keyword, throw SQL_MUTATION_NOT_PERMITTED
  for (const tok of tokens) {
    if (tok.type === "MUTATION_KEYWORD") {
      throw new Error("SQL_MUTATION_NOT_PERMITTED");
    }
  }

  // Parse and validate SELECT statement
  parseAndValidateSelect(tokens, parameters);
  return true;
}

export function tokenizeSql(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    // Whitespace
    if (/\s/u.test(ch)) {
      i++;
      continue;
    }

    // Reject semicolons
    if (ch === ";") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }

    // Reject comments
    if (ch === "-" && sql[i + 1] === "-") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (ch === "/" && sql[i + 1] === "*") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }

    // String literals '...'
    if (ch === "'") {
      let strVal = "";
      i++; // skip opening quote
      let closed = false;
      while (i < n) {
        if (sql[i] === "\\") {
          // Backslash escaping is forbidden in strict SQL standard
          throw new Error("SQL_UNSUPPORTED_SYNTAX");
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            // Doubled quote '' -> escaped single quote
            strVal += "'";
            i += 2;
          } else {
            // End of string
            closed = true;
            i++;
            break;
          }
        } else {
          strVal += sql[i];
          i++;
        }
      }
      if (!closed) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }
      tokens.push({ type: "STRING", value: strVal });
      continue;
    }

    // Positional parameters forbidden
    if (ch === "?" || (ch === "$" && /\d/u.test(sql[i + 1] || ""))) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }

    // Quoted identifiers forbidden: `col`, "col", [col]
    if (ch === '"' || ch === "`" || ch === "[") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }

    // Parentheses
    if (ch === "(" || ch === ")") {
      tokens.push({ type: ch === "(" ? "LPAREN" : "RPAREN", value: ch });
      i++;
      continue;
    }

    // Comma
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      i++;
      continue;
    }

    // Star *
    if (ch === "*") {
      tokens.push({ type: "STAR", value: "*" });
      i++;
      continue;
    }

    // Parameter placeholder :param_name
    if (ch === ":") {
      i++;
      let paramName = "";
      while (i < n && /[A-Za-z0-9_]/u.test(sql[i])) {
        paramName += sql[i];
        i++;
      }
      if (
        paramName.length === 0 ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(paramName)
      ) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }
      tokens.push({ type: "PARAM", value: paramName });
      continue;
    }

    // Comparison operators: <>, !=, <=, >=, <, >, =
    if (ch === "!" && sql[i + 1] === "=") {
      tokens.push({ type: "OP", value: "!=" });
      i += 2;
      continue;
    }
    if (ch === "<") {
      if (sql[i + 1] === ">") {
        tokens.push({ type: "OP", value: "<>" });
        i += 2;
      } else if (sql[i + 1] === "=") {
        tokens.push({ type: "OP", value: "<=" });
        i += 2;
      } else {
        tokens.push({ type: "OP", value: "<" });
        i++;
      }
      continue;
    }
    if (ch === ">") {
      if (sql[i + 1] === "=") {
        tokens.push({ type: "OP", value: ">=" });
        i += 2;
      } else {
        tokens.push({ type: "OP", value: ">" });
        i++;
      }
      continue;
    }
    if (ch === "=") {
      tokens.push({ type: "OP", value: "=" });
      i++;
      continue;
    }

    // Signed or unsigned numeric literals
    if (ch === "+" || ch === "-" || /\d/u.test(ch)) {
      // Check if +/- is followed by a digit
      if ((ch === "+" || ch === "-") && !/\d/u.test(sql[i + 1] || "")) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }

      let numStr = ch;
      i++;
      while (i < n && /[0-9a-zA-Z._+-]/u.test(sql[i])) {
        numStr += sql[i];
        i++;
      }

      // Strict lexical regex: ^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$
      if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(numStr)) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }

      tokens.push({ type: "NUMBER", value: numStr });
      continue;
    }

    // Word tokens: identifiers, keywords
    if (/[A-Za-z_]/u.test(ch)) {
      let word = "";
      while (i < n && /[A-Za-z0-9_.]/u.test(sql[i])) {
        word += sql[i];
        i++;
      }

      const dotCount = (word.match(/\./g) || []).length;
      if (dotCount > 1) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }

      const upper = word.toUpperCase();
      if (MUTATION_KEYWORDS.has(upper)) {
        tokens.push({ type: "MUTATION_KEYWORD", value: upper, raw: word });
      } else if (upper === "TRUE" || upper === "FALSE") {
        tokens.push({ type: "BOOLEAN", value: upper === "TRUE" });
      } else if (upper === "NULL") {
        tokens.push({ type: "NULL", value: null });
      } else if (
        [
          "SELECT",
          "FROM",
          "WHERE",
          "ORDER",
          "BY",
          "LIMIT",
          "OFFSET",
          "ASC",
          "DESC",
          "AND",
          "OR",
          "IS",
          "AS",
        ].includes(upper)
      ) {
        tokens.push({ type: "KEYWORD", value: upper, raw: word });
      } else if (
        // `IS NOT NULL` is part of the admitted subset; a bare NOT is not.
        // Classifying the exception HERE keeps NOT a FORBIDDEN_KEYWORD for
        // every other position, so the token gate and the grammar gate answer
        // the same question instead of the KEYWORD branch shadowing the
        // forbidden entry.
        upper === "NOT" &&
        tokens[tokens.length - 1]?.type === "KEYWORD" &&
        tokens[tokens.length - 1]?.value === "IS"
      ) {
        tokens.push({ type: "KEYWORD", value: upper, raw: word });
      } else if (FORBIDDEN_KEYWORDS.has(upper)) {
        tokens.push({ type: "FORBIDDEN_KEYWORD", value: upper, raw: word });
      } else {
        // Valid identifier
        if (dotCount === 1) {
          const parts = word.split(".");
          if (
            !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parts[0]) ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parts[1])
          ) {
            throw new Error("SQL_UNSUPPORTED_SYNTAX");
          }
        } else {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(word)) {
            throw new Error("SQL_UNSUPPORTED_SYNTAX");
          }
        }
        tokens.push({ type: "IDENTIFIER", value: word });
      }
      continue;
    }

    // Unrecognized character
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  return tokens;
}

/**
 * F-459 (R9-T08-1): the ONE SQL mask both artifact decisions read.
 *
 * The artifact gate used to apply its `UNSAFE_SQL` pattern to the raw file text
 * and to count brackets with a hand-rolled backslash-parity quote toggle. That
 * scanner disagreed with the canonical lexer in both directions: it refused a
 * benign `'DROP DATABASE'` string (over-reject) while it accepted a backslash
 * escape and miscounted an apostrophe inside a `--` comment as an unclosed
 * literal (under-reject and a false `MALFORMED_SQL_SYNTAX`).
 *
 * This mask blanks every single-quoted literal, `--` line comment and
 * `/* ... *\/` block comment at its own length, so neither a keyword nor a
 * bracket inside data can be read as syntax, and it reports the file-level
 * refusals the canonical lexer would make: an unterminated literal or comment,
 * and a backslash escape inside a literal (`tokenizeSql` throws
 * `SQL_UNSUPPORTED_SYNTAX` for that). Comments are MASKED rather than refused
 * because the artifact gate validates a FILE, and the canonical file analyzer
 * (`validateSqlFileContent`) strips them: a migration carrying an apostrophe
 * inside a comment is valid input, not malformed SQL.
 *
 * It lives in THIS module, not in the artifact gate, so the artifact scanner
 * and the canonical validator share one implementation instead of growing two
 * dialects. The owner authorized the resulting static edge on 2026-10-25;
 * `integrations/openclaw/lib/policy.mjs` rewrites the repository-relative
 * import for the deployed tree.
 *
 * @param {string} content raw SQL file text
 * @returns {{ masked: string, unterminatedLiteral: boolean, unterminatedComment: boolean, backslashInLiteral: boolean }}
 */
export function maskSqlLiteralsAndComments(content) {
  const text = typeof content === "string" ? content : "";
  let masked = "";
  let unterminatedLiteral = false;
  let unterminatedComment = false;
  let backslashInLiteral = false;
  let i = 0;
  const blank = (from, to) => " ".repeat(to - from);
  while (i < text.length) {
    const ch = text[i];
    // `--` line comment: blank the body, keep the newline for the next pass.
    if (ch === "-" && text[i + 1] === "-") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = text.length;
      masked += blank(i, end);
      i = end;
      continue;
    }
    // `/* ... */` block comment.
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) {
        unterminatedComment = true;
        masked += blank(i, text.length);
        i = text.length;
      } else {
        masked += blank(i, close + 2);
        i = close + 2;
      }
      continue;
    }
    // Single-quoted literal: emit an empty `''` placeholder, one quote pair.
    if (ch === "'") {
      masked += "''";
      i += 1;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "\\") backslashInLiteral = true;
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          closed = true;
          i += 1;
          break;
        }
        i += 1;
      }
      if (!closed) unterminatedLiteral = true;
      continue;
    }
    masked += ch;
    i += 1;
  }
  return {
    masked,
    unterminatedLiteral,
    unterminatedComment,
    backslashInLiteral,
  };
}

function parseAndValidateSelect(tokens, parameters) {
  let idx = 0;

  function peek() {
    return tokens[idx];
  }

  function next() {
    return tokens[idx++];
  }

  // 1. Must start with SELECT
  const first = next();
  if (!first || first.type !== "KEYWORD" || first.value !== "SELECT") {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // Collect parameters during traversal
  const placeholdersFound = [];

  // 2. Parse projection list
  let hasProjection = false;
  if (peek()?.type === "STAR") {
    next();
    hasProjection = true;
  } else {
    while (idx < tokens.length) {
      const tok = peek();
      if (!tok) break;
      if (tok.type === "KEYWORD" && tok.value === "FROM") break;

      if (
        tok.type === "FORBIDDEN_KEYWORD" ||
        tok.type === "LPAREN" ||
        tok.type === "RPAREN"
      ) {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }

      if (
        tok.type === "IDENTIFIER" ||
        tok.type === "STRING" ||
        tok.type === "NUMBER" ||
        tok.type === "BOOLEAN" ||
        tok.type === "NULL"
      ) {
        next();
        hasProjection = true;
      } else if (tok.type === "PARAM") {
        placeholdersFound.push(tok.value);
        next();
        hasProjection = true;
      } else {
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }

      // Check for alias
      const after = peek();
      if (after) {
        if (after.type === "KEYWORD" && after.value === "AS") {
          throw new Error("SQL_UNSUPPORTED_SYNTAX");
        }
        if (after.type === "IDENTIFIER") {
          throw new Error("SQL_UNSUPPORTED_SYNTAX");
        }
        if (after.type === "COMMA") {
          next(); // consume comma
          continue;
        }
        if (after.type === "KEYWORD" && after.value === "FROM") {
          break;
        }
        throw new Error("SQL_UNSUPPORTED_SYNTAX");
      }
    }
  }

  if (!hasProjection) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // 3. FROM clause is strictly required
  const fromTok = next();
  if (!fromTok || fromTok.type !== "KEYWORD" || fromTok.value !== "FROM") {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  const tableTok = next();
  if (!tableTok || tableTok.type !== "IDENTIFIER") {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // Check for table alias: if next token is IDENTIFIER or AS -> throw
  const postTable = peek();
  if (postTable) {
    if (postTable.type === "KEYWORD" && postTable.value === "AS") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (postTable.type === "IDENTIFIER") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
  }

  // 4. Optional WHERE clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "WHERE") {
    next(); // consume WHERE
    parseWhereClause(
      tokens,
      () => idx,
      (newIdx) => {
        idx = newIdx;
      },
      placeholdersFound,
    );
  }

  // 5. Optional ORDER BY clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "ORDER") {
    next();
    const byTok = next();
    if (!byTok || byTok.type !== "KEYWORD" || byTok.value !== "BY") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    parseOrderByClause(
      tokens,
      () => idx,
      (newIdx) => {
        idx = newIdx;
      },
    );
  }

  // 6. Optional LIMIT clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "LIMIT") {
    next();
    const lim = next();
    if (!lim || (lim.type !== "NUMBER" && lim.type !== "PARAM")) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (lim.type === "PARAM") placeholdersFound.push(lim.value);
    if (
      lim.type === "NUMBER" &&
      (!/^\d+$/u.test(lim.value) || Number(lim.value) < 1)
    ) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
  }

  // 7. Optional OFFSET clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "OFFSET") {
    next();
    const off = next();
    if (!off || (off.type !== "NUMBER" && off.type !== "PARAM")) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (off.type === "PARAM") placeholdersFound.push(off.value);
    if (
      off.type === "NUMBER" &&
      (!/^\d+$/u.test(off.value) || Number(off.value) < 0)
    ) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
  }

  // 8. No extra tokens allowed
  if (idx < tokens.length) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // 9. Validate injective parameters
  validateParameterBinding(placeholdersFound, parameters);
}

function parseWhereClause(tokens, getIdx, setIdx, placeholdersFound) {
  let idx = getIdx();

  function parseExpressionItem() {
    const tok = tokens[idx++];
    if (!tok) throw new Error("SQL_UNSUPPORTED_SYNTAX");

    if (
      tok.type === "LPAREN" ||
      tok.type === "RPAREN" ||
      tok.type === "FORBIDDEN_KEYWORD"
    ) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (
      tok.type === "IDENTIFIER" ||
      tok.type === "STRING" ||
      tok.type === "NUMBER" ||
      tok.type === "BOOLEAN" ||
      tok.type === "NULL"
    ) {
      return tok;
    }
    if (tok.type === "PARAM") {
      placeholdersFound.push(tok.value);
      return tok;
    }
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  function parseCondition() {
    // Each parse* call advances `idx` and throws on unsupported syntax; the
    // returned node is not needed because this validator only rejects or accepts.
    parseExpressionItem();
    const nextTok = tokens[idx];
    if (!nextTok) throw new Error("SQL_UNSUPPORTED_SYNTAX");

    if (nextTok.type === "KEYWORD" && nextTok.value === "IS") {
      idx++; // consume IS
      const afterIs = tokens[idx++];
      if (!afterIs) throw new Error("SQL_UNSUPPORTED_SYNTAX");
      if (afterIs.type === "KEYWORD" && afterIs.value === "NOT") {
        const nullTok = tokens[idx++];
        if (!nullTok || nullTok.type !== "NULL") {
          throw new Error("SQL_UNSUPPORTED_SYNTAX");
        }
        return; // IS NOT NULL
      }
      if (afterIs.type === "NULL") {
        return; // IS NULL
      }
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }

    if (nextTok.type === "OP") {
      idx++; // consume operator
      parseExpressionItem();
      return;
    }

    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  parseCondition();

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok.type === "KEYWORD" && (tok.value === "AND" || tok.value === "OR")) {
      idx++; // consume AND / OR
      parseCondition();
    } else {
      break;
    }
  }

  setIdx(idx);
}

function parseOrderByClause(tokens, getIdx, setIdx) {
  let idx = getIdx();

  while (idx < tokens.length) {
    const col = tokens[idx++];
    if (!col || col.type !== "IDENTIFIER") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (
      tokens[idx]?.type === "KEYWORD" &&
      (tokens[idx]?.value === "ASC" || tokens[idx]?.value === "DESC")
    ) {
      idx++;
    }
    if (tokens[idx]?.type === "COMMA") {
      idx++;
      continue;
    }
    break;
  }

  setIdx(idx);
}

function validateParameterBinding(placeholders, parameters) {
  // 1. Placeholders in query must be strictly unique
  const uniquePlaceholders = new Set(placeholders);
  if (uniquePlaceholders.size !== placeholders.length) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // 2. Parameter names in parameters array must be strictly unique
  const paramNames = (parameters || []).map((p) => p.name);
  const uniqueParamNames = new Set(paramNames);
  if (uniqueParamNames.size !== paramNames.length) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  // 3. Exact set equality: Set(query placeholders) === Set(parameters.map(p => p.name))
  if (uniquePlaceholders.size !== uniqueParamNames.size) {
    throw new Error("SQL_UNSUPPORTED_SYNTAX");
  }

  for (const name of uniquePlaceholders) {
    if (!uniqueParamNames.has(name)) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
  }
}

// ---------------------------------------------------------------------------
// SQL file content analyzer (static — no execution)
// ---------------------------------------------------------------------------

const FILE_MUTATION_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
]);

/**
 * Statically analyzes the content of a SQL script file.
 * Does NOT execute the SQL. Intended for preview and risk assessment.
 *
 * @param {string} content - Raw SQL file content
 * @returns {{ statementCount: number, hasMutations: boolean, mutationKeywords: string[], firstStatement: string }}
 */
export function validateSqlFileContent(content) {
  if (typeof content !== "string") {
    throw new Error("SQL_CONTENT_INVALID: content must be a string");
  }

  // Remove single-line comments
  const stripped = content
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  // Count statements by semicolon delimiters (crude but practical for file analysis)
  const rawStatements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const statementCount = rawStatements.length;

  // Detect mutation keywords across the whole file
  const foundMutations = [];
  const upperContent = stripped.toUpperCase();
  for (const kw of FILE_MUTATION_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upperContent)) {
      foundMutations.push(kw);
    }
  }

  const firstStatement = rawStatements[0] ?? "";

  return {
    statementCount,
    hasMutations: foundMutations.length > 0,
    mutationKeywords: foundMutations,
    firstStatement,
  };
}
