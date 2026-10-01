const MUTATION_KEYWORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER",
  "CREATE", "TRUNCATE", "REPLACE", "GRANT", "REVOKE"
]);

const FORBIDDEN_KEYWORDS = new Set([
  "JOIN", "INNER", "OUTER", "LEFT", "RIGHT", "CROSS", "NATURAL",
  "UNION", "INTERSECT", "EXCEPT", "CTE", "WITH",
  "GROUP", "HAVING", "WINDOW", "OVER",
  "EXPLAIN", "NOT", "IN", "BETWEEN", "LIKE", "ILIKE", "SIMILAR",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "INTO", "FOR", "LOCK", "SET", "VALUES"
]);

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

function tokenizeSql(sql) {
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
      if (paramName.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(paramName)) {
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
    if (
      ch === "+" ||
      ch === "-" ||
      /\d/u.test(ch)
    ) {
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
          "SELECT", "FROM", "WHERE", "ORDER", "BY", "LIMIT", "OFFSET",
          "ASC", "DESC", "AND", "OR", "IS", "NOT", "AS"
        ].includes(upper)
      ) {
        tokens.push({ type: "KEYWORD", value: upper, raw: word });
      } else if (FORBIDDEN_KEYWORDS.has(upper)) {
        tokens.push({ type: "FORBIDDEN_KEYWORD", value: upper, raw: word });
      } else {
        // Valid identifier
        if (dotCount === 1) {
          const parts = word.split(".");
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parts[0]) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parts[1])) {
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

      if (tok.type === "FORBIDDEN_KEYWORD" || tok.type === "LPAREN" || tok.type === "RPAREN") {
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
    parseWhereClause(tokens, () => idx, (newIdx) => { idx = newIdx; }, placeholdersFound);
  }

  // 5. Optional ORDER BY clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "ORDER") {
    next();
    const byTok = next();
    if (!byTok || byTok.type !== "KEYWORD" || byTok.value !== "BY") {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    parseOrderByClause(tokens, () => idx, (newIdx) => { idx = newIdx; });
  }

  // 6. Optional LIMIT clause
  if (peek()?.type === "KEYWORD" && peek()?.value === "LIMIT") {
    next();
    const lim = next();
    if (!lim || (lim.type !== "NUMBER" && lim.type !== "PARAM")) {
      throw new Error("SQL_UNSUPPORTED_SYNTAX");
    }
    if (lim.type === "PARAM") placeholdersFound.push(lim.value);
    if (lim.type === "NUMBER" && (!/^\d+$/u.test(lim.value) || Number(lim.value) < 1)) {
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
    if (off.type === "NUMBER" && (!/^\d+$/u.test(off.value) || Number(off.value) < 0)) {
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

    if (tok.type === "LPAREN" || tok.type === "RPAREN" || tok.type === "FORBIDDEN_KEYWORD") {
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
    const left = parseExpressionItem();
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
      const right = parseExpressionItem();
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
    if (tokens[idx]?.type === "KEYWORD" && (tokens[idx]?.value === "ASC" || tokens[idx]?.value === "DESC")) {
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
  "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER",
  "CREATE", "TRUNCATE", "REPLACE", "GRANT", "REVOKE",
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
