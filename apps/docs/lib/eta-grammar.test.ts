import { createHighlighter } from "shiki";
import type { Highlighter } from "shiki";
import { beforeAll, describe, expect, it } from "vitest";

import { etaGrammar } from "./eta-grammar";

describe("eta grammar shape", () => {
  it("registers Eta and EJS aliases with no embedded languages", () => {
    expect(etaGrammar.aliases).toEqual(["ejs"]);
    expect(etaGrammar.embeddedLangs).toEqual([]);
    expect(etaGrammar.scopeName).toBe("text.html.eta");
  });

  it("recognizes raw, escaped, and script tag patterns", () => {
    const begins = etaGrammar.repository["eta-tags"].patterns.map(
      (p) => p.begin,
    );

    expect(begins).toContain("(<<%)([-_]?)\\s*(~)");
    expect(begins).toContain("(<%)([-_]?)\\s*(~)");
    expect(begins).toContain("(<%)([-_]?)\\s*(=)");
    expect(begins).toContain("(<%)([-_]?)(?![=~])");
  });

  it("treats `-`/`_` after `<%` as trim markers, not a raw-output operator", () => {
    const begins = etaGrammar.repository["eta-tags"].patterns.map(
      (p) => p.begin,
    );
    expect(begins).not.toContain("(<%)([-_]?)\\s*(-)");
  });

  it("closes every tag on `%>` with an optional trim marker", () => {
    for (const pattern of etaGrammar.repository["eta-tags"].patterns) {
      expect(pattern.end).toBe("([-_]?)(%>)");
    }
  });
});

interface Span {
  content: string;
  scope: string;
}

/** Flatten a code sample to spans tagged with their innermost scope name. */
function highlight(hl: Highlighter, code: string): Span[] {
  const { tokens } = hl.codeToTokens(code, {
    lang: "eta" as never,
    theme: "github-light",
    includeExplanation: "scopeName",
  });
  return tokens.flat().flatMap((token) =>
    (token.explanation ?? []).map((part) => ({
      content: part.content,
      scope: part.scopes.at(-1)!.scopeName,
    })),
  );
}

describe("eta grammar tokenization", () => {
  let hl: Highlighter;

  beforeAll(async () => {
    hl = await createHighlighter({
      themes: ["github-light"],
      langs: [etaGrammar as never],
    });
  });

  it("scopes delimiters, output operators, and trim markers", () => {
    const spans = highlight(hl, `<%= zt.title -%>`);

    expect(spans).toEqual([
      { content: "<%", scope: "punctuation.section.embedded.begin.eta" },
      { content: "=", scope: "keyword.operator.output.eta" },
      {
        content: " zt.title ",
        scope: "meta.tag.template.expression.escaped.eta",
      },
      { content: "-", scope: "keyword.control.whitespace.trim.eta" },
      { content: "%>", scope: "punctuation.section.embedded.end.eta" },
    ]);
  });

  it("scopes the raw output operator", () => {
    const spans = highlight(hl, `<%~ include("x") %>`);
    expect(spans[0]).toEqual({
      content: "<%",
      scope: "punctuation.section.embedded.begin.eta",
    });
    expect(spans[1]).toEqual({
      content: "~",
      scope: "keyword.operator.output.eta",
    });
  });

  it("never leaks JavaScript scopes into tag contents", () => {
    // A `{` opening an exec tag must not pull the following `%>`, tags, or
    // literal text into an embedded JavaScript block.
    const code = `<% if (x) { %>\n<%= y %>\n<% } %>`;
    const spans = highlight(hl, code);

    expect(spans.some((s) => /source\.js|javascript/.test(s.scope))).toBe(
      false,
    );
    // The escaped tag after the `{` line still parses as its own tag.
    expect(spans).toContainEqual({
      content: "=",
      scope: "keyword.operator.output.eta",
    });
  });

  it("keeps literal text after a brace-opening tag unstyled", () => {
    const spans = highlight(
      hl,
      `<% bq(() => { %>\n[!note] Page <%= zt.pageLabel %>`,
    );
    const literal = spans.find((s) => s.content.includes("[!note] Page"));

    expect(literal?.scope).toBe("text.html.eta");
  });
});
