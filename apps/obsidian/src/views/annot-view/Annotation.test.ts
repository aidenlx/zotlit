// @vitest-environment happy-dom
// A click on a card's comment or held text is the card's own selection gesture
// (ADR 0061) until the card is selected alone. Then the comment is a field: a
// click on it opens its editor, which Escape or a click away closes (ADR 0066).
import { Keymap } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  MutationState,
  TextFieldDraft,
} from "@/services/annotation-repository/service";

import { editorApp } from "./__fixtures__/editor-app";
import { AnnotActionsContext } from "./actions";
import type { AnnotActions } from "./actions";
import { Annotation } from "./Annotation";
import { AnnotStoreProvider, createAnnotStore } from "./store";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const CARD: AnnotationRecord = {
  key: "AAAA1111",
  parentKey: "PDF00001",
  type: "highlight",
  color: "#ffd400",
  comment: "A saved comment",
  text: "alpha",
  pageLabel: "1",
  sortIndex: "00000|000000|00000",
  tags: ["method"],
  version: 1,
  lock: null,
  position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
};

let root: Root | undefined;

beforeEach(() => {
  vi.spyOn(Keymap, "isModifier").mockImplementation(
    (event, modifier) => modifier === "Mod" && event.metaKey,
  );
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Draws one element in a fresh root, as the view mounts its tree. */
async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() =>
    root?.render(createElement(AppContext, { value: editorApp() }, element)),
  );
  return host;
}

/**
 * One editable card, and the actions it calls: the card's click and the
 * editors it opens. Every other action is inert.
 */
async function mountCard({
  held = false,
  opens = true,
  comment = CARD.comment,
  selected = [CARD.key],
  capability = { kind: "writable" },
  drafts = {},
  mutation,
}: {
  held?: boolean;
  /** Whether the repository starts a comment draft for the editor to open on. */
  opens?: boolean;
  comment?: string | null;
  /** The Card Selection: this card alone by default. */
  selected?: string[];
  capability?: EditingCapability;
  /** Each text field's draft beside the held comment, by the state it is in. */
  drafts?: Partial<
    Record<
      "comment" | "text",
      Pick<TextFieldDraft, "text" | "state"> & {
        manualSave?: boolean;
      }
    >
  >;
  /** What a write left on the Annotation. */
  mutation?: MutationState;
} = {}) {
  const draftOf = (
    draft: Pick<TextFieldDraft, "text" | "state"> & { manualSave?: boolean },
  ): [string, TextFieldDraft] => [
    CARD.key,
    {
      annotationKey: CARD.key,
      attachmentKey: CARD.parentKey,
      serverID: "fixture",
      baseline: "",
      ...draft,
    },
  ];
  const store = createAnnotStore();
  store.setState({
    capability,
    cardSelection: { selected, anchor: null, focus: null },
    ...(mutation && { mutations: new Map([[CARD.key, mutation]]) }),
    fieldDrafts: {
      text: new Map(drafts.text ? [draftOf(drafts.text)] : []),
      comment: new Map(
        held
          ? [
              [
                CARD.key,
                {
                  annotationKey: CARD.key,
                  attachmentKey: CARD.parentKey,
                  serverID: "fixture",
                  baseline: "",
                  text: "Held text",
                  state: { kind: "editing" },
                  manualSave: true,
                },
              ],
            ]
          : drafts.comment
            ? [draftOf(drafts.comment)]
            : [],
      ),
    },
  });
  const onSelectAnnotation = vi.fn();
  const onOpenField = vi.fn(() => opens);
  const onOpenTags = vi.fn(() => true);
  const onSaveTags = vi.fn();
  const onSaveField = vi.fn();
  const onBlockedPress = vi.fn();
  const onApplyAgain = vi.fn();
  const onDiscardConflict = vi.fn();
  const onCloseEditors = vi.fn();
  const actions = new Proxy(
    {
      onCloseEditors,
      onSelectAnnotation,
      onOpenField,
      onOpenTags,
      onSaveTags,
      onSaveField,
      onBlockedPress,
      onApplyAgain,
      onDiscardConflict,
    } as Partial<AnnotActions>,
    {
      get: (target, name: keyof AnnotActions) =>
        target[name] ??
        (name === "openExcerptImage"
          ? () => ({
              demand: () => {},
              release: () => {},
              subscribe: () => () => {},
              snapshot: () => ({ kind: "none" }),
            })
          : name === "renderComment"
            ? () => () => {}
            : () => null),
    },
  ) as AnnotActions;
  const host = await mount(
    createElement(
      AnnotStoreProvider,
      { value: store },
      createElement(
        AnnotActionsContext,
        { value: actions },
        createElement(Annotation, {
          annot: { ...CARD, comment },
          collapsed: false,
          tabStop: true,
        }),
      ),
    ),
  );
  return {
    host,
    store,
    onSelectAnnotation,
    onOpenField,
    onOpenTags,
    onSaveTags,
    onSaveField,
    onBlockedPress,
    onApplyAgain,
    onDiscardConflict,
    onCloseEditors,
  };
}

