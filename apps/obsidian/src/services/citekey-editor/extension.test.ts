// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { livePreview, hoverLinks } = vi.hoisted(() => ({
  livePreview: vi.fn(() => false),
  /** Every `hover-link` the editor's own workspace was asked to answer. */
  hoverLinks: [] as [event: string, link: Record<string, unknown>][],
}));

vi.mock("@/lib/editor-decoration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/editor-decoration")>()),
  livePreviewOf: livePreview,
}));

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({
        file: { path: "note.md" },
        app: {
          workspace: {
            trigger: (event: string, link: Record<string, unknown>) =>
              hoverLinks.push([event, link]),
          },
        },
      }),
      update: (value) => value,
    }),
  };
});

import { editorInfoField, Keymap } from "obsidian";

import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import type { FormattedOccurrence } from "@/services/citation-text/present";
import {
  CITEKEY_HOVER_SOURCE,
  hoverPreferences,
} from "@/services/citekey-navigation";
import type {
  CitationHoverRequest,
  HoverPreferences,
} from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";

import {
  citekeyAtPos,
  citekeyDecorationsChanged,
  citekeyEditorExtension,
} from "./extension";

/** The Indexed Key `@doe2024` reaches, which is what a summary is held under. */
const DOE_KEY = "DOE22345";

/** The one Literature Note the page preview branch reads for `@doe2024`. */
const NOTE_PATH = "lit/doe2024.md";

const hover = (
  overrides: Partial<HoverPreferences> = {},
): HoverPreferences => ({ ...hoverPreferences(defaults), ...overrides });

const stateOf = (doc: string): EditorState => EditorState.create({ doc });

function editorView(options: ConstructorParameters<typeof EditorView>[0]) {
  const view = new EditorView(options);
  return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
}

/** `See @doe2024 here.` — the key spans `[4, 12)`. */
const LINE = stateOf("See @doe2024 here.");

describe("citekeyAtPos", () => {
  it("answers with the key the position sits inside", () => {
    expect(citekeyAtPos(LINE, 8)).toBe("doe2024");
  });

  it("counts either boundary as inside, as Obsidian's token lookup does", () => {
    expect(citekeyAtPos(LINE, 4)).toBe("doe2024");
    expect(citekeyAtPos(LINE, 12)).toBe("doe2024");
  });

  it("answers with nothing past either boundary", () => {
    expect(citekeyAtPos(LINE, 3)).toBeNull();
    expect(citekeyAtPos(LINE, 13)).toBeNull();
  });

  it("reads the line the position falls on", () => {
    const doc = stateOf("@first\n@second");
    expect(citekeyAtPos(doc, 2)).toBe("first");
    expect(citekeyAtPos(doc, 9)).toBe("second");
  });

  it("answers with nothing on plain text", () => {
    expect(citekeyAtPos(stateOf("plain text only"), 3)).toBeNull();
  });
});

describe("citekeyEditorExtension theme hooks", () => {
  it("adds literal resolved and unresolved citation-key hooks in Source mode", () => {
    livePreview.mockReturnValue(false);
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "@resolved and @unresolved",
        extensions: citekeyEditorExtension({
          open: () => undefined,
          showPopover: () => undefined,
          hoverPreferences: () => hover(),
          hoverNotePath: () => NOTE_PATH,
          resolves: (citekey) => citekey === "resolved",
          navigationEnabled: () => true,
          showFormatted: () => true,
          citationText: () => null,
          requestCitationText: () => undefined,
        }),
      }),
    });

    expect(view.dom.querySelector(".zt-citation-key")?.textContent).toBe(
      "@resolved",
    );
    expect(
      view.dom.querySelectorAll(".zt-citation-key-unresolved").item(0)
        .textContent,
    ).toBe("@unresolved");
  });

  it("removes formatted-citation navigation when the setting turns off", () => {
    livePreview.mockReturnValue(true);
    let navigationEnabled = true;
    const opened: string[] = [];
    const formatted = rendered("Doe (2024)");
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "[@doe2024]",
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: (citekey) => opened.push(citekey),
            showPopover: () => undefined,
            hoverPreferences: () => hover(),
            hoverNotePath: () => NOTE_PATH,
            resolves: () => true,
            navigationEnabled: () => navigationEnabled,
            showFormatted: () => true,
            citationText: () => ({
              formatted: new Map([["[@doe2024]", occurrences(formatted)]]),
              entrySerials: false,
              summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
              literalWorks: new Map([["doe2024", DOE_KEY]]),
            }),
            requestCitationText: () => undefined,
          }),
        ],
      }),
    });

    view.dom
      .querySelector(".zt-citation")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened).toEqual(["doe2024"]);

    navigationEnabled = false;
    view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });
    view.dom
      .querySelector(".zt-citation")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(opened).toEqual(["doe2024"]);
  });
});

