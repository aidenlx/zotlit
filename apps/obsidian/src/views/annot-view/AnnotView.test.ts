// @vitest-environment happy-dom
// The card list as a screen reader and the Tab key meet it: one multi-select
// grid of rows, one tab stop, and `aria-selected` that follows the Card
// Selection.
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { editorApp } from "./__fixtures__/editor-app";
import { AnnotActionsContext, NOOP_ACTIONS } from "./actions";
import type { AnnotActions } from "./actions";
import { AnnotView } from "./AnnotView";
import { NO_SELECTION, nextCardSelection, sameKeys } from "./card-selection";
import type { CardSelection } from "./card-selection";
import { AnnotStoreProvider, createAnnotStore, visibleOrder } from "./store";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const KEYS = ["AAAA1111", "BBBB2222", "CCCC3333"];

function highlight(key: string, text: string): AnnotationRecord {
  return {
    key,
    parentKey: "PDF00001",
    type: "highlight",
    color: "#ffd400",
    comment: null,
    text,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  };
}

/** Two cards share a word, so a search for it hides the first card alone. */
const TEXTS = ["alpha", "beta shared", "gamma shared"];

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mountList({
  app = {} as App,
  actions = {},
}: { app?: App; actions?: Partial<AnnotActions> } = {}) {
  const store = createAnnotStore();
  store.setState({
    attachments: [
      { itemID: 1, indexedKey: "PDF00001", path: null, annotCount: 3 },
    ],
    selectedAttachmentKey: "PDF00001",
    annotations: KEYS.map((key, index) => highlight(key, TEXTS[index]!)),
  });
  // The view's own prune: a filter change drops the cards it hides.
  store.subscribe(
    (s) => visibleOrder(s),
    () =>
      store.setState((s) => ({
        cardSelection: nextCardSelection(s.cardSelection, visibleOrder(s), {
          kind: "prune",
        }),
      })),
    { equalityFn: sameKeys },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() =>
    root?.render(
      createElement(
        AppContext,
        { value: app },
        createElement(
          AnnotActionsContext,
          { value: { ...NOOP_ACTIONS, ...actions } },
          createElement(
            AnnotStoreProvider,
            { value: store },
            createElement(AnnotView),
          ),
        ),
      ),
    ),
  );
  const select = (selection: CardSelection) =>
    act(() => store.setState({ cardSelection: selection }));
  return { host, select, store };
}

/** The card list, apart from the filter bar's own listboxes. */
function cardGrid(host: HTMLElement): HTMLElement {
  const grid = host.querySelector<HTMLElement>(
    '.annots-container > [role="grid"]',
  );
  if (!grid) throw new Error("no card grid");
  return grid;
}

/** Each row's key, its `aria-selected`, and whether Tab reaches it. */
function rows(host: HTMLElement) {
  return [...cardGrid(host).querySelectorAll<HTMLElement>('[role="row"]')].map(
    (row) => ({
      key: row.getAttribute("data-zotero-annotation-key"),
      selected: row.getAttribute("aria-selected"),
      tabbable: row.tabIndex === 0,
    }),
  );
}

/**
 * The Tab order through the grid, in document order: a row by its key, and a
 * control by the key of the row that holds it.
 */