/** A click as the browser delivers it, with these keys held. */
async function click(el: Element, keys: MouseEventInit = {}): Promise<void> {
  await act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...keys }),
    );
  });
}

/** The comment field at rest, or `undefined` where the card offers none. */
function field(host: HTMLElement): HTMLElement | undefined {
  return (
    host.querySelector<HTMLElement>(".zt-annot-comment-field") ?? undefined
  );
}

/** The name a screen reader gives the element, from the labels it points at. */
function accessibleName(el: HTMLElement): string | null {
  const ids = el.getAttribute("aria-labelledby");
  if (ids === null) return el.getAttribute("aria-label");
  return ids
    .split(" ")
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** "Edit quoted text" on the quote, or `undefined` where the card offers none. */
function editTextButton(host: HTMLElement): HTMLElement | undefined {
  return (
    [...host.querySelectorAll<HTMLElement>("blockquote [aria-label]")].find(
      (el) => el.getAttribute("aria-label") === m.annot_view_menu_edit_text(),
    ) ?? undefined
  );
}

/** A key pressed in an element, as the browser delivers it. */
async function press(el: Element, key: string): Promise<void> {
  await act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("a click on the comment of a card not selected alone", () => {
  it("selects the card, toggles it or takes a range, and opens no editor", async () => {
    for (const selected of [[], [CARD.key, "BBBB2222"]]) {
      const { host, store, onSelectAnnotation, onOpenField } = await mountCard({
        selected,
      });
      const comment = host.querySelector(".zt-annot-comment")!;

      await click(comment);
      await click(comment, { metaKey: true });
      await click(comment, { shiftKey: true });
      expect(onSelectAnnotation.mock.calls).toEqual([
        [CARD, "click"],
        [CARD, "toggle"],
        [CARD, "range"],
      ]);
      expect(onOpenField).not.toHaveBeenCalled();
      expect(store.getState().editing).toBeNull();
      await act(() => root?.unmount());
      host.remove();
    }
  });

  it("selects the card from the held text, and opens no editor", async () => {
    const { host, onSelectAnnotation, onOpenField } = await mountCard({
      held: true,
      selected: [],
    });
    const text = [...host.querySelectorAll("div")].find(
      (el) => el.textContent === "Held text",
    )!;

    await click(text);
    await click(text, { metaKey: true });
    expect(onSelectAnnotation.mock.calls).toEqual([
      [CARD, "click"],
      [CARD, "toggle"],
    ]);
    expect(onOpenField).not.toHaveBeenCalled();
  });
});

describe("the comment field", () => {
  it("stands only on a card selected alone, and the header offers no Edit text", async () => {
    for (const selected of [[], [CARD.key, "BBBB2222"]]) {
      const { host } = await mountCard({ selected });
      expect(field(host)).toBeUndefined();
      // The tag toggle stays on a card selected with others.
      expect(() => tagToggle(host)).not.toThrow();
      await act(() => root?.unmount());
      host.remove();
    }
    const { host } = await mountCard();
    expect(accessibleName(field(host)!)).toBe(
      m.annot_view_card_comment_label(),
    );
    // A label Obsidian would show as a tooltip over the comment's text.
    expect(field(host)!.hasAttribute("aria-label")).toBe(false);
  });

  it("comes up on the same comment nodes, so a text selection on them survives", async () => {
    const { host, store } = await mountCard({ selected: [] });
    const comment = host.querySelector(".zt-annot-comment");

    await act(() =>
      store.setState({
        cardSelection: { selected: [CARD.key], anchor: null, focus: null },
      }),
    );
    expect(field(host)).toBe(comment);
  });

  it("opens the comment editor from a click only where a draft starts, and is not the card's click", async () => {
    for (const opens of [false, true]) {
      const { host, store, onSelectAnnotation } = await mountCard({ opens });
      await click(field(host)!, { clientX: 12, clientY: 34, detail: 1 });
      // The caret goes where the click landed.
      expect(store.getState().editing).toEqual(
        opens
          ? {
              annotationKey: CARD.key,
              field: "comment",
              caretAt: { x: 12, y: 34 },
            }
          : null,
      );
      expect(onSelectAnnotation).not.toHaveBeenCalled();
      await act(() => root?.unmount());
      host.remove();
    }
  });

  it("opens the editor at the end from a click with no pointer behind it", async () => {
    const { host, store } = await mountCard();
    await click(field(host)!, { detail: 0 });
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "comment",
    });
  });

  it("opens the editor from Enter, for the keyboard", async () => {
    const { host, store } = await mountCard();
    await press(field(host)!, "Enter");
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "comment",
    });
  });

  it("keeps a click that selected the comment's text a read", async () => {
    const { host, store, onOpenField } = await mountCard();
    const comment = field(host)!;
    comment.textContent = CARD.comment;
    const range = document.createRange();
    range.selectNodeContents(comment);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    await click(comment);
    document.getSelection()!.removeAllRanges();

    expect(onOpenField).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });

  it("stays pressable where editing is blocked, and its press raises the reason", async () => {
    const { host, store, onBlockedPress, onOpenField } = await mountCard({
      capability: { kind: "authorization-required" },
    });
    expect(field(host)?.hasAttribute("data-blocked")).toBe(true);
    await click(field(host)!);
    expect(onBlockedPress).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow-editing" }),
    );
    expect(onOpenField).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });

  it('shows "Add a comment…" on a card with no comment, and opens the editor from it', async () => {
    const { host, store } = await mountCard({ comment: null });
    expect(field(host)?.textContent).toBe(
      m.annot_view_card_comment_placeholder(),
    );

    await click(field(host)!);
    expect(store.getState().editing).toMatchObject({
      annotationKey: CARD.key,
      field: "comment",
    });
  });

  it("saves and closes on Escape, with no button to press", async () => {
    const { host, store, onSaveField } = await mountCard();
    await click(field(host)!);
    expect(host.querySelector("button.mod-cta")).toBeNull();

    await press(host.querySelector(".cm-content")!, "Escape");

    expect(onSaveField.mock.calls).toEqual([
      [CARD, "comment", { text: CARD.comment, automatic: true }],
    ]);
    expect(store.getState().editing).toBeNull();
    expect(host.querySelector(".cm-content")).toBeNull();
    // The keyboard stays on the card.
    expect(document.activeElement).toBe(host.querySelector(".zt-annot-card"));
  });
});

