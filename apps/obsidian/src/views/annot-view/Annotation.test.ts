// @vitest-environment happy-dom
// A click on a card's comment or held text is the card's own selection gesture
// (ADR 0061), and the comment pencil alone opens the editor (ADR 0060). The
// pencil stands only on a card selected alone.
import { Keymap } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

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
}: {
  held?: boolean;
  /** Whether the repository starts a comment draft for the editor to open on. */
  opens?: boolean;
  comment?: string | null;
  /** The Card Selection: this card alone by default. */
  selected?: string[];
  capability?: EditingCapability;
} = {}) {
  const store = createAnnotStore();
  store.setState({
    capability,
    cardSelection: { selected, anchor: null, focus: null },
    fieldDrafts: {
      text: new Map(),
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
          : [],
      ),
    },
  });
  const onSelectAnnotation = vi.fn();
  const onOpenComment = vi.fn(() => opens);
  const onOpenTags = vi.fn(() => true);
  const onSaveTags = vi.fn();
  const onSaveComment = vi.fn();
  const onBlockedPress = vi.fn();
  const actions = new Proxy(
    {
      onSelectAnnotation,
      onOpenComment,
      onOpenTags,
      onSaveTags,
      onSaveComment,
      onBlockedPress,
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
    onOpenComment,
    onOpenTags,
    onSaveTags,
    onSaveComment,
    onBlockedPress,
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

/** The comment pencil beside the card's comment, or `undefined` for none. */
function pencil(host: HTMLElement): HTMLElement | undefined {
  return (
    host.querySelector<HTMLElement>(".zt-annot-comment-pencil") ?? undefined
  );
}

describe("a click on a card's comment", () => {
  it("selects the card, toggles it or takes a range, and opens no editor", async () => {
    const { host, store, onSelectAnnotation, onOpenComment } =
      await mountCard();
    const comment = host.querySelector(".zt-annot-comment")!;

    await click(comment);
    await click(comment, { metaKey: true });
    await click(comment, { shiftKey: true });
    expect(onSelectAnnotation.mock.calls).toEqual([
      [CARD, "click"],
      [CARD, "toggle"],
      [CARD, "range"],
    ]);
    expect(onOpenComment).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });

  it("selects the card from the held text, and opens no editor", async () => {
    const { host, onSelectAnnotation, onOpenComment } = await mountCard({
      held: true,
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
    expect(onOpenComment).not.toHaveBeenCalled();
  });
});

describe("the comment pencil", () => {
  it("stands only on a card selected alone", async () => {
    for (const selected of [[], [CARD.key, "BBBB2222"]]) {
      const { host } = await mountCard({ selected });
      expect(pencil(host)).toBeUndefined();
      // The tag toggle stays on a card selected with others.
      expect(() => tagToggle(host)).not.toThrow();
      await act(() => root?.unmount());
      host.remove();
    }
    const { host } = await mountCard();
    expect(pencil(host)).toBeDefined();
  });

  it("comes up beside the same comment nodes, so a text selection on them survives", async () => {
    const { host, store } = await mountCard({ selected: [] });
    const comment = host.querySelector(".zt-annot-comment");

    await act(() =>
      store.setState({
        cardSelection: { selected: [CARD.key], anchor: null, focus: null },
      }),
    );
    expect(pencil(host)).toBeDefined();
    expect(host.querySelector(".zt-annot-comment")).toBe(comment);
  });

  it("opens the comment editor only where a draft starts, and is not the card's click", async () => {
    for (const opens of [false, true]) {
      const { host, store, onSelectAnnotation } = await mountCard({ opens });
      await click(pencil(host)!);
      expect(store.getState().editing).toEqual(
        opens ? { annotationKey: CARD.key, field: "comment" } : null,
      );
      expect(onSelectAnnotation).not.toHaveBeenCalled();
      await act(() => root?.unmount());
      host.remove();
    }
  });

  it("saves and closes the open editor on a second press", async () => {
    const { host, store, onSaveComment } = await mountCard();
    await click(pencil(host)!);
    await click(pencil(host)!);
    expect(store.getState().editing).toBeNull();
    expect(onSaveComment).toHaveBeenCalledWith(CARD, CARD.comment, true);
  });

  it("saves and closes an open editor whose capability turned blocked, and raises no notice", async () => {
    const { host, store, onSaveComment, onBlockedPress } = await mountCard();
    await click(pencil(host)!);
    await act(() =>
      store.setState({ capability: { kind: "authorization-required" } }),
    );

    await click(pencil(host)!);
    expect(store.getState().editing).toBeNull();
    expect(onSaveComment).toHaveBeenCalledWith(CARD, CARD.comment, true);
    expect(onBlockedPress).not.toHaveBeenCalled();
  });

  it("stays pressable where editing is blocked, and its press raises the reason", async () => {
    const { host, store, onBlockedPress, onOpenComment } = await mountCard({
      capability: { kind: "authorization-required" },
    });
    await click(pencil(host)!);
    expect(onBlockedPress).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow-editing" }),
    );
    expect(onOpenComment).not.toHaveBeenCalled();
    expect(store.getState().editing).toBeNull();
  });

  it("stands on an Add comment line for a card with no comment, which opens the editor too", async () => {
    const { host, store } = await mountCard({ comment: null });
    const line = host.querySelector(".zt-annot-add-comment")!;
    expect(line.textContent).toBe(m.annot_view_card_comment_placeholder());
    // One control, in the Tab order, that the keyboard reaches too.
    expect(line.getAttribute("role")).toBe("button");
    expect(pencil(host)).toBeDefined();

    await click(line);
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "comment",
    });
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

    await click(pencil(host)!);

    // The tag editor ended its session as it unmounted.
    expect(onSaveTags).toHaveBeenCalledOnce();
    expect(store.getState().editing).toEqual({
      annotationKey: CARD.key,
      field: "comment",
    });
  });
});

it("saves the card's comment and closes its editor on Done", async () => {
  const { host, store, onSaveComment } = await mountCard();
  await click(pencil(host)!);
  const done = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Done",
  )!;

  await click(done);

  expect(onSaveComment.mock.calls).toEqual([[CARD, CARD.comment, true]]);
  expect(store.getState().editing).toBeNull();
  expect(host.querySelector(".cm-content")).toBeNull();
});
