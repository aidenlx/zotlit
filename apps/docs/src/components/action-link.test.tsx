import { renderToMarkdown } from "fumadocs-core/server";
import { describe, expect, it } from "vitest";

import { ActionLink } from "./action-link";

describe("ActionLink", () => {
  it("keeps a block element's label on the link's one line", async () => {
    // A flow element's children reach the component on their own lines.
    const markdown = await renderToMarkdown(
      <ActionLink href="/docs/install-zotlit" kind="external">
        {"\nInstall ZotLit\n"}
      </ActionLink>,
    );

    expect(markdown.trim()).toBe("[Install ZotLit](/docs/install-zotlit)");
  });
});
