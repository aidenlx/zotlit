import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { Command } from "./command";

describe("Command", () => {
  it("adds the ZotLit presentation prefix to a catalog command", () => {
    const markup = renderToStaticMarkup(
      <Command inline name={m.command_update_note_name()} />,
    );

    expect(markup).toContain("ZotLit: Update literature note");
  });

  it("preserves a command owned by another product", () => {
    const markup = renderToStaticMarkup(
      <Command inline>Show debug info</Command>,
    );

    expect(markup).toContain("Show debug info");
    expect(markup).not.toContain("ZotLit: Show debug info");
  });
});
