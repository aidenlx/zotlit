/**
 * Deterministic design checks for the Annotation View, mirroring the
 * Workbench's design.test.ts: mechanical drift the design guide can't catch
 * by prose alone. A failure names `file:line` and the offending text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = import.meta.dirname;

const tsxFiles = readdirSync(ROOT)
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
  .map((name) => ({ name, text: readFileSync(join(ROOT, name), "utf8") }));

const cssFile = {
  name: "style.css",
  text: readFileSync(join(ROOT, "style.css"), "utf8"),
};

function lineOf(
  text: string,
  pattern: RegExp,
): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  text.split("\n").forEach((line, index) => {
    const match = line.match(pattern);
    if (match) out.push({ line: index + 1, text: match[0] });
  });
  return out;
}

function findAll(files: { name: string; text: string }[], pattern: RegExp) {
  return files.flatMap(({ name, text }) =>
    lineOf(text, pattern).map(({ line, text: t }) => `${name}:${line}: ${t}`),
  );
}

describe("Annotation View design", () => {
  it("spells direction logically", () => {
    const ztDirection =
      /zt:(?:[\w-]+:)*(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-/;
    const cssDirection =
      /(?:^|[^-\w])(?:margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:|(?:^|[^-\w])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b/;
    const findings = [
      ...findAll(tsxFiles, ztDirection),
      ...findAll([cssFile], cssDirection),
    ];
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("keeps chrome text on the type scale", () => {
    const arbitrarySize = /zt:(?:[\w-]+:)*text-\[/;
    const uppercase = /zt:(?:[\w-]+:)*uppercase\b/;
    const cssUppercase = /text-transform\s*:\s*uppercase\b/;
    const cssFontSize = /font-size\s*:\s*([\d.]+)px/;
    const cssFindings = lineOf(cssFile.text, cssFontSize)
      .filter((m) => Number(m.text.match(/[\d.]+/)![0]) < 11)
      .map((m) => `${cssFile.name}:${m.line}: ${m.text}`);
    const findings = [
      ...findAll(tsxFiles, arbitrarySize),
      ...findAll(tsxFiles, uppercase),
      ...findAll([cssFile], cssUppercase),
      ...cssFindings,
    ];
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("uses aria-label tooltips, never a title attribute", () => {
    const titleAttr = /(?<![\w-])title=/;
    const setAttrTitle = /\.setAttribute\(\s*["']title["']/;
    const findings = [
      ...findAll(tsxFiles, titleAttr),
      ...findAll(tsxFiles, setAttrTitle),
    ];
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("lays the list out with grid, never CSS columns", () => {
    const ztColumns = /zt:(?:[\w-]+:)*columns-/;
    const cssColumns = /(?:^|[^-\w])columns\s*:|column-count\s*:/;
    const findings = [
      ...findAll(tsxFiles, ztColumns),
      ...findAll([cssFile], cssColumns),
    ];
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("names transitioned properties instead of transition-all", () => {
    const ztAll = /zt:(?:[\w-]+:)*transition-all\b/;
    const cssAll = /transition\s*:\s*all\b/;
    const findings = [
      ...findAll(tsxFiles, ztAll),
      ...findAll([cssFile], cssAll),
    ];
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("never pairs a clamp with a tight leading on the same element", () => {
    const findings: string[] = [];
    for (const { name, text } of tsxFiles) {
      const classAttr = /className=(\{[^}]*\}|"[^"]*")/g;
      let match: RegExpExecArray | null;
      while ((match = classAttr.exec(text))) {
        const value = match[1] ?? "";
        if (
          /zt:line-clamp-/.test(value) &&
          /zt:leading-(?:tight|none)\b/.test(value)
        ) {
          const line = text.slice(0, match.index).split("\n").length;
          findings.push(`${name}:${line}: ${value}`);
        }
      }
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });
});
