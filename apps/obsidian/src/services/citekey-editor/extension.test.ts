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

import type { Held } from "@/lib/held-reads";
import type {
  CitekeyResolution,
  SnapshotItem,
} from "@/services/citation-index/service";
import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import type {
  DocumentCitations,
  FormattedOccurrence,
} from "@/services/citation-text/present";
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

/** One Item of the resolution snapshot, as the handler carries it. */
const item = (indexedKey: string, itemID = 1): SnapshotItem => ({
  itemID,
  libraryID: 1,
  key: indexedKey,
  indexedKey,
});

/** The snapshot's answer for a key naming exactly one Item. */
const unique = (indexedKey: string): CitekeyResolution => ({
  kind: "unique",
  item: item(indexedKey),
});

/** The snapshot's answer for an Ambiguous Citation Key. */
const ambiguous: CitekeyResolution = {
  kind: "ambiguous",
  candidates: [item("DOE22345"), item("DOE22346", 2)],
};

const missing: CitekeyResolution = { kind: "missing" };

const hover = (
  overrides: Partial<HoverPreferences> = {},
): HoverPreferences => ({ ...hoverPreferences(defaults), ...overrides });

const stateOf = (doc: string): EditorState => EditorState.create({ doc });

function heldRead(value: DocumentCitations): Held<DocumentCitations> {
  return { value, status: "fresh", settled: Promise.resolve(value) };
}

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
          resolveCitekey: (citekey) =>
            citekey === "resolved" ? unique(DOE_KEY) : missing,
          navigationEnabled: () => true,
          showFormatted: () => true,
          citationText: () => null,
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

  it("keeps a pending citation key neutral in Source mode", () => {
    livePreview.mockReturnValue(false);
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "@pending",
        extensions: citekeyEditorExtension({
          open: () => undefined,
          showPopover: () => undefined,
          hoverPreferences: () => hover(),
          hoverNotePath: () => null,
          resolveCitekey: () => null,
          navigationEnabled: () => true,
          showFormatted: () => true,
          citationText: () => null,
        }),
      }),
    });

    const marked = view.dom.querySelector(".zt-citation-key-pending");
    expect(marked?.textContent).toBe("@pending");
    expect(marked?.classList.contains("zt-citation-key-unresolved")).toBe(
      false,
    );
  });

  // An Ambiguous Citation Key reads apart from a key that reaches nothing, in
  // both editor modes, and the document keeps the source the author wrote.
  it("adds the literal ambiguous citation-key hook in both editor modes", () => {
    for (const livePreviewMode of [false, true]) {
      livePreview.mockReturnValue(livePreviewMode);
      const doc = "@ambiguous and @unresolved";
      using view = editorView({
        parent: document.body,
        state: EditorState.create({
          doc,
          extensions: citekeyEditorExtension({
            open: () => undefined,
            showPopover: () => undefined,
            hoverPreferences: () => hover(),
            hoverNotePath: () => NOTE_PATH,
            resolveCitekey: (citekey) =>
              citekey === "ambiguous" ? ambiguous : missing,
            navigationEnabled: () => true,
            showFormatted: () => true,
            citationText: () => null,
          }),
        }),
      });

      const marked = view.dom.querySelector(".zt-citation-key-ambiguous");
      expect(marked?.textContent).toBe("@ambiguous");
      expect(marked?.classList.contains("zt-citation-key")).toBe(true);
      expect(marked?.classList.contains("zt-citation-key-unresolved")).toBe(
        false,
      );
      expect(
        view.dom.querySelector(".zt-citation-key-unresolved")?.textContent,
      ).toBe("@unresolved");
      expect(view.state.doc.toString()).toBe(doc);
    }
  });

  it("states the marked key's click when the setting turns off", () => {
    livePreview.mockReturnValue(true);
    let navigationEnabled = true;
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "@resolved and @unresolved",
        extensions: citekeyEditorExtension({
          open: () => undefined,
          showPopover: () => undefined,
          hoverPreferences: () => hover(),
          hoverNotePath: () => NOTE_PATH,
          resolveCitekey: (citekey) =>
            citekey === "resolved" ? unique(DOE_KEY) : missing,
          navigationEnabled: () => navigationEnabled,
          showFormatted: () => false,
          citationText: () => null,
        }),
      }),
    });
    const marks = (): (string | undefined)[] =>
      [...view.dom.querySelectorAll<HTMLElement>(".zt-citation-key")].map(
        (element) => element.dataset.ztClick,
      );

    // A key that opens on click reads as the link it is, stating nothing.
    expect(marks()).toEqual([undefined, undefined]);

    navigationEnabled = false;
    // This harness uses an empty syntax tree. A zero-width viewport marks that
    // tree complete, which lets the external invalidation rebuild.
    vi.spyOn(view, "viewport", "get").mockReturnValue({ from: 0, to: 0 });
    view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });

    // The caret the editor places is what the mark's own source is edited by.
    expect(marks()).toEqual(["edit", "edit"]);
  });

  it("leaves a formatted citation's click alone when the setting turns off", () => {
    livePreview.mockReturnValue(true);
    let navigationEnabled = true;
    const opened: string[] = [];
    const requests: CitationHoverRequest[] = [];
    const formatted = rendered("Doe (2024)");
    using view = editorView({
      parent: document.body,
      state: EditorState.create({
        doc: "[@doe2024]",
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: (citekey) => opened.push(citekey),
            showPopover: (request) => requests.push(request),
            hoverPreferences: () => hover(),
            hoverNotePath: () => NOTE_PATH,
            resolveCitekey: () => unique(DOE_KEY),
            navigationEnabled: () => navigationEnabled,
            showFormatted: () => true,
            citationText: () =>
              heldRead({
                formatted: new Map([["[@doe2024]", occurrences(formatted)]]),
                entrySerials: false,
                summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
                literalWorks: new Map([["doe2024", DOE_KEY]]),
              }),
          }),
        ],
      }),
    });

    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;
    drawn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened).toEqual(["doe2024"]);
    expect(drawn.dataset.ztClick).toBe("open");

    navigationEnabled = false;
    // This harness uses an empty syntax tree. A zero-width viewport marks that
    // tree complete, which lets the external invalidation rebuild.
    vi.spyOn(view, "viewport", "get").mockReturnValue({ from: 0, to: 0 });
    view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });
    const closed = view.dom.querySelector<HTMLElement>(".zt-citation")!;
    closed.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(opened).toEqual(["doe2024"]);
    expect(requests).toEqual([]);
    // The caret the browser places is what reveals the Citation's source.
    expect(closed.dataset.ztClick).toBe("edit");
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
    {
      preferences = hover(),
      notePath = NOTE_PATH,
      navigationEnabled = true,
    }: {
      preferences?: HoverPreferences;
      notePath?: string | null;
      /** Citekey Navigation, which the hover result is independent of. */
      navigationEnabled?: boolean;
    } = {},
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
            resolveCitekey: () => unique(DOE_KEY),
            navigationEnabled: () => navigationEnabled,
            showFormatted: () => false,
            citationText: () => null,
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
      works: [{ citekey: "doe2024", indexedKey: DOE_KEY }],
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
    using view = sourceView(requests, {
      preferences: hover({ action: "page-preview" }),
    });

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
    using view = sourceView(requests, {
      preferences: hover({ action: "page-preview" }),
      notePath: null,
    });

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(hoverLinks).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("adds no hover result at all while the Hover action is off", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests, {
      preferences: hover({ action: "off" }),
    });
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toEqual([]);
    expect(hoverLinks).toEqual([]);
  });

  it("shows the marked key's popover while Citekey Navigation is off", () => {
    const requests: CitationHoverRequest[] = [];
    using view = sourceView(requests, { navigationEnabled: false });
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);

    mark(view).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetEl: mark(view),
      works: [{ citekey: "doe2024", indexedKey: DOE_KEY }],
    });
  });
});

