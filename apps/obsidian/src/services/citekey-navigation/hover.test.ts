import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";

import {
  annotationHoverIntent,
  citationHoverIntent,
  hoverEditingMode,
  hoverPreferences,
} from "./hover";
import type { CitationHoverGesture, HoverPreferences } from "./hover";

const gesture = (
  overrides: Partial<CitationHoverGesture> = {},
): CitationHoverGesture => ({
  pointerType: "mouse",
  mod: false,
  mode: "reading",
  ...overrides,
});

const hover = (
  overrides: Partial<HoverPreferences> = {},
): HoverPreferences => ({
  ...hoverPreferences(defaults),
  ...overrides,
});

describe("hoverPreferences", () => {
  it("reads the locked defaults off the settings snapshot", () => {
    expect(hoverPreferences(defaults)).toEqual({
      action: "popover",
      requireMod: { source: true, "live-preview": false, reading: false },
    });
  });
});

describe("citationHoverIntent under the Citation Popover", () => {
  it("stacks every work a citation names, in the order it names them", () => {
    expect(
      citationHoverIntent(gesture(), hover(), ["doe2024", "smith2025"]),
    ).toEqual({ kind: "popover", citekeys: ["doe2024", "smith2025"] });
  });

  it("shows the rendered modes on bare hover", () => {
    for (const mode of ["reading", "live-preview"] as const) {
      expect(
        citationHoverIntent(gesture({ mode }), hover(), ["doe2024"]).kind,
      ).toBe("popover");
    }
  });

  it("holds a mode whose Require Mod is on back until Mod is held", () => {
    expect(
      citationHoverIntent(gesture({ mode: "source" }), hover(), ["doe2024"]),
    ).toEqual({ kind: "nothing", reason: "needs-mod" });
    expect(
      citationHoverIntent(gesture({ mode: "source", mod: true }), hover(), [
        "doe2024",
      ]),
    ).toEqual({ kind: "popover", citekeys: ["doe2024"] });
  });

  it("reads the Require Mod toggle of the mode the hover happened in", () => {
    const requireReadingOnly = hover({
      requireMod: { source: false, "live-preview": false, reading: true },
    });

    expect(
      citationHoverIntent(gesture({ mode: "reading" }), requireReadingOnly, [
        "doe2024",
      ]),
    ).toEqual({ kind: "nothing", reason: "needs-mod" });
    expect(
      citationHoverIntent(gesture({ mode: "source" }), requireReadingOnly, [
        "doe2024",
      ]).kind,
    ).toBe("popover");
  });

  it("ignores a held Mod where the mode asks for none", () => {
    expect(
      citationHoverIntent(gesture({ mode: "reading", mod: true }), hover(), [
        "doe2024",
      ]),
    ).toEqual({ kind: "popover", citekeys: ["doe2024"] });
  });

  it("shows nothing to a pen or a finger", () => {
    expect(
      citationHoverIntent(gesture({ pointerType: "touch" }), hover(), [
        "doe2024",
      ]),
    ).toEqual({ kind: "nothing", reason: "not-a-mouse" });
    // A desktop mouse event carries no pointer type at all, and hovers.
    expect(
      citationHoverIntent(gesture({ pointerType: undefined }), hover(), [
        "doe2024",
      ]).kind,
    ).toBe("popover");
  });

  it("shows nothing for a citation naming no work", () => {
    expect(citationHoverIntent(gesture(), hover(), [])).toEqual({
      kind: "nothing",
      reason: "no-works",
    });
  });
});

describe("citationHoverIntent under Page preview", () => {
  const preview = hover({ action: "page-preview" });

  it("previews the one work a citation names", () => {
    expect(citationHoverIntent(gesture(), preview, ["doe2024"])).toEqual({
      kind: "page-preview",
      citekey: "doe2024",
    });
  });

  it("previews nothing for a multi-item citation", () => {
    expect(
      citationHoverIntent(gesture(), preview, ["doe2024", "smith2025"]),
    ).toEqual({ kind: "nothing", reason: "not-direct" });
  });

  it("leaves the Mod gate to the Page preview plugin's own settings", () => {
    // Source mode's Require Mod is on, and the preview branch never reads it.
    expect(
      citationHoverIntent(gesture({ mode: "source" }), preview, ["doe2024"]),
    ).toEqual({ kind: "page-preview", citekey: "doe2024" });
  });

  it("shows nothing to a pen or a finger", () => {
    expect(
      citationHoverIntent(gesture({ pointerType: "touch" }), preview, [
        "doe2024",
      ]),
    ).toEqual({ kind: "nothing", reason: "not-a-mouse" });
  });
});

describe("citationHoverIntent under Off", () => {
  it("adds no hover result at all", () => {
    const off = hover({ action: "off" });
    for (const mode of ["source", "live-preview", "reading"] as const) {
      expect(
        citationHoverIntent(gesture({ mode, mod: true }), off, ["doe2024"]),
      ).toEqual({ kind: "nothing", reason: "hover-off" });
    }
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

describe("annotationHoverIntent", () => {
  it("shows the annotation popover under the Citation Popover", () => {
    expect(annotationHoverIntent(gesture(), hover())).toEqual({
      kind: "popover",
    });
  });

  it("treats Page Preview as the popover, since a link names no note to preview", () => {
    expect(
      annotationHoverIntent(gesture(), hover({ action: "page-preview" })),
    ).toEqual({ kind: "popover" });
  });

  it("shows nothing while the Hover action is off", () => {
    expect(annotationHoverIntent(gesture(), hover({ action: "off" }))).toEqual({
      kind: "nothing",
      reason: "hover-off",
    });
  });

  it("holds a mode whose Require Mod is on back until Mod is held", () => {
    for (const action of ["popover", "page-preview"] as const) {
      expect(
        annotationHoverIntent(gesture({ mode: "source" }), hover({ action })),
      ).toEqual({ kind: "nothing", reason: "needs-mod" });
      expect(
        annotationHoverIntent(
          gesture({ mode: "source", mod: true }),
          hover({ action }),
        ),
      ).toEqual({ kind: "popover" });
    }
  });

  it("ignores a pen or a finger", () => {
    expect(
      annotationHoverIntent(gesture({ pointerType: "pen" }), hover()),
    ).toEqual({ kind: "nothing", reason: "not-a-mouse" });
  });
});