describe("citekeyEditorExtension delegated hover", () => {
  /**
   * One Source-mode editor over `See @doe2024 here.`, with the pointer answered
   * from inside the marked key — happy-dom lays nothing out, so the coordinate
   * lookup the delegated handler runs is the one thing stood in for.
   */
  function sourceView(
    requests: CitationHoverRequest[],
    preferences: HoverPreferences = hover(),
    notePath: string | null = NOTE_PATH,
  ) {
    livePreview.mockReturnValue(false);
    const view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "See @doe2024 here.",
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: () => undefined,
            showPopover: (request) => requests.push(request),
            hoverPreferences: () => preferences,
            hoverNotePath: () => notePath,
            resolves: () => true,
            navigationEnabled: () => true,
            showFormatted: () => false,
            citationText: () => null,
            requestCitationText: () => undefined,
          }),
        ],
      }),
    });
    vi.spyOn(view, "posAtCoords").mockReturnValue(8);
    return view;
  }

  const mark = (view: EditorView): HTMLElement =>
    view.dom.querySelector<HTMLElement>(".zt-citation-key")!;

  beforeEach(() => {
    hoverLinks.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds the marked key's hover back until Mod is held", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests);

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetEl: mark(view),
      works: [{ citekey: "doe2024" }],
      sourcePath: "note.md",
    });
  });

  it("hovers once while the pointer moves inside one marked key", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests);
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    const targetEl = mark(view);

    targetEl.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: targetEl.firstChild,
      }),
    );

    expect(requests).toEqual([]);
  });

  it("asks for the page preview under the shared source id", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests, hover({ action: "page-preview" }));

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toEqual([]);
    expect(hoverLinks).toHaveLength(1);
    expect(hoverLinks[0]?.[0]).toBe("hover-link");
    expect(hoverLinks[0]?.[1]).toMatchObject({
      targetEl: mark(view),
      linktext: NOTE_PATH,
      sourcePath: "note.md",
      source: CITEKEY_HOVER_SOURCE,
    });
  });

  it("previews nothing for a key naming zero or several notes", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests, hover({ action: "page-preview" }), null);

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(hoverLinks).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("adds no hover result at all while the Hover action is off", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests, hover({ action: "off" }));
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toEqual([]);
    expect(hoverLinks).toEqual([]);
  });
});

describe("citekeyEditorExtension citation widgets", () => {
  /**
   * One view over `doc`, with `formatted` held as its citation text — by
   * default one occurrence of `[@doe2024]`.
   */
  function viewOf(
    doc: string,
    formatted: Map<string, FormattedOccurrence[]> = new Map([
      ["[@doe2024]", occurrences(rendered("Doe (2024)"))],
    ]),
  ) {
    livePreview.mockReturnValue(true);
    const held = {
      formatted,
      entrySerials: false,
      summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
      literalWorks: new Map([["doe2024", DOE_KEY]]),
    };
    return editorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: () => undefined,
            showPopover: () => undefined,
            hoverPreferences: () => hover(),
            hoverNotePath: () => NOTE_PATH,
            resolves: () => true,
            navigationEnabled: () => false,
            showFormatted: () => true,
            citationText: () => held,
            requestCitationText: () => undefined,
          }),
        ],
      }),
    });
  }

  it("shows the formatted citation the shared renderer draws", () => {
    using view = viewOf("[@doe2024]");

    expect(view.dom.querySelector(".zt-citation")?.textContent).toBe(
      "Doe (2024)",
    );
  });

  it("shows each occurrence the text held for its own document offset", () => {
    // A position-dependent style renders the second occurrence of one source
    // as the subsequent form; each widget matches its own editor offset.
    using view = viewOf(
      "One [@doe2024] and [@doe2024].",
      new Map([
        [
          "[@doe2024]",
          [
            { start: 4, text: rendered("Doe (2024)"), serials: [] },
            { start: 19, text: rendered("ibid"), serials: [] },
          ],
        ],
      ]),
    );

    expect(
      [...view.dom.querySelectorAll(".zt-citation")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Doe (2024)", "ibid"]);
  });

  it("keeps the drawn citation while an edit lands away from it", () => {
    using view = viewOf("[@doe2024] tail");
    const drawn = view.dom.querySelector(".zt-citation");
    expect(drawn?.textContent).toBe("Doe (2024)");

    view.dispatch({
      changes: { from: view.state.doc.length, insert: " more" },
    });

    // The held text is one shared value, so the widget compares equal by
    // reference and CodeMirror keeps the element it already drew.
    expect(view.dom.querySelector(".zt-citation")).toBe(drawn);
  });
});
