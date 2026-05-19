import { describe, expect, it } from "vitest";

import { parsePrefsFile } from "./parse-prefs.js";

function parse(source: string) {
  return parsePrefsFile(source, "prefs.js", "addon/prefs.js");
}

describe("parsePrefsFile", () => {
  it("collects keys and 1-based line numbers for valid pref() calls", () => {
    const { entries, errors } = parse(
      `pref("extensions.zotlit.notify", false);
pref("extensions.zotlit.notify-url", "http://localhost:9091");
pref("extensions.zotlit.log.console-level", "warning");
`,
    );

    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { key: "extensions.zotlit.notify", line: 1 },
      { key: "extensions.zotlit.notify-url", line: 2 },
      { key: "extensions.zotlit.log.console-level", line: 3 },
    ]);
  });

  it("accepts boolean, number, string, and negative-number defaults", () => {
    const { entries, errors } = parse(
      `pref("a", true);
pref("b", 42);
pref("c", -7);
pref("d", "x");
`,
    );

    expect(errors).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores leading and trailing whitespace + line comments", () => {
    const { entries, errors } = parse(
      `// banner comment
// another line

pref("a", true);
// trailing
`,
    );

    expect(errors).toEqual([]);
    expect(entries).toEqual([{ key: "a", line: 4 }]);
  });

  it("rejects non-pref calls", () => {
    const { entries, errors } = parse(
      `user_pref("a", true);
pref("b", true);
`,
    );

    expect(entries).toEqual([{ key: "b", line: 2 }]);
    expect(errors).toEqual([
      "  addon/prefs.js:1: only `pref(...)` calls allowed",
    ]);
  });

  it("rejects non-call top-level statements", () => {
    const { entries, errors } = parse(`var x = 1;
pref("a", true);
`);

    expect(entries).toEqual([{ key: "a", line: 2 }]);
    expect(errors).toEqual([
      '  addon/prefs.js:1: only `pref("key", literal)` calls allowed at top level (got VariableDeclaration)',
    ]);
  });

  it("rejects wrong arg counts", () => {
    const { errors } = parse(
      `pref("a");
pref("b", true, 9);
`,
    );

    expect(errors).toEqual([
      "  addon/prefs.js:1: `pref(...)` requires exactly 2 args",
      "  addon/prefs.js:2: `pref(...)` requires exactly 2 args",
    ]);
  });

  it("rejects non-string-literal keys", () => {
    const { errors } = parse(
      `pref(123, true);
pref(\`a\`, true);
`,
    );

    expect(errors).toEqual([
      "  addon/prefs.js:1: first arg must be a string literal",
      "  addon/prefs.js:2: first arg must be a string literal",
    ]);
  });

  it("rejects non-literal default values", () => {
    const { errors } = parse(
      `pref("a", \`tpl\`);
pref("b", null);
pref("c", someIdent);
pref("d", 1 + 2);
`,
    );

    expect(errors).toEqual([
      "  addon/prefs.js:1: second arg must be a literal boolean | number | string",
      "  addon/prefs.js:2: second arg must be a literal boolean | number | string",
      "  addon/prefs.js:3: second arg must be a literal boolean | number | string",
      "  addon/prefs.js:4: second arg must be a literal boolean | number | string",
    ]);
  });

  it("returns parse errors without entries when source is malformed", () => {
    const { entries, errors } = parse(`pref("a", ;`);

    expect(entries).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^ {2}addon\/prefs\.js: parse error: /);
  });
});
