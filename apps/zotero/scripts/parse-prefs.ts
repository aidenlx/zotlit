import { parseSync } from "oxc-parser";

export interface PrefEntry {
  key: string;
  line: number;
}

export interface ParseOutcome {
  entries: PrefEntry[];
  errors: string[];
}

function offsetToLine(source: string, offset: number): number {
  let line = 1;
  const cap = Math.min(offset, source.length);
  for (let i = 0; i < cap; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function isPrefValueLiteral(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const n = node as {
    type?: string;
    value?: unknown;
    operator?: string;
    argument?: unknown;
  };
  if (n.type === "Literal") {
    const v = n.value;
    return (
      typeof v === "boolean" || typeof v === "number" || typeof v === "string"
    );
  }
  if (n.type === "UnaryExpression" && n.operator === "-") {
    const arg = n.argument as { type?: string; value?: unknown };
    return arg.type === "Literal" && typeof arg.value === "number";
  }
  return false;
}

/**
 * Parse a Zotero default-prefs file (`pref("key", literal); …`) and return the
 * declared entries. Anything other than a top-level `pref(string-literal,
 * boolean|number|string|-number)` call is reported in `errors`.
 *
 * @param source     Full text of the prefs file.
 * @param filename   Absolute path passed to oxc (used for parser diagnostics).
 * @param displayPath Path string used in error messages (typically relative to repo root).
 */
export function parsePrefsFile(
  source: string,
  filename: string,
  displayPath: string,
): ParseOutcome {
  const result = parseSync(filename, source, {
    lang: "js",
    sourceType: "script",
  });
  const errors: string[] = [];
  const entries: PrefEntry[] = [];

  for (const e of result.errors) {
    if (e.severity === "Error") {
      errors.push(`  ${displayPath}: parse error: ${e.message}`);
    }
  }
  if (errors.length > 0) return { entries, errors };

  for (const stmt of result.program.body) {
    const line = offsetToLine(source, stmt.start);
    if (stmt.type !== "ExpressionStatement") {
      errors.push(
        `  ${displayPath}:${line}: only \`pref("key", literal)\` calls allowed at top level (got ${stmt.type})`,
      );
      continue;
    }
    const expr = stmt.expression;
    if (expr.type !== "CallExpression") {
      errors.push(`  ${displayPath}:${line}: only \`pref(...)\` calls allowed`);
      continue;
    }
    if (expr.callee.type !== "Identifier" || expr.callee.name !== "pref") {
      errors.push(`  ${displayPath}:${line}: only \`pref(...)\` calls allowed`);
      continue;
    }
    const keyArg = expr.arguments[0];
    const valArg = expr.arguments[1];
    if (expr.arguments.length !== 2 || !keyArg || !valArg) {
      errors.push(
        `  ${displayPath}:${line}: \`pref(...)\` requires exactly 2 args`,
      );
      continue;
    }
    if (keyArg.type !== "Literal") {
      errors.push(
        `  ${displayPath}:${line}: first arg must be a string literal`,
      );
      continue;
    }
    if (typeof keyArg.value !== "string") {
      errors.push(
        `  ${displayPath}:${line}: first arg must be a string literal`,
      );
      continue;
    }
    if (!isPrefValueLiteral(valArg)) {
      errors.push(
        `  ${displayPath}:${line}: second arg must be a literal boolean | number | string`,
      );
      continue;
    }
    entries.push({ key: keyArg.value, line });
  }
  return { entries, errors };
}
