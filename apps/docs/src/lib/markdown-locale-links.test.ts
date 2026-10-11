import { describe, expect, it } from "vitest";

import { localizeMarkdownLinks } from "./markdown-locale-links";

describe("Markdown document links", () => {
  it.each([
    {
      name: "nested labels, queries, fragments and titles",
      input: '[a **nested** x](/docs/foo?x=1#bar "title")',
      expected: '[a **nested** x](/zh-CN/docs/foo?x=1#bar "title")',
    },
    {
      name: "reference links",
      input: '[ref]: </blog/post?x=1#bar> "title"\n\n[ref]',
      expected: '[ref]: </zh-CN/blog/post?x=1#bar> "title"\n\n[ref]',
    },
    {
      name: "escaped reference labels",
      input: "[a\\]b]: /docs/foo\n\n[x][a\\]b]",
      expected: "[a\\]b]: /zh-CN/docs/foo\n\n[x][a\\]b]",
    },
    {
      name: "code fences",
      input: "```md\n[x](/docs/foo)\n```",
      expected: "```md\n[x](/docs/foo)\n```",
    },
    {
      name: "inline code",
      input: "`[x](/docs/foo)`",
      expected: "`[x](/docs/foo)`",
    },
    {
      name: "inline and reference images",
      input: "![image](/docs/foo)\n\n[image]: /docs/foo\n\n![image]",
      expected: "![image](/docs/foo)\n\n[image]: /docs/foo\n\n![image]",
    },
    {
      name: "definitions shared with images",
      input: "[ref]: /docs/foo\n\n[ref] ![ref]",
      expected: "[ref]: /docs/foo\n\n[ref] ![ref]",
    },
    {
      name: "external URLs, assets and the feed",
      input:
        "[external](https://example.com/docs/foo) [cdn](//cdn.com/docs/foo) [image](/img/foo.webp) [feed](/changelog/rss.xml)",
      expected:
        "[external](https://example.com/docs/foo) [cdn](//cdn.com/docs/foo) [image](/img/foo.webp) [feed](/changelog/rss.xml)",
    },
    {
      name: "already localized links",
      input: "[x](/zh-CN/docs/foo)",
      expected: "[x](/zh-CN/docs/foo)",
    },
    {
      name: "Markdown suffix editions",
      input: "[x](/docs.md)",
      expected: "[x](/zh-CN/docs.md)",
    },
    {
      name: "GFM tables",
      input: "| x |\n| - |\n| [x](/changelog/2.0.0) |",
      expected: "| x |\n| - |\n| [x](/zh-CN/changelog/2.0.0) |",
    },
    {
      name: "escaped parentheses",
      input: "[x](/docs/foo\\(bar\\))",
      expected: "[x](/zh-CN/docs/foo\\(bar\\))",
    },
    {
      name: "angle-bracket destinations",
      input: "[x](</docs/foo>)",
      expected: "[x](</zh-CN/docs/foo>)",
    },
    {
      name: "empty labels",
      input: "[](/docs/foo)",
      expected: "[](/zh-CN/docs/foo)",
    },
    {
      name: "multiline destinations",
      input: "[x](\n /docs/foo\n)",
      expected: "[x](\n /zh-CN/docs/foo\n)",
    },
    {
      name: "blockquote definitions",
      input: "> [ref]: /docs/foo\n>\n> [ref]",
      expected: "> [ref]: /zh-CN/docs/foo\n>\n> [ref]",
    },
    {
      name: "raw HTML stays authored",
      input: '<a href="/docs/foo">link</a>',
      expected: '<a href="/docs/foo">link</a>',
    },
  ])("preserves $name", ({ input, expected }) => {
    expect(localizeMarkdownLinks(input, "zh-CN")).toBe(expected);
  });

  it("returns English links to the unprefixed URL", () => {
    expect(localizeMarkdownLinks("[x](/zh-CN/docs/foo?x=1#bar)", "en")).toBe(
      "[x](/docs/foo?x=1#bar)",
    );
  });
});
