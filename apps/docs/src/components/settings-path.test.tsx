import { renderToMarkdown } from "fumadocs-core/server";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { SettingsPath } from "./settings-path";

describe("SettingsPath", () => {
  it("renders the tab-only route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(<SettingsPath />);

    expect(markdown).toBe("**Settings > ZotLit**");
  });

  it("renders the page-only route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(
      <SettingsPath page={m.settings_page_citations()} />,
    );

    expect(markdown).toBe("**Settings > ZotLit > Citations**");
  });

  it("renders the page-and-setting route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(
      <SettingsPath
        page={m.settings_page_citations()}
        setting={m.settings_page_citations()}
      />,
    );

    expect(markdown).toBe("**Settings > ZotLit > Citations > Citations**");
  });
});
