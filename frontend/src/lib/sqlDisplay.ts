type SqlToken = { value: string; kind: "word" | "literal" | "symbol" };

const tokenPattern =
  /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|[\p{L}_][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|<=|>=|<>|!=|::|\|\||[()]|[,.;]|[^\s]/gu;
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
    const kind: SqlToken["kind"] = /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(value)
      ? "word"
      : /^(?:'|"|`|\[|--|\/\*)/.test(value)
        ? "literal"
        : "symbol";
    tokens.push({ value, kind });
  }
  return tokens;
}

/** Formatting changes whitespace only. Copy/export always retain the exact SQL source. */
export function formatSqlForDisplay(sql: string): string {
  if (
    sql.includes("\n") &&
    sql.split("\n").every((line) => line.length < 140) &&
    !/^\s*WITH\b/i.test(sql)
  )
    return sql;
  const tokens = lex(sql);
  if (!tokens.length || tokens.length > 20000) return sql;
  const closing = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (token.value === "(") stack.push(index);
    else if (token.value === ")") {
      const start = stack.pop();
      if (start !== undefined) closing.set(start, index);
    }
  });
  const render = (start: number, end: number, level: number): string => {
    let out = "";
    let previous: SqlToken | undefined;
    let projection = false;
    let predicate = false;
    let depth = 0;
    const indent = "    ".repeat(level);
    const line = (extra = 0) => {
      out = out.trimEnd() + "\n" + indent + "    ".repeat(extra);
    };
    const append = (token: SqlToken) => {
      const prev = previous?.value.toLowerCase() || "";
      const tight =
        noSpaceAfter.has(prev) ||
        [",", ".", ";", ")"].includes(token.value) ||
        (token.value === "(" &&
          previous?.kind === "word" &&
          !noSpaceBeforeParen.has(prev));
      if (out && !out.endsWith("\n") && !out.endsWith(" ") && !tight)
        out += " ";
      out += token.value;
      previous = token;
    };
    for (let index = start; index < end; index++) {
      const token = tokens[index];
      const lower = token.value.toLowerCase();
      const prev = previous?.value.toLowerCase() || "";
      const next = tokens[index + 1]?.value.toLowerCase() || "";
      if (
        token.value === "(" &&
        ["select", "with"].includes(next) &&
        closing.has(index) &&
        level < 32
      ) {
        append(token);
        const close = closing.get(index)!;
        out +=
          "\n" +
          "    ".repeat(level + 1) +
          render(index + 1, close, level + 1).trim();
        line();
        out += ")";
        previous = tokens[close];
        index = close;
        continue;
      }
      if (depth === 0 && token.kind === "word") {
        if (lower === "select") {
          if (out.trim() && prev !== "union" && prev !== "all") line();
          projection = true;
          predicate = false;
        } else if (clauseHeads.has(lower)) {
          const modifier = ["left", "right", "full", "inner", "cross"].includes(
            lower,
          );
          if (!modifier || next === "join") {
            if (
              lower !== "join" ||
              !["left", "right", "full", "inner", "cross"].includes(prev)
            )
              line();
            projection = false;
            predicate = ["where", "having"].includes(lower);
          }
        } else if (predicate && ["and", "or"].includes(lower)) line(1);
      }
      append(token);
      if (token.value === "(") depth++;
      if (token.value === ")") depth = Math.max(0, depth - 1);
      if (
        depth === 0 &&
        lower === "select" &&
        !["distinct", "all"].includes(next)
      )
        line(1);
      else if (
        depth === 0 &&
        ["distinct", "all"].includes(lower) &&
        prev === "select"
      )
        line(1);
      else if (depth === 0 && token.value === ",") line(projection ? 1 : 0);
      else if (token.value.startsWith("--")) line();
    }
    return out.trimEnd();
  };
  return render(0, tokens.length, 0).trim();
}
