type SqlToken = { value: string; kind: "word" | "literal" | "symbol" };

const tokenPattern =
  /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|[A-Za-z_][\w$]*|\d+(?:\.\d+)?|<=|>=|<>|!=|::|\|\||[()]|[,.;]|[^\s]/g;
const clauseHeads = new Set([
  "from",
  "where",
  "group",
  "having",
  "order",
  "limit",
  "offset",
  "fetch",
  "union",
  "except",
  "intersect",
  "join",
  "left",
  "right",
  "full",
  "inner",
  "cross",
]);
const noSpaceAfter = new Set(["(", ".", "::"]);
const noSpaceBeforeParen = new Set([
  "from",
  "where",
  "on",
  "in",
  "as",
  "by",
  "and",
  "or",
  "not",
  "when",
  "then",
  "else",
  "values",
]);

function lex(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (const match of sql.matchAll(tokenPattern)) {
    const value = match[0];
    if (/^\s+$/.test(value)) continue;
    const kind: SqlToken["kind"] = /^[A-Za-z_][\w$]*$/.test(value)
      ? "word"
      : /^(?:'|"|`|\[|--|\/\*)/.test(value)
        ? "literal"
        : "symbol";
    tokens.push({ value, kind });
  }
  return tokens;
}

/** Formats a compact SQL string for reading only; callers must retain the source SQL for copy/execute. */
export function formatSqlForDisplay(sql: string): string {
  if (sql.includes("\n")) return sql;
  const tokens = lex(sql);
  if (!tokens.length) return sql;

  let out = "";
  let depth = 0;
  let previous: SqlToken | undefined;
  let whereClause = false;
  let projection = false;

  const newline = (indent = "") => {
    out = `${out.trimEnd()}\n${indent}`;
  };
  const append = (token: SqlToken, index: number) => {
    const value = token.value;
    const lower = value.toLowerCase();
    const prev = previous?.value.toLowerCase();

    if (token.kind === "word" && depth === 0 && clauseHeads.has(lower)) {
      if (
        lower === "left" ||
        lower === "right" ||
        lower === "full" ||
        lower === "inner" ||
        lower === "cross"
      ) {
        if (tokens[index + 1]?.value.toLowerCase() !== "join") {
          // This word is not a join modifier; keep it in the current expression.
        } else {
          newline();
        }
      } else if (lower === "join") {
        if (!["left", "right", "full", "inner", "cross"].includes(prev || ""))
          newline();
      } else if (lower === "group" || lower === "order") {
        newline();
        whereClause = false;
        projection = false;
      } else {
        newline();
        whereClause = lower === "where" || lower === "having";
        projection = false;
      }
    } else if (
      token.kind === "word" &&
      depth === 0 &&
      whereClause &&
      (lower === "and" || lower === "or")
    ) {
      newline("    ");
    }

    if (lower === "select" && depth === 0) projection = true;

    const tightBefore =
      noSpaceAfter.has(prev || "") ||
      value === ")" ||
      value === "," ||
      value === "." ||
      value === ";";
    const tightParen =
      value === "(" &&
      previous?.kind === "word" &&
      !noSpaceBeforeParen.has(prev || "");
    if (
      out &&
      !out.endsWith("\n") &&
      !tightBefore &&
      !tightParen &&
      !out.endsWith(" ")
    )
      out += " ";
    out += value;

    if (value === "(") depth++;
    if (value === ")") depth = Math.max(0, depth - 1);

    if (
      lower === "select" &&
      depth === 0 &&
      !["distinct", "all"].includes(
        tokens[index + 1]?.value.toLowerCase() || "",
      )
    ) {
      newline("    ");
    } else if (
      ["distinct", "all"].includes(lower) &&
      prev === "select" &&
      depth === 0
    ) {
      newline("    ");
    } else if (value === "," && depth === 0 && projection) {
      newline("    ");
    } else if (value.toLowerCase() === "where" && depth === 0) {
      whereClause = true;
    } else if (
      ["group", "order", "limit", "offset", "having"].includes(lower) &&
      depth === 0
    ) {
      projection = false;
      if (lower === "having") whereClause = true;
    } else if (lower === "from" && depth === 0) {
      projection = false;
      whereClause = false;
    }
    previous = token;
  };

  tokens.forEach(append);
  return out.trim();
}
