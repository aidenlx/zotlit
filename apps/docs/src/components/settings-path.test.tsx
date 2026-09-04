import { renderToMarkdown } from "fumadocs-core/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { SettingsPath } from "./settings-path";

describe("SettingsPath", () => {
  it("renders the tab-only route as bold text", () => {
    const markup = renderToStaticMarkup(<SettingsPath />);

    expect(markup).toBe("<strong>Settings &gt; ZotLit</strong>");
  });

  it("renders the tab-only route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(<SettingsPath />);

    expect(markdown).toBe("**Settings > ZotLit**");
  });

  it("renders the page-only route as bold text", () => {
    const markup = renderToStaticMarkup(
      <SettingsPath page={m.settings_page_templates()} />,
    );

    expect(markup).toBe("<strong>Settings &gt; ZotLit &gt; Templates</strong>");
  });

  it("renders the page-and-setting route as bold text", () => {
    const markup = renderToStaticMarkup(
      <SettingsPath
        page={m.settings_page_templates()}
        setting={m.settings_page_templates()}
      />,
    );

    expect(markup).toBe(
      "<strong>Settings &gt; ZotLit &gt; Templates &gt; Templates</strong>",
    );
  });

  it("renders the page-only route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(
      <SettingsPath page={m.settings_page_templates()} />,
    );

    expect(markdown).toBe("**Settings > ZotLit > Templates**");
  });

  it("renders the page-and-setting route as bold Markdown", async () => {
    const markdown = await renderToMarkdown(
      <SettingsPath
        page={m.settings_page_templates()}
        setting={m.settings_page_templates()}
      />,
    );

    expect(markdown).toBe("**Settings > ZotLit > Templates > Templates**");
  });
});
