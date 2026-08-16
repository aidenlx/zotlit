// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

const { livePreview, tokenClassNodeProp } = vi.hoisted(() => ({
  livePreview: vi.fn(() => true),
  tokenClassNodeProp: {},
}));

vi.mock("@/lib/editor-decoration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/editor-decoration")>()),
  livePreviewOf: livePreview,
}));

vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>();
  return {
    ...actual,
    tokenClassNodeProp,
    syntaxTree: (state: EditorState) => ({
      length: state.doc.length,
      iterate: ({ enter }: { enter: (node: object) => void }) => {
        const text = state.doc.toString();
        const nodes = [];
        for (let at = text.indexOf("[["); at !== -1; ) {
          const closing = text.indexOf("]]", at);
          if (closing === -1) break;
          nodes.push(
            { from: at, to: at + 2, classes: ["formatting-link-start"] },
            { from: at + 2, to: closing, classes: ["hmd-internal-link"] },
            {
              from: closing,
              to: closing + 2,
              classes: ["formatting-link-end"],
            },
          );
          at = text.indexOf("[[", closing);
        }
        for (const node of nodes) {
          enter({
            ...node,
            type: {
              prop: (property: unknown) =>
                property === tokenClassNodeProp
                  ? node.classes.join(" ")
                  : undefined,
            },
          });
        }
      },
    }),
  };
});

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({
        file: { path: "note.md" },
        app: { workspace: { trigger: () => undefined } },
      }),
      update: (value: unknown) => value,
    }),
  };
});

import { Keymap, editorInfoField } from "obsidian";

import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import { citationKey } from "@/services/citation-text/present";
import type { DocumentCitations } from "@/services/citation-text/present";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import { hoverPreferences } from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { wikilinkEditorExtension } from "./extension";

const LITERATURE_NOTE = {
  path: "literatures/example.md",
  indexedKey: "1/EXAMPLE",
  citationKey: "example",
};

const OTHER_NOTE = {
  path: "literatures/other.md",
  indexedKey: "1/OTHER",
  citationKey: "other",
};

/** One Citation the hovered document holds formatted text for. */
function heldText(source: string, works: string[], text: string) {
  return [citationKey({ source, works }), occurrences(rendered(text))] as const;
}

function harness(doc: string, overrides: Partial<Settings> = {}) {
  const requests: CitationHoverRequest[] = [];
  /** Every gesture Obsidian's own delegated listeners would have answered. */
  const native: MouseEvent[] = [];
  /** Every note a gesture on the rendered Citation asked to open. */
  const opened: [citekey: string, pane: unknown][] = [];
  let settings: Readonly<Settings> = { ...defaults, ...overrides };
  let hover: HoverPreferences = hoverPreferences(settings);
  // Rebuilt on demand, so a fresh value redraws the widget the way a fresh
  // read of the document does.
  let held = citations();

  function citations(): DocumentCitations {
    return {
      entrySerials: false,
      formatted: new Map([
        heldText(
          "[@example, p. 7]",
          [LITERATURE_NOTE.indexedKey],
          "(Example 2020, p. 7)",
        ),
        heldText(
          "[@example, p. 7; @other]",
          [LITERATURE_NOTE.indexedKey, OTHER_NOTE.indexedKey],
          "(Example 2020, p. 7; Other 2021)",
        ),
      ]),
      summaries: new Map(),
      literalWorks: new Map(),
    };
  }

  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        editorInfoField,
        wikilinkEditorExtension({
          literatureNote: (linkpath) =>
            linkpath === "literatures/example"
              ? LITERATURE_NOTE
              : linkpath === "literatures/other"
                ? OTHER_NOTE
                : null,
          enabled: () => true,
          citationText: () => held,
          requestCitationText: () => undefined,
          open: (citekey, pane) => opened.push([citekey, pane]),
          showPopover: (request) => requests.push(request),
          hoverPreferences: () => hover,
          popoverHover: () => hover.action === "popover",
          clickIntercepted: () => !settings["citation.open-as-links"],
        }),
      ],
    }),
  });
  // The delegated `mouseover` and `click` Obsidian hangs above the editor
  // element, which a gesture the popover answers never reaches.
  view.dom.addEventListener("mouseover", (event) => native.push(event));
  view.dom.addEventListener("click", (event) => native.push(event));

  // happy-dom lays nothing out, so the coordinate lookup the caret is placed
  // from is the one thing stood in for.
  vi.spyOn(view, "posAtCoords").mockReturnValue(2);

  return {
    requests,
    native,
    opened,
    selection: () => view.state.selection.main,
    citation: () => view.dom.querySelector<HTMLElement>(".zt-citation"),
    /** Hovers the rendered Citation, as the pointer entering it does. */
    hover: () => {
      view.dom
        .querySelector(".zt-citation")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    },
    /** Clicks the rendered Citation, and answers with the event it sent. */
    click: (init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      view.dom.querySelector(".zt-citation")?.dispatchEvent(event);
      return event;
    },
    /** Answers the way the named settings do, from now on. */
    setSettings: (next: Partial<Settings>) => {
      settings = { ...defaults, ...next };
      hover = hoverPreferences(settings);
      view.dispatch({});
    },
    /** Draws the Citation again from a fresh read, as CodeMirror does. */
    redraw: () => {
      held = citations();
      view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
    },
    [Symbol.dispose]: () => view.destroy(),
  };
}

