// A page's `searchTitle` reaches its Markdown edition and its `llms.txt`
// entry; the sidebar label in `title` and every folder label stay as they are.

import { llms } from "fumadocs-core/source";
import { describe, expect, it } from "vitest";

import { getLlmsIndex, getMarkdownEdition } from "./markdown-editions";
import { docsPageTitle } from "./shared";
import { source } from "./source";

const retitled = source
  .getPages("en")
  .filter((page) => page.data.searchTitle !== undefined);

describe("docs page titles in the Markdown surface", () => {
  it("has pages whose search title differs from their sidebar label", () => {
    expect(retitled.length).toBeGreaterThan(0);
  });

  it("lists a page in llms.txt under its own title, and nothing else in the docs tree changes", () => {
    // The lessons follow the docs tree, so only the head of the index is pinned.
    const expected = retitled
      .reduce(
        (index, page) =>
          index.replace(
            `[${page.data.title}](${page.url})`,
            `[${docsPageTitle(page.data)}](${page.url})`,
          ),
        llms(source).index("en"),
      )
      .trimEnd();
    expect(getLlmsIndex().slice(0, expected.length)).toBe(expected);
  });

  it.each([
    ["en", ""],
    ["zh-CN", "/zh-CN"],
  ] as const)(
    "names a lesson's Go further pages by their own titles, linked in %s",
    async (locale, prefix) => {
      const edition = await getMarkdownEdition(
        { section: "learn", slugs: ["cite-in-obsidian-with-zotero"] },
        { locale },
      );
      const further = edition?.split(/^## .+$/m).at(-1);
      expect(further).toContain(
        `- [Insert Zotero citations in Obsidian: every way to do it](${prefix}/docs/how-to/insert-citations.md): `,
      );
      expect(edition).toContain(
        `](${prefix}/learn/export-obsidian-to-word-with-citations.md): `,
      );
    },
  );

  it("heads a page's edition with its own title", async () => {
    const page = retitled[0]!;
    const edition = await getMarkdownEdition({
      section: "docs",
      slugs: page.slugs,
    });
    expect(edition?.split("\n")[0]).toBe(
      `# ${page.data.searchTitle} (${page.url})`,
    );
  });
});

// An old anchor's empty span serves the HTML page alone.
describe("old anchors in the Markdown surface", () => {
  it("leaves them out, and the step they stood before reads on", async () => {
    const edition = await getMarkdownEdition({
      section: "docs",
      slugs: ["how-to", "insert-citations"],
    });
    expect(edition).not.toContain("<span");
    expect(edition).toContain("\n2. Keep typing words from the title");
    expect(edition).toContain("\n- **Nothing happens when I type `@` alone:**");
  });
});
