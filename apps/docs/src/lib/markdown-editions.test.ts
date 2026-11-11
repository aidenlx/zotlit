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

  it("lists a page in llms.txt under its own title, and nothing else changes", () => {
    const expected = retitled.reduce(
      (index, page) =>
        index.replace(
          `[${page.data.title}](${page.url})`,
          `[${docsPageTitle(page.data)}](${page.url})`,
        ),
      llms(source).index("en"),
    );
    expect(getLlmsIndex()).toBe(expected);
  });

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