function tabOrder(host: HTMLElement): string[] {
  return [...cardGrid(host).querySelectorAll<HTMLElement>("*")]
    .filter((el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"))
    .map((el) => {
      const row = el.closest('[role="row"]');
      const key = row?.getAttribute("data-zotero-annotation-key") ?? "?";
      return el === row ? `row ${key}` : `control in ${key}`;
    });
}

/** The Tab order when only one row and its controls are in it. */
function onlyRow(host: HTMLElement, key: string): string[] {
  const row = cardGrid(host).querySelector<HTMLElement>(
    `[data-zotero-annotation-key="${key}"]`,
  );
  const controls = [...(row?.querySelectorAll<HTMLElement>("*") ?? [])].filter(
    (el) => el.tabIndex >= 0 || el.hasAttribute("data-zt-held-tabindex"),
  );
  expect(controls.length).toBeGreaterThan(0);
  return [`row ${key}`, ...controls.map(() => `control in ${key}`)];
}

describe("the card list", () => {
  it("is one multi-select grid whose rows are the cards, in list order", async () => {
    const { host } = await mountList();
    const grid = cardGrid(host);
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");
    const label = document.getElementById(
      grid.getAttribute("aria-labelledby") ?? "",
    );
    expect(label?.textContent).toBe(m.annot_view_name());
    expect(grid.hasAttribute("aria-label")).toBe(false);
    const cards = [...grid.querySelectorAll(".zt-annot-card")];
    expect(cards.map((card) => card.getAttribute("role"))).toEqual(
      KEYS.map(() => "row"),
    );
    expect(cards.map((card) => card.parentElement)).toEqual(
      KEYS.map(() => grid),
    );
    // Each row holds its content in one cell.
    expect(
      cards.map((card) =>
        [...card.children].map((child) => child.getAttribute("role")),
      ),
    ).toEqual(KEYS.map(() => ["gridcell"]));
    expect(rows(host).map(({ key }) => key)).toEqual(KEYS);
  });

  it("offers the first row as its one tab stop while nothing is selected", async () => {
    const { host } = await mountList();
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: true },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("follows the Card Selection with aria-selected and moves the tab stop to its anchor", async () => {
    const { host, select } = await mountList();

    await select({
      selected: ["BBBB2222"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    });
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: false },
      { key: "BBBB2222", selected: "true", tabbable: true },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "BBBB2222"));

    await select({
      selected: ["AAAA1111", "CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    });
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "true", tabbable: false },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "true", tabbable: true },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "CCCC3333"));

    await select(NO_SELECTION);
    expect(rows(host)).toEqual([
      { key: "AAAA1111", selected: "false", tabbable: true },
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("keeps a control drawn later on another row out of the Tab order", async () => {
    const { host, store } = await mountList();
    await act(() =>
      store.setState((s) => ({
        annotations: s.annotations!.map((annot) => ({
          ...annot,
          tags: ["later"],
        })),
      })),
    );
    expect(tabOrder(host)).toEqual(onlyRow(host, "AAAA1111"));
  });

  it("keeps one tab stop among the rows a filter leaves", async () => {
    const { host, select, store } = await mountList();

    // The search hides the anchor; the rest of the group stays selected, and
    // the tab stop goes to it.
    await select({
      selected: ["AAAA1111", "CCCC3333"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
    await act(() => store.setState({ filterQuery: "shared" }));
    expect(store.getState().cardSelection).toEqual({
      selected: ["CCCC3333"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
    expect(rows(host)).toEqual([
      { key: "BBBB2222", selected: "false", tabbable: false },
      { key: "CCCC3333", selected: "true", tabbable: true },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "CCCC3333"));

    // The search hides every Selected Card; the first row it leaves is the
    // tab stop.
    await act(() => store.setState({ filterQuery: "" }));
    await select({
      selected: ["AAAA1111"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
    await act(() => store.setState({ filterQuery: "shared" }));
    expect(store.getState().cardSelection.selected).toEqual([]);
    expect(rows(host)).toEqual([
      { key: "BBBB2222", selected: "false", tabbable: true },
      { key: "CCCC3333", selected: "false", tabbable: false },
    ]);
    expect(tabOrder(host)).toEqual(onlyRow(host, "BBBB2222"));
  });
});

/** A press and its click on one element, as the browser delivers them. */
async function press(
  el: Element,
  { release = el }: { release?: Element } = {},
) {
  await act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    release.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("an open text field in the view", () => {
  it("closes from a click in the view away from it, and keeps its own clicks and drags", async () => {
    const onCloseEditors = vi.fn();
    const { host, store } = await mountList({
      app: editorApp(),
      actions: { onCloseEditors },
    });
    await act(() =>
      store.setState({
        cardSelection: { selected: [KEYS[0]!], anchor: null, focus: null },
        editing: { annotationKey: KEYS[0]!, field: "comment" },
      }),
    );
    const content = host.querySelector(".cm-content")!;
    const [first, second] = cardGrid(host).querySelectorAll('[role="row"]');

    await press(content);
    // A drag that selected the field's text and let go on its card.
    await press(content, { release: first! });
    // The empty list's own click closes the editor before it clears anything.
    await press(cardGrid(host));
    expect(onCloseEditors).not.toHaveBeenCalled();

    await press(second!.querySelector("blockquote")!);
    expect(onCloseEditors).toHaveBeenCalledOnce();
  });
});
