import { describe, expect, it } from "vitest";

import { citationHoverIntent, hoverEditingMode } from "./hover";
import type { CitationHoverGesture } from "./hover";

const gesture = (
  overrides: Partial<CitationHoverGesture> = {},
): CitationHoverGesture => ({
  pointerType: "mouse",
  mod: false,
  mode: "reading",
  ...overrides,
});

describe("citationHoverIntent", () => {
  it("stacks every work a citation names, in the order it names them", () => {
    expect(citationHoverIntent(gesture(), ["doe2024", "smith2025"])).toEqual({
      kind: "popover",
      citekeys: ["doe2024", "smith2025"],
    });
  });

  it("shows the rendered modes on bare hover", () => {
    for (const mode of ["reading", "live-preview"] as const) {
      expect(citationHoverIntent(gesture({ mode }), ["doe2024"]).kind).toBe(
        "popover",
      );
    }
  });

  it("holds Source mode back until Mod is held", () => {
    expect(
      citationHoverIntent(gesture({ mode: "source" }), ["doe2024"]),
    ).toEqual({ kind: "nothing", reason: "needs-mod" });
    expect(
      citationHoverIntent(gesture({ mode: "source", mod: true }), ["doe2024"]),
    ).toEqual({ kind: "popover", citekeys: ["doe2024"] });
  });

  it("ignores a held Mod where the mode asks for none", () => {
    expect(
      citationHoverIntent(gesture({ mode: "reading", mod: true }), ["doe2024"]),
    ).toEqual({ kind: "popover", citekeys: ["doe2024"] });
  });

  it("shows nothing to a pen or a finger", () => {
    expect(
      citationHoverIntent(gesture({ pointerType: "touch" }), ["doe2024"]),
    ).toEqual({ kind: "nothing", reason: "not-a-mouse" });
    // A desktop mouse event carries no pointer type at all, and hovers.
    expect(
      citationHoverIntent(gesture({ pointerType: undefined }), ["doe2024"])
        .kind,
    ).toBe("popover");
  });

  it("shows nothing for a citation naming no work", () => {
    expect(citationHoverIntent(gesture(), [])).toEqual({
      kind: "nothing",
      reason: "no-works",
    });
  });
});

describe("hoverEditingMode", () => {
  it("reads the editing mode each surface hovers in", () => {
    expect(hoverEditingMode({ surface: "reading" })).toBe("reading");
    expect(
      hoverEditingMode({ surface: "editor", editorMode: "live-preview" }),
    ).toBe("live-preview");
    expect(hoverEditingMode({ surface: "editor", editorMode: "source" })).toBe(
      "source",
    );
  });
});