describe("wikilinkEditorExtension hover under the Citation Popover", () => {
  it("shows the popover of the work the Citation names", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.requests[0]).toMatchObject({
      targetEl: editor.citation(),
      sourcePath: "note.md",
      works: [{ citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey }],
    });
  });

  it("stacks every work a Citation Run names, in citation order", () => {
    using editor = harness(
      "[[literatures/example#cite:locator=7]]; [[literatures/other]]",
    );

    editor.hover();

    expect(editor.requests[0]?.works).toEqual([
      { citekey: "example", indexedKey: LITERATURE_NOTE.indexedKey },
      { citekey: "other", indexedKey: OTHER_NOTE.indexedKey },
    ]);
  });

  it("keeps Obsidian's own hover out of a Citation the popover answers", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });

  it("hovers a Citation CodeMirror has drawn again", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");
    const drawn = editor.citation();

    editor.redraw();
    expect(editor.citation()).not.toBe(drawn);
    editor.hover();

    expect(editor.requests).toHaveLength(1);
  });

  it("holds the hover back until Mod is held where Live Preview asks for it", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });

    editor.hover();
    expect(editor.requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    editor.hover();
    expect(editor.requests).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("keeps Obsidian's own hover out while Require Mod holds the popover back", () => {
    // Popover mode owns the gesture whole, so a bare hover it answers with
    // nothing shows nothing — never the page preview instead.
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });
    expect(editor.citation()).not.toBeNull();

    editor.hover();

    expect(editor.requests).toEqual([]);
    expect(editor.native).toEqual([]);
  });
});

describe("wikilinkEditorExtension hover under the other Hover Actions", () => {
  it("leaves the hover to Obsidian under Page preview and Off", () => {
    for (const action of ["page-preview", "off"] as const) {
      using editor = harness("[[literatures/example#cite:locator=7]]", {
        "citation.hover-action": action,
      });

      editor.hover();

      expect(editor.requests).toEqual([]);
      expect(editor.native).toHaveLength(1);
    }
  });

  it("takes its listener off as soon as hover stops being the popover's", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.setSettings({ "citation.hover-action": "off" });
    editor.hover();

    expect(editor.requests).toEqual([]);
    expect(editor.native).toHaveLength(1);
  });

  it("answers a Citation again once the popover is the Hover Action", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-action": "off",
    });

    editor.setSettings({ "citation.hover-action": "popover" });
    editor.hover();

    expect(editor.requests).toHaveLength(1);
    expect(editor.native).toEqual([]);
  });
});

describe("wikilinkEditorExtension click while Citations stay closed as links", () => {
  it("places the caret where a plain click landed, and stops there", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");
    expect(editor.citation()?.dataset.ztClick).toBe("edit");

    const event = editor.click();

    // The selection overlapping the link is what writes its source back, once
    // the view has the focus this environment cannot give it.
    expect(editor.selection()).toMatchObject({ anchor: 2, head: 2 });
    expect(editor.requests).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.native).toEqual([]);
  });

  it("answers the click while the Hover Action is off", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-action": "off",
    });

    editor.hover();
    expect(editor.requests).toEqual([]);

    const event = editor.click();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.selection()).toMatchObject({ anchor: 2 });
  });

  it("answers the click while Require Mod holds the hover back", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.hover-require-mod-live-preview": true,
    });

    const event = editor.click();

    expect(event.defaultPrevented).toBe(true);
    expect(editor.selection()).toMatchObject({ anchor: 2 });
  });

  it("leaves a Mod-click to Obsidian, which opens the note the link names", () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    using editor = harness("[[literatures/example#cite:locator=7]]");

    const event = editor.click({ ctrlKey: true });

    expect(editor.requests).toEqual([]);
    expect(editor.opened).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("leaves a click of another button to Obsidian", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.click({ button: 1 });

    expect(editor.requests).toEqual([]);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });
});

describe("wikilinkEditorExtension click while Citations open as links", () => {
  it("leaves every click to Obsidian", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.open-as-links": true,
    });
    expect(editor.citation()?.dataset.ztClick).toBe("open");

    const event = editor.click();

    expect(editor.requests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });

  it("takes its listener off as soon as Citations open as links", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]");

    editor.setSettings({ "citation.open-as-links": true });
    editor.click();

    expect(editor.citation()?.dataset.ztClick).toBe("open");
    expect(editor.selection()).toMatchObject({ anchor: 0 });
    expect(editor.native).toHaveLength(1);
  });

  it("answers a Citation's click again once they stay closed as links", () => {
    using editor = harness("[[literatures/example#cite:locator=7]]", {
      "citation.open-as-links": true,
    });

    editor.setSettings({ "citation.open-as-links": false });
    expect(editor.citation()?.dataset.ztClick).toBe("edit");
    editor.click();

    expect(editor.selection()).toMatchObject({ anchor: 2 });
    expect(editor.native).toEqual([]);
  });
});