it("selects the card from a click on the tag row's empty space, and opens no tag editor", async () => {
  const { host, onSelectAnnotation, onOpenTags } = await mountCard();
  // The tag toggle alone opens the editor, as the Mark Popup's tag verb does.
  const row = host.querySelector("[aria-pressed]")!.parentElement!;

  await click(row);
  expect(onSelectAnnotation).toHaveBeenCalledOnce();
  expect(onOpenTags).not.toHaveBeenCalled();
});

/** The tag toggle in the card's action bar, the one way into the tag editor. */
function tagToggle(host: HTMLElement): Element {
  const toggle = [...host.querySelectorAll(".clickable-icon")].find((el) =>
    el.querySelector("svg.lucide-tag"),
  );
  if (!toggle) throw new Error("The card draws no tag toggle");
  return toggle;
}

describe("Edit quoted text on the quote", () => {
  it("stands only on a card selected alone that has a Quoted Text", async () => {
    for (const selected of [[], [CARD.key, "BBBB2222"]]) {
      const { host } = await mountCard({ selected });
      expect(editTextButton(host)).toBeUndefined();
      await act(() => root?.unmount());
      host.remove();
    }
    const { host } = await mountCard();
    expect(editTextButton(host)).toBeDefined();
  });

  it("opens the Quoted Text's editor, and is not the card's click", async () => {
    const { host, store, onSelectAnnotation, onOpenField } = await mountCard();
    await click(editTextButton(host)!);
    expect(onOpenField).toHaveBeenCalledWith(
      expect.objectContaining({ key: CARD.key }),
      "text",
    );
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "text",
    });
    expect(onSelectAnnotation).not.toHaveBeenCalled();
    // The open editor stands in the quote's place, with no second way in.
    expect(editTextButton(host)).toBeUndefined();
  });

  it("raises the reason where editing is blocked, and opens nothing", async () => {
    const { host, store, onBlockedPress, onOpenField } = await mountCard({
      capability: { kind: "authorization-required" },
    });
    await click(editTextButton(host)!);
    expect(onBlockedPress).toHaveBeenCalledOnce();
    expect(onOpenField).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });

  it("keeps a click on the quote itself a read", async () => {
    const { host, store, onOpenField } = await mountCard();
    await click(host.querySelector("blockquote")!);
    expect(onOpenField).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });
});

