// Discovery seam for the content pipeline: the three collections compile
// through `fumadocs-mdx/vite` and reach the fumadocs loaders.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rcompare } from "semver";
import { describe, expect, it } from "vitest";

import { getBlogPages, getChangelogPages, source } from "./source";

describe("docs collection", () => {
  it("loads every page but the `_` partials", () => {
    const pages = source.getPages();
    expect(pages.length).toBeGreaterThan(0);
    // `_`-prefixed partials reach a page through `<include>` instead of
    // standing on their own, so they stay out of the collection.
    expect(pages.map((page) => page.url)).not.toContainEqual(
      expect.stringContaining("/_"),
    );
  });

  // FAQPage JSON-LD must carry the questions and answers the reader sees, so
  // the `faq` frontmatter is checked against the page's `## Questions`
  // section: each `###` heading, then the plain text of the paragraph under it.
  it("publishes a `faq` list that matches the page's Questions section", () => {
    const pages = source.getPages().filter((page) => page.data.faq);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const body = readFileSync(join(docsDirectory, page.path), "utf8");
      expect({ page: page.path, faq: questionsSection(body) }).toEqual({
        page: page.path,
        faq: page.data.faq,
      });
    }
  });
});

const docsDirectory = resolve(import.meta.dirname, "../../content/docs");

/** Markdown inline text as a reader sees it: link text, no code or bold marks. */
function plainText(markdown: string): string {
  return markdown
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("**", "")
    .replaceAll("`", "")
    .split(/\s+/)
    .join(" ")
    .trim();
}

function questionsSection(body: string) {
  const [, section = ""] = body.split(/^## Questions\b.*$/m);
  const [questions = ""] = section.split(/^## /m);
  return questions
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [heading = "", ...rest] = block.split("\n");
      const [answer = ""] = rest
        .join("\n")
        .trim()
        .split(/\n\s*\n/);
      return { question: heading.trim(), answer: plainText(answer) };
    });
}

describe("changelog collection", () => {
  it("loads every entry newest-first", () => {
    const entries = getChangelogPages().map((page) => page.data);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(
      [...entries].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || rcompare(a.version, b.version),
      ),
    );
  });
});

describe("blog collection", () => {
  it("loads every post newest-first", () => {
    const dates = getBlogPages().map((page) => page.data.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
