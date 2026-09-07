/**
 * The deterministic half of the Workbench design system (`DESIGN.md`,
 * "Template Workbench"). Prose in `DESIGN.md` carries the judgement calls; the
 * kit variants in `components/ui` carry the sizes; this file catches the
 * mechanical drift the other two cannot: a control sized at its call site, a
 * physical direction class, an arbitrary font size, a label in the wrong
 * voice. A failure names `file:line` and the rule, so the fix lands in the
 * kit or the spec rather than as one more one-off class.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = import.meta.dirname;

/** The rendered note mimics Obsidian's reading view, so its type is content typography, exempt from chrome rules. */
const CONTENT_TYPOGRAPHY = new Set(["reading-view.tsx"]);

/** `Button` sizes the Workbench composes from. Every other size is a docs-site size. */
const BUTTON_SIZES = new Set(["xs", "2xs", "icon-sm", "icon-xs", "icon-2xs"]);

/** Size and spacing utilities a `Button` never carries at its call site. */
const BUTTON_SIZE_OVERRIDE =
  /(^|[\s"'`:])(min-h-|h-\d|size-\d|px-|py-|p-\d|gap-|text-(xs|sm|base|lg|\[)|\[&_svg\]:size)/;

/** Physical direction utilities; the logical spelling mirrors for RTL. */
const PHYSICAL_DIRECTION =
  /(?<![\w-])(ml|mr|pl|pr|border-l|border-r|rounded-l|rounded-r|left|right|text-left|text-right|scroll-ml|scroll-mr)-/;

const sources = readdirSync(ROOT)
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
  .map((name) => ({ name, text: readFileSync(join(ROOT, name), "utf8") }));

interface Element {
  line: number;
  attrs: string;
}

/**
 * Every `<tag …>` opening element's attribute text. A hand-rolled scan rather
 * than a regex, because attribute expressions carry `=>` and nested braces.
 */
function elements(text: string, tag: string): Element[] {
  const out: Element[] = [];
  const open = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (const match of text.matchAll(open)) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const line = text.slice(0, match.index).split("\n").length;
    out.push({ line, attrs: text.slice(match.index + match[0].length, i) });
  }
  return out;
}

function attribute(attrs: string, name: string): string | undefined {
  const literal = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (literal) return literal[1];
  const expression = attrs.match(new RegExp(`\\b${name}=\\{`));
  return expression ? "{…}" : undefined;
}

function lineOf(text: string, pattern: RegExp): number[] {
  const lines: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (pattern.test(line)) lines.push(index + 1);
  });
  return lines;
}

describe("Workbench design system", () => {
  it("sizes every Button from the kit's Workbench variants", () => {
    const findings: string[] = [];
    for (const { name, text } of sources) {
      for (const { line, attrs } of elements(text, "Button")) {
        const size = attribute(attrs, "size");
        if (size === undefined || !BUTTON_SIZES.has(size)) {
          findings.push(
            `${name}:${line} Button size=${size ?? "(default)"}; use one of ${[...BUTTON_SIZES].join(", ")}`,
          );
        }
        const className = attrs.match(/\bclassName=(\{[^}]*\}|"[^"]*")/)?.[1];
        if (className && BUTTON_SIZE_OVERRIDE.test(className)) {
          findings.push(
            `${name}:${line} Button className carries a size or spacing utility; add a kit variant instead`,
          );
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it("sizes every text control at xs", () => {
    const findings: string[] = [];
    for (const { name, text } of sources) {
      for (const tag of ["Input", "NativeSelect", "Textarea"]) {
        for (const { line, attrs } of elements(text, tag)) {
          if (attribute(attrs, "size") !== "xs") {
            findings.push(`${name}:${line} ${tag} without size="xs"`);
          }
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it("spells direction with logical properties", () => {
    const findings = sources.flatMap(({ name, text }) =>
      lineOf(text, PHYSICAL_DIRECTION).map(
        (line) =>
          `${name}:${line} physical direction class; use ms-/me-/ps-/pe-/border-s-/start-/end-`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it("keeps chrome text on the type scale, in sentence case", () => {
    const findings = sources
      .filter(({ name }) => !CONTENT_TYPOGRAPHY.has(name))
      .flatMap(({ name, text }) => [
        ...lineOf(text, /text-\[/).map(
          (line) =>
            `${name}:${line} arbitrary font size; use text-xs or larger`,
        ),
        ...lineOf(text, /(^|[\s"'`:])uppercase([\s"'`]|$)/).map(
          (line) =>
            `${name}:${line} uppercase label; Workbench labels are Inter sentence case`,
        ),
      ]);
    expect(findings).toEqual([]);
  });
});