describe("citekeyEditorExtension citation widgets", () => {
  /** Every popover the drawn citations of these views asked for. */
  const requests: CitationHoverRequest[] = [];
  /** Every note the drawn citations of these views asked to open. */
  const opened: [citekey: string, pane: unknown][] = [];

  beforeEach(() => {
    requests.length = 0;
    opened.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * One view over `doc`, with `formatted` held as its citation text — by
   * default one occurrence of `[@doe2024]`. Citekey Navigation is off, so what
   * these views draw carries the Hover Action's result alone.
   */
  function viewOf(
    doc: string,
    formatted: Map<string, FormattedOccurrence[]> = new Map([
      ["[@doe2024]", occurrences(rendered("Doe (2024)"))],
    ]),
  ) {
    livePreview.mockReturnValue(true);
    const held = heldRead({
      formatted,
      entrySerials: false,
      summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
      literalWorks: new Map([["doe2024", DOE_KEY]]),
    });
    return viewWithCitationText(doc, () => held);
  }

  function viewWithCitationText(
    doc: string,
    citationText: () => Held<DocumentCitations>,
  ) {
    livePreview.mockReturnValue(true);
    return editorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          editorInfoField,
          citekeyEditorExtension({
            open: (citekey, pane) => opened.push([citekey, pane]),
            showPopover: (request) => requests.push(request),
            hoverPreferences: () => hover(),
            hoverNotePath: () => NOTE_PATH,
            resolveCitekey: () => unique(DOE_KEY),
            navigationEnabled: () => false,
            showFormatted: () => true,
            citationText,
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
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;
    expect(drawn?.textContent).toBe("Doe (2024)");

    view.dispatch({
      changes: { from: view.state.doc.length, insert: " more" },
    });

    // The held text is unchanged, so CodeMirror keeps the element it already
    // drew.
    expect(view.dom.querySelector(".zt-citation")).toBe(drawn);
  });

  it("keeps the drawn citation only while a moved occurrence reads the same", () => {
    let held = heldRead({
      formatted: new Map([["[@doe2024]", occurrences(rendered("Doe (2024)"))]]),
      entrySerials: false,
      summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
      literalWorks: new Map([["doe2024", DOE_KEY]]),
    });
    using view = viewWithCitationText("[@doe2024]", () => held);
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;

    view.dispatch({ changes: { from: 0, insert: "Before " } });
    expect(view.dom.querySelector(".zt-citation")).toBe(drawn);

    held = heldRead({
      formatted: new Map([
        ["[@doe2024]", occurrences(rendered("Doe (2024)"), 7)],
      ]),
      entrySerials: false,
      summaries: new Map([[DOE_KEY, "Doe (2024)"]]),
      literalWorks: new Map([["doe2024", DOE_KEY]]),
    });
    vi.spyOn(view, "viewport", "get").mockReturnValue({ from: 0, to: 0 });
    view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });

    expect(view.dom.querySelector(".zt-citation")).toBe(drawn);
    drawn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(requests[0]?.shown?.at).toEqual({ kind: "offset", start: 7 });

    held = heldRead({
      formatted: new Map([
        ["[@doe2024]", occurrences(rendered("Roe (2025)"), 7)],
      ]),
      entrySerials: false,
      summaries: new Map([[DOE_KEY, "Roe (2025)"]]),
      literalWorks: new Map([["doe2024", DOE_KEY]]),
    });
    view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });

    expect(view.dom.querySelector(".zt-citation")).not.toBe(drawn);
  });

  it("shows the drawn citation's popover while Citekey Navigation is off", () => {
    using view = viewOf("[@doe2024]");
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;

    drawn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetEl: drawn,
      works: [{ citekey: "doe2024", indexedKey: DOE_KEY }],
    });
  });

  it("leaves the drawn citation's plain click to the caret while Citekey Navigation is off", () => {
    using view = viewOf("[@doe2024]");
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    drawn.dispatchEvent(down);
    drawn.dispatchEvent(event);

    // Nothing of the plugin's stands between the click and the caret the
    // browser places, which is what brings the Citation's source back.
    expect(opened).toEqual([]);
    expect(requests).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(drawn.dataset.ztClick).toBe("edit");
  });

  it("opens the work a Mod-click names while Citekey Navigation is off", () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    using view = viewOf("[@doe2024]");
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;

    drawn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(requests).toEqual([]);
    expect(opened).toEqual([["doe2024", "tab"]]);
  });

  it("leaves a middle click on the drawn citation inert", () => {
    using view = viewOf("[@doe2024]");
    const drawn = view.dom.querySelector<HTMLElement>(".zt-citation")!;

    drawn.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 1 }),
    );
    drawn.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 1 }));

    expect(requests).toEqual([]);
    expect(opened).toEqual([]);
  });
});
