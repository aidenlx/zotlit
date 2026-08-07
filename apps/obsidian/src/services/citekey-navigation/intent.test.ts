import { describe, expect, it } from "vitest";

import {
  citationTarget,
  navigationIntent,
  type CitedWork,
  type NavigationGesture,
  type NavigationTarget,
} from "./intent";

const editorGesture = (
  overrides: Partial<NavigationGesture> = {},
): NavigationGesture => ({
  action: "click",
  button: "left",
  mod: false,
  shift: false,
  alt: false,
  editorMode: "live-preview",
  surface: "editor",
  ...overrides,
});

const directTarget: NavigationTarget = {
  resolution: "direct",
  citekey: "doe2024",
};

const createTarget: NavigationTarget = {
  resolution: "open-or-create",
  citekey: "doe2024",
};

describe("navigationIntent", () => {
  it("lets a plain Source-mode click place the caret", () => {
    expect(
      navigationIntent(editorGesture({ editorMode: "source" }), directTarget),
    ).toEqual({ kind: "nothing" });
  });

  it("downgrades a Source-mode Mod-click to the current pane", () => {
    expect(
      navigationIntent(
        editorGesture({ editorMode: "source", mod: true }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: false });
  });

  it("honors the shell-supplied pane from the public keymap", () => {
    // Source-mode Mod-click reports "tab" and downgrades to the current pane.
    expect(
      navigationIntent(
        editorGesture({ editorMode: "source", mod: true, pane: "tab" }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: false });
    // Mod+Alt stays a split and Mod+Shift stays a new tab.
    expect(
      navigationIntent(
        editorGesture({
          editorMode: "source",
          mod: true,
          alt: true,
          pane: "split",
        }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "split" });
    expect(
      navigationIntent(
        editorGesture({
          editorMode: "source",
          mod: true,
          shift: true,
          pane: "tab",
        }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "tab" });
  });

  it("keeps a Source-mode middle or Mod+Shift click in a new tab", () => {
    expect(
      navigationIntent(
        editorGesture({
          editorMode: "source",
          button: "middle",
        }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "tab" });
    expect(
      navigationIntent(
        editorGesture({
          editorMode: "source",
          mod: true,
          shift: true,
        }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "tab" });
  });

  it("maps Live Preview modifiers to the public pane types", () => {
    expect(navigationIntent(editorGesture(), directTarget)).toEqual({
      kind: "open",
      citekey: "doe2024",
      pane: false,
    });
    expect(
      navigationIntent(editorGesture({ mod: true }), directTarget),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "tab" });
    expect(
      navigationIntent(editorGesture({ mod: true, alt: true }), directTarget),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "split" });
    expect(
      navigationIntent(
        editorGesture({ mod: true, alt: true, shift: true }),
        directTarget,
      ),
    ).toEqual({ kind: "open", citekey: "doe2024", pane: "window" });
  });

  it("sends an unresolved key through the open-or-create intent", () => {
    expect(navigationIntent(editorGesture(), createTarget)).toEqual({
      kind: "open",
      citekey: "doe2024",
      pane: false,
    });
  });

  it("shows a citation menu for a multi-key target", () => {
    expect(
      navigationIntent(editorGesture(), {
        resolution: "citation-menu",
        citekeys: ["doe2024", "smith2025"],
      }),
    ).toEqual({
      kind: "show-citation-menu",
      citekeys: ["doe2024", "smith2025"],
      pane: false,
    });
  });

  it("stays silent for an unavailable target", () => {
    expect(
      navigationIntent(editorGesture(), { resolution: "unavailable" }),
    ).toEqual({ kind: "nothing" });
  });

  it("only emits hover for a directly resolved key", () => {
    expect(
      navigationIntent(
        editorGesture({ action: "hover", button: "none" }),
        directTarget,
      ),
    ).toEqual({ kind: "hover", citekey: "doe2024" });
    expect(
      navigationIntent(
        editorGesture({ action: "hover", button: "none" }),
        createTarget,
      ),
    ).toEqual({ kind: "nothing" });
    expect(
      navigationIntent(editorGesture({ action: "hover", button: "none" }), {
        resolution: "unavailable",
      }),
    ).toEqual({ kind: "nothing" });
  });
});

describe("citationTarget", () => {
  const work = (citekey: string): CitedWork => ({
    citekey,
    label: `Work ${citekey}`,
  });

  it("opens the one work a single-key citation names", () => {
    expect(citationTarget([work("a")])).toEqual({
      resolution: "open-or-create",
      citekey: "a",
    });
  });

  it("asks which work a multi-key citation means", () => {
    expect(citationTarget([work("a"), work("b")])).toEqual({
      resolution: "citation-menu",
      citekeys: ["a", "b"],
    });
  });

  it("leaves a citation naming no work inert", () => {
    expect(citationTarget([])).toEqual({ resolution: "unavailable" });
  });
});
