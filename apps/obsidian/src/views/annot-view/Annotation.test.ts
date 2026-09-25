// @vitest-environment happy-dom
// A Shift or Cmd/Ctrl click on a card's edit areas is the card's own selection
// gesture (ADR 0061), and a plain click there opens the editor. The Mark
// Popup selects one mark, so the same click on its comment opens its editor.
import { Keymap } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { AnnotActionsContext } from "./actions";
import type { AnnotActions } from "./actions";
import { Annotation } from "./Annotation";
import { CommentView } from "./comment-parts";
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
    root?.render(createElement(AppContext, { value: {} as App }, element)),
  );
  return host;
}

/**
 * One editable card, and the actions it calls: the card's click and the
 * editors it opens. Every other action is inert.
 */
async function mountCard({ held = false }: { held?: boolean } = {}) {
  const store = createAnnotStore();
  store.setState({
    capability: { kind: "writable" },
    commentDrafts: new Map(
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
  });
  const onSelectAnnotation = vi.fn();
  const onOpenComment = vi.fn(() => true);
  const onOpenTags = vi.fn(() => true);
  const actions = new Proxy(
    { onSelectAnnotation, onOpenComment, onOpenTags } as Partial<AnnotActions>,
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
          annot: CARD,
          collapsed: false,
          tabStop: true,
        }),
      ),
    ),
  );
  return { host, onSelectAnnotation, onOpenComment, onOpenTags };
}

/** A click as the browser delivers it, with these keys held. */
async function click(el: Element, keys: MouseEventInit = {}): Promise<void> {
  await act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...keys }),
    );
  });
}

describe("a Shift or Cmd/Ctrl click on a card's edit areas", () => {
  it("toggles the card or takes a range from its comment, and opens no editor", async () => {
    const { host, onSelectAnnotation, onOpenComment } = await mountCard();
    const comment = host.querySelector(".zt-annot-comment")!;

    await click(comment, { metaKey: true });
    await click(comment, { shiftKey: true });
    expect(onSelectAnnotation.mock.calls).toEqual([
      [CARD, "toggle"],
      [CARD, "range"],
    ]);
    expect(onOpenComment).not.toHaveBeenCalled();

    // A plain click opens the editor, and is not the card's selection.
    await click(comment);
    expect(onOpenComment).toHaveBeenCalledOnce();
    expect(onSelectAnnotation).toHaveBeenCalledTimes(2);
  });

  it("toggles the card from the held text, and opens no editor", async () => {
    const { host, onSelectAnnotation, onOpenComment } = await mountCard({
      held: true,
    });
    const text = [...host.querySelectorAll("div")].find(
      (el) => el.textContent === "Held text",
    )!;

    await click(text, { metaKey: true });
    expect(onSelectAnnotation.mock.calls).toEqual([[CARD, "toggle"]]);
    expect(onOpenComment).not.toHaveBeenCalled();

    await click(text);
    expect(onOpenComment).toHaveBeenCalledOnce();
    expect(onSelectAnnotation).toHaveBeenCalledOnce();
  });

  it("takes a range from the tag row's empty space, and opens no tag editor", async () => {
    const { host, onSelectAnnotation, onOpenTags } = await mountCard();
    const row = host.querySelector("[data-editable]")!;

    await click(row, { shiftKey: true });
    expect(onSelectAnnotation.mock.calls).toEqual([[CARD, "range"]]);
    expect(onOpenTags).not.toHaveBeenCalled();

    await click(row);
    expect(onOpenTags).toHaveBeenCalledOnce();
    expect(onSelectAnnotation).toHaveBeenCalledOnce();
  });
});

it("opens the Mark Popup's comment editor for a Shift or Cmd/Ctrl click", async () => {
  const onOpen = vi.fn();
  const host = await mount(
    createElement(CommentView, {
      surface: "popup",
      render: () => () => {},
      html: "A saved comment",
      editable: true,
      onOpen,
    }),
  );
  const comment = host.querySelector(".zt-annot-comment")!;
  await click(comment, { metaKey: true });
  await click(comment, { shiftKey: true });
  expect(onOpen).toHaveBeenCalledTimes(2);
});
