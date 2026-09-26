// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { SelectedText } from "@zotlit/pdf-structure";

import { annotation, toolColors } from "./__fixtures__";
import type { Point } from "./hit-test";
import { MarkPopupHost } from "./mark-popup-host";
import {
  captureSelection,
  createReaderSurfaceState,
  ingestCommentDraft,
  ingestRecords,
  selectMark,
  setCommenting,
} from "./reader-surface-state";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const WORD = annotation("WORD2222", "highlight", {
  pageIndex: 0,
  rects: [[200, 610, 240, 630]],
});
const LINE = annotation("LINE3333", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});
const CAPTURED: SelectedText = {
  pageIndex: 0,
  rects: [[58.054, 601.98, 211.489, 610.112]],
  text: "this process",
};

/**
 * One variant as its owner hands it to the host: an anchor the test moves, and
 * a renderer that answers one labelled node and counts every call.
 */
function variant(label: string, at: Point | null) {
  let anchor = at;
  const renders: HTMLElement[] = [];
  return {
    renders,
    unanchored: vi.fn(),
    moveTo(next: Point | null) {
      anchor = next;
    },
    anchor: () => anchor,
    render: (content: HTMLElement) => {
      renders.push(content);
      return createElement("span", null, label);
    },
  };
}

function host() {
  const store = createReaderSurfaceState({
    colors: toolColors().current(),
    capability: { kind: "writable" },
    now: NOW,
  });
  ingestRecords(store, [WORD, LINE]);
  const parent: HoverParent = { hoverPopover: null };
  const selected = variant("selected row", { x: 220, y: 182 });
  const create = variant("create row", { x: 100, y: 300 });
  const popupHost = new MarkPopupHost({
    parent,
    store,
    variants: { selected, create },
  });
  return {
    store,
    selected,
    create,
    host: popupHost,
    popup: () =>
      parent.hoverPopover as unknown as {
        hoverEl: HTMLElement;
        staticPos: Point | null;
      } | null,
    [Symbol.dispose]() {
      popupHost[Symbol.dispose]();
    },
  };
}

afterEach(() => {
  document.body.empty();
});

it("opens nothing while nothing floats", () => {
  using h = host();

  expect(h.popup()).toBeNull();
  expect(h.selected.renders).toEqual([]);
});

it("opens over a selected mark, at the point its anchor reads", () => {
  using h = host();

  selectMark(h.store, "WORD2222");

  expect(h.popup()?.staticPos).toEqual({ x: 220, y: 182 });
  expect(h.popup()?.hoverEl.textContent).toBe("selected row");
});

it("turns the same popup over to a captured selection, with its own row", () => {
  using h = host();
  selectMark(h.store, "WORD2222");
  const opened = h.popup();

  captureSelection(h.store, {
    captured: CAPTURED,
    anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
  });

  expect(h.popup()).toBe(opened);
  expect(opened?.staticPos).toEqual({ x: 100, y: 300 });
  expect(opened?.hoverEl.textContent).toBe("create row");
});

it("hides while the anchor is off screen, and shows again once it is back", () => {
  using h = host();
  selectMark(h.store, "WORD2222");

  h.selected.moveTo(null);
  h.host.sync();
  expect(h.popup()).toBeNull();
  expect(h.selected.unanchored).toHaveBeenCalledOnce();
  expect(h.store.getState().floating).toMatchObject({ key: "WORD2222" });

  h.selected.moveTo({ x: 40, y: 50 });
  h.host.sync();
  expect(h.popup()?.staticPos).toEqual({ x: 40, y: 50 });
  expect(h.popup()?.hoverEl.textContent).toBe("selected row");
});

it("opens nothing for a quiet selection, and opens for the next one", () => {
  using h = host();

  selectMark(h.store, "WORD2222", { quiet: true });
  h.host.sync();
  expect(h.popup()).toBeNull();

  selectMark(h.store, "WORD2222");
  expect(h.popup()).not.toBeNull();
});

it("moves on a sync without drawing the row again", () => {
  using h = host();
  selectMark(h.store, "WORD2222");
  const renders = h.selected.renders.length;

  h.selected.moveTo({ x: 440, y: 364 });
  h.host.sync();

  expect(h.popup()?.staticPos).toEqual({ x: 440, y: 364 });
  expect(h.selected.renders).toHaveLength(renders);
});

// A node that stays is what keeps an open editor's caret and a press that
// spans the render.
it("keeps the content's nodes through the editor and a draft, and mounts it anew for another mark", () => {
  using h = host();
  selectMark(h.store, "WORD2222");
  const row = h.popup()!.hoverEl.querySelector("span");

  setCommenting(h.store, true);
  expect(h.popup()!.hoverEl.querySelector("span")).toBe(row);

  const renders = h.selected.renders.length;
  ingestCommentDraft(h.store, "WORD2222", {
    annotationKey: "WORD2222",
    attachmentKey: "RGRPDF24",
    serverID: "test",
    baseline: "",
    text: "worth quoting",
    state: { kind: "editing" },
  });
  expect(h.selected.renders).toHaveLength(renders + 1);
  expect(h.popup()!.hoverEl.querySelector("span")).toBe(row);

  selectMark(h.store, "LINE3333");
  expect(h.popup()!.hoverEl.querySelector("span")).not.toBe(row);
});

it("closes the popup once nothing floats, and with its own disposal", () => {
  const h = host();
  selectMark(h.store, "WORD2222");
  selectMark(h.store, null);
  expect(h.popup()).toBeNull();

  selectMark(h.store, "WORD2222");
  h.host[Symbol.dispose]();
  expect(h.popup()).toBeNull();

  // A disposed host hears the state no more.
  selectMark(h.store, "WORD2222", { stack: ["WORD2222"] });
  expect(h.popup()).toBeNull();
});

it("tells the create variant its anchor left the screen, so it can drop its selection", () => {
  using h = host();
  captureSelection(h.store, {
    captured: CAPTURED,
    anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
  });
  expect(h.popup()).not.toBeNull();

  h.create.moveTo(null);
  h.host.sync();

  expect(h.popup()).toBeNull();
  expect(h.create.unanchored).toHaveBeenCalledOnce();
  expect(h.selected.unanchored).not.toHaveBeenCalled();
});
