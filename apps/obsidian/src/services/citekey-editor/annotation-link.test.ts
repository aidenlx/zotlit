// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({ file: { path: "note.md" } }),
      update: (value) => value,
    }),
  };
});

import { editorInfoField, Keymap } from "obsidian";

import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import { hoverPreferences } from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";

import {
  annotationLinkAtPos,
  annotationLinkHoverExtension,
} from "./annotation-link";

const LINK =
  "[p. 2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)";

/** `See [p. 2](zotero://…) here.` — the link spans `[4, 76)`. */
const LINE = EditorState.create({ doc: `See ${LINK} here.` });

describe("annotationLinkAtPos", () => {
  it("answers with the annotation a position in the link text names", () => {
    expect(annotationLinkAtPos(LINE, 6)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: "2",
      groupID: null,
    });
  });

  it("answers inside the URL too, which Source mode shows", () => {
    expect(annotationLinkAtPos(LINE, 40)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("answers nothing beside the link", () => {
    expect(annotationLinkAtPos(LINE, 1)).toBeNull();
    expect(annotationLinkAtPos(LINE, 4 + LINK.length + 2)).toBeNull();
  });

  it("reads a group Library's link with its group", () => {
    const state = EditorState.create({
      doc: "[quote](zotero://open/groups/42/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 2)).toEqual({
      attachmentKey: "RGRPDF24",
      annotationKey: "FDRFQ7C2",
      pageLabel: null,
      groupID: 42,
    });
  });

  it("reads link text that carries brackets of its own", () => {
    const state = EditorState.create({
      doc: "[[p. 2] quote](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2)",
    });
    expect(annotationLinkAtPos(state, 3)?.annotationKey).toBe("FDRFQ7C2");
  });

  it("picks the link the position sits in, of two on one line", () => {
    const state = EditorState.create({
      doc:
        "[a](zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5) and " +
        "[b](zotero://open/library/items/RGRPDF24?annotation=Q8ZR4TDH)",
    });
    expect(annotationLinkAtPos(state, 1)?.annotationKey).toBe("PUPR5FG5");
    expect(annotationLinkAtPos(state, 70)?.annotationKey).toBe("Q8ZR4TDH");
  });

  it("answers nothing for a Zotero link that names no annotation", () => {
    for (const doc of [
      "[item](zotero://open/library/items/RGRPDF24)",
      "[item](zotero://select/library/items/RGRPDF24)",
      "[web](https://example.org/?annotation=FDRFQ7C2)",
    ]) {
      expect(annotationLinkAtPos(EditorState.create({ doc }), 2)).toBeNull();
    }
  });
});

describe("annotationLinkHoverExtension", () => {
  const hover = (
    overrides: Partial<HoverPreferences> = {},
  ): HoverPreferences => ({ ...hoverPreferences(defaults), ...overrides });

  /**
   * One editor over `See [p. 2](zotero://…) here.`, its link text and URL
   * classed the way Obsidian's Markdown highlighter classes them, with the
   * pointer answered from inside the link text — happy-dom lays nothing out.
   */
  function linkView(
    requests: AnnotationHoverRequest[],
    { preferences = hover(), live = true, pagePreviewRequiresMod = true } = {},
  ) {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: `See ${LINK} here.`,
        extensions: [
          editorInfoField,
          EditorView.decorations.of(
            Decoration.set([
              Decoration.mark({ class: "cm-link" }).range(5, 9),
              Decoration.mark({ class: "cm-url" }).range(11, 75),
            ]),
          ),
          annotationLinkHoverExtension({
            hoverPreferences: () => preferences,
            pagePreviewRequiresMod: () => pagePreviewRequiresMod,
            showAnnotation: (request) => requests.push(request),
          }),
        ],
      }),
    });
    if (live) view.dom.classList.add("is-live-preview");
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);
    return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
  }

  const linkText = (view: EditorView): HTMLElement =>
    view.dom.querySelector<HTMLElement>(".cm-link")!;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the annotation the hovered link names", () => {
    const requests: AnnotationHoverRequest[] = [];
    using view = linkView(requests);

    linkText(view).dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetEl: linkText(view),
      link: {
        attachmentKey: "RGRPDF24",
        annotationKey: "FDRFQ7C2",
        groupID: null,
      },
    });
  });

  it("shows it under Page Preview, as Obsidian's Page preview row gates it", () => {
    const requests: AnnotationHoverRequest[] = [];
    {
      using view = linkView(requests, {
        preferences: hover({ action: "page-preview" }),
        pagePreviewRequiresMod: true,
      });
      linkText(view).dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    }
    expect(requests).toEqual([]);

    using view = linkView(requests, {
      preferences: hover({ action: "page-preview" }),
      pagePreviewRequiresMod: false,
    });
    linkText(view).dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );
    expect(requests).toHaveLength(1);
  });

  it("shows nothing while the Hover action is off", () => {
    const requests: AnnotationHoverRequest[] = [];
    using view = linkView(requests, { preferences: hover({ action: "off" }) });
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);

    linkText(view).dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(requests).toEqual([]);
  });

  it("holds Source mode's hover back until Mod is held", () => {
    const requests: AnnotationHoverRequest[] = [];
    using view = linkView(requests, { live: false });

    linkText(view).dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );
    expect(requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    linkText(view).dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );
    expect(requests).toHaveLength(1);
  });

  it("hovers once while the pointer moves inside one link", () => {
    const requests: AnnotationHoverRequest[] = [];
    using view = linkView(requests);
    const targetEl = linkText(view);

    targetEl.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: targetEl.firstChild,
      }),
    );

    expect(requests).toEqual([]);
  });

  it("leaves plain text alone", () => {
    const requests: AnnotationHoverRequest[] = [];
    using view = linkView(requests);
    vi.spyOn(view, "posAtCoords").mockReturnValue(1);

    view.contentDOM.firstElementChild!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(requests).toEqual([]);
  });
});
