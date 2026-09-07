import { renderToMarkdown } from "fumadocs-core/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { UiLabel } from "./ui-label";

describe("UiLabel", () => {
  it("renders a strong element with the message text", () => {
    const markup = renderToStaticMarkup(
      <UiLabel name={m.settings_page_citations()} />,
    );

    expect(markup).toBe("<strong>Citations</strong>");
  });

  it("renders as bold Markdown in the Markdown edition", async () => {
    const markdown = await renderToMarkdown(
      <UiLabel name={m.settings_page_citations()} />,
    );

    expect(markdown).toBe("**Citations**");
  });
});