describe("the card's tag editor", () => {
  it("saves its session on a blur and stays open, and Escape saves and closes it", async () => {
    const { host, store, onSaveTags } = await mountCard();
    await click(tagToggle(host));
    const input = host.querySelector<HTMLInputElement>(".zt-annot-tag-input")!;

    await act(() => {
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(onSaveTags.mock.calls).toEqual([[CARD, { automatic: true }]]);
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "tags",
    });

    await act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onSaveTags).toHaveBeenCalledTimes(2);
    expect(store.getState().editing).toBeNull();
  });

  it("starts no second save from a blur while the last one is in flight", async () => {
    const { host, store, onSaveTags } = await mountCard();
    await click(tagToggle(host));
    await act(() => {
      store.setState({
        tagDrafts: new Map([
          [
            CARD.key,
            {
              annotationKey: CARD.key,
              attachmentKey: CARD.parentKey,
              serverID: "fixture",
              baseline: [],
              names: CARD.tags,
              state: { kind: "pending" },
            },
          ],
        ]),
      });
    });
    const input = host.querySelector<HTMLInputElement>(".zt-annot-tag-input")!;

    await act(() => {
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });

    expect(onSaveTags).not.toHaveBeenCalled();
  });

  it("leaves the comment editor that replaced it open as it goes", async () => {
    const { host, store, onSaveTags } = await mountCard();
    await click(tagToggle(host));

    await click(field(host)!);

    // The tag editor ended its session as it unmounted.
    expect(onSaveTags).toHaveBeenCalledOnce();
    expect(store.getState().editing).toMatchObject({
      annotationKey: CARD.key,
      field: "comment",
    });
  });
});

/** One panel's button, by its label. */
function button(panel: Element, label: string): Element {
  return [...panel.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )!;
}

describe("a text field's draft on the card", () => {
  const conflict = (fresh: string) => ({ kind: "conflict" as const, fresh });

  it("shows a comment conflict and a Quoted Text conflict at once, each in its field's place, through a write in flight", async () => {
    const { host, onApplyAgain, onDiscardConflict } = await mountCard({
      selected: [],
      drafts: {
        comment: { text: "My comment", state: conflict("Zotero's comment") },
        text: { text: "My text", state: conflict("Zotero's text") },
      },
      // A save of another field in flight hides neither.
      mutation: { kind: "pending", write: "tags", session: true },
    });
    const panels = [...host.querySelectorAll(".zt-annot-conflict")];
    expect(panels).toHaveLength(2);
    const [inExcerpt, inComment] = panels;
    expect(inExcerpt!.closest("blockquote")).not.toBeNull();
    expect(inExcerpt!.textContent).toContain("Zotero's text");
    expect(inComment!.closest("blockquote")).toBeNull();
    expect(inComment!.textContent).toContain("Zotero's comment");

    await click(button(inExcerpt!, m.annot_view_conflict_use_text()));
    await click(
      button(inComment!, m.annot_view_conflict_keep_zotero_comment()),
    );
    expect(onApplyAgain.mock.calls).toEqual([[CARD, "text"]]);
    expect(onDiscardConflict.mock.calls).toEqual([[CARD, "comment"]]);
  });

  it("holds Quoted Text in the Excerpt Block beside the colour rule, and a click on it continues it on a card selected alone", async () => {
    const held = {
      text: "alpha, corrected",
      state: { kind: "editing" as const },
      manualSave: true,
    };
    const { host, store, onSelectAnnotation } = await mountCard({
      selected: [],
      drafts: { text: held },
    });
    const panel = host.querySelector("blockquote .zt-annot-draft");
    expect(panel?.textContent).toContain(m.annot_view_text_draft());
    const text = [...panel!.querySelectorAll("div")].find(
      (el) => el.textContent === held.text,
    )!;
    await click(text);
    expect(onSelectAnnotation.mock.calls).toEqual([[CARD, "click"]]);
    expect(store.getState().editing).toBeNull();

    await act(() =>
      store.setState({
        cardSelection: { selected: [CARD.key], anchor: null, focus: null },
      }),
    );
    await click(
      [...host.querySelectorAll("blockquote .zt-annot-draft div")].find(
        (el) => el.textContent === held.text,
      )!,
    );
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "text",
    });
    expect(host.querySelector("blockquote .cm-content")?.textContent).toBe(
      held.text,
    );
    expect(host.querySelector(".zt-annot-draft")).toBeNull();
  });

  it("keeps the typed text when Escape closes the editor while the blur's save is in flight", async () => {
    const { host, store, onSaveField } = await mountCard();
    await act(() =>
      store.setState({ editing: { annotationKey: CARD.key, field: "text" } }),
    );
    // A blur's save left the draft pending.
    await act(() =>
      store.setState({
        fieldDrafts: {
          ...store.getState().fieldDrafts,
          text: new Map([
            [
              CARD.key,
              {
                annotationKey: CARD.key,
                attachmentKey: CARD.parentKey,
                serverID: "fixture",
                baseline: CARD.text!,
                text: "alpha, typed",
                state: { kind: "pending" },
              },
            ],
          ]),
        },
      }),
    );

    await press(host.querySelector("blockquote .cm-content")!, "Escape");
    expect(store.getState().editing).toBeNull();
    expect(onSaveField.mock.calls).toEqual([
      [CARD, "text", { text: "alpha, typed", automatic: true }],
    ]);
  });
});
