// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { SelectedText } from "@zotlit/pdf-structure";

import { annotation, readerSurface, toolColors } from "./__fixtures__";
import type { Point } from "./hit-test";
import { MarkPopupHost } from "./mark-popup-host";
import { current, update } from "./reader-surface-model";
import {
  captureSelection,
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
  const surface = readerSurface({
    colors: toolColors().current(),
    capability: { kind: "writable" },
    now: NOW,
  });
  update(surface, ingestRecords([WORD, LINE]));
  const parent: HoverParent = { hoverPopover: null };
  const selected = variant("selected row", { x: 220, y: 182 });
  const create = variant("create row", { x: 100, y: 300 });
  let shown = true;
  const popupHost = new MarkPopupHost({
    parent,
    doc: () => document,
    surface,
    shown: () => shown,
    variants: { selected, create },
  });
  return {
    surface,
    selected,
    create,
    host: popupHost,
    /** Another tab covers the PDF view, or uncovers it. */
    cover(covered: boolean) {
      shown = !covered;
    },
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

  update(h.surface, selectMark("WORD2222"));

  expect(h.popup()?.staticPos).toEqual({ x: 220, y: 182 });
  expect(h.popup()?.hoverEl.textContent).toBe("selected row");
});

it("turns the same popup over to a captured selection, with its own row", () => {
  using h = host();
  update(h.surface, selectMark("WORD2222"));
  const opened = h.popup();

  update(
    h.surface,
    captureSelection({
      captured: CAPTURED,
      anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
    }),
  );

  expect(h.popup()).toBe(opened);
  expect(opened?.staticPos).toEqual({ x: 100, y: 300 });
  expect(opened?.hoverEl.textContent).toBe("create row");
});

it("hides while the anchor is off screen, and shows again once it is back", () => {
  using h = host();
  update(h.surface, selectMark("WORD2222"));

  h.selected.moveTo(null);
  h.host.sync();
  expect(h.popup()).toBeNull();
  expect(h.selected.unanchored).toHaveBeenCalledOnce();
  expect(current(h.surface).floating).toMatchObject({ key: "WORD2222" });

  h.selected.moveTo({ x: 40, y: 50 });
  h.host.sync();
  expect(h.popup()?.staticPos).toEqual({ x: 40, y: 50 });
  expect(h.popup()?.hoverEl.textContent).toBe("selected row");
});

// A new tab (Cmd+T) left the popup of a new highlight over it (Lesson 2 of
// the /learn course); a comment typed in the create popup survives the cover.
it("hides while another tab covers the PDF, keeps its content mounted, and shows it again once the PDF is back", () => {
  using h = host();
  update(
    h.surface,
    captureSelection({
      captured: CAPTURED,
      anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
    }),
  );

  const opened = h.popup()!;
  const row = opened.hoverEl.querySelector("span");

  h.cover(true);
  h.host.sync();
  expect(h.popup()).toBe(opened);
  expect(opened.hoverEl.hasAttribute("data-zt-covered")).toBe(true);
  expect(h.create.unanchored).not.toHaveBeenCalled();
  expect(current(h.surface).floating).toMatchObject({ kind: "create" });

  h.cover(false);
  h.host.sync();
  expect(h.popup()).toBe(opened);
  expect(opened.hoverEl.hasAttribute("data-zt-covered")).toBe(false);
  expect(opened.hoverEl.querySelector("span")).toBe(row);
});

it("shows what floats now once the PDF is back, after a change made while another tab covered it", () => {
  using h = host();
  update(
    h.surface,
    captureSelection({
      captured: CAPTURED,
      anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
    }),
  );

  h.cover(true);
  h.host.sync();
  // A write that ends behind the cover selects the new mark.
  update(h.surface, selectMark("WORD2222"));

  h.cover(false);
  h.host.sync();
  expect(h.popup()?.hoverEl.hasAttribute("data-zt-covered")).toBe(false);
  expect(h.popup()?.staticPos).toEqual({ x: 220, y: 182 });
  expect(h.popup()?.hoverEl.textContent).toBe("selected row");
});

it("opens nothing for a quiet selection, and opens for the next one", () => {
  using h = host();

  update(h.surface, selectMark("WORD2222", { quiet: true }));
  h.host.sync();
  expect(h.popup()).toBeNull();

  update(h.surface, selectMark("WORD2222"));
  expect(h.popup()).not.toBeNull();
});

it("moves on a sync without drawing the row again", () => {
  using h = host();
  update(h.surface, selectMark("WORD2222"));
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
  update(h.surface, selectMark("WORD2222"));
  const row = h.popup()!.hoverEl.querySelector("span");

  update(h.surface, setCommenting(true));
  expect(h.popup()!.hoverEl.querySelector("span")).toBe(row);

  const renders = h.selected.renders.length;
  update(
    h.surface,
    ingestCommentDraft("WORD2222", {
      annotationKey: "WORD2222",
      attachmentKey: "RGRPDF24",
      serverID: "test",
      baseline: "",
      text: "worth quoting",
      state: { kind: "editing" },
    }),
  );
  expect(h.selected.renders).toHaveLength(renders + 1);
  expect(h.popup()!.hoverEl.querySelector("span")).toBe(row);

  update(h.surface, selectMark("LINE3333"));
  expect(h.popup()!.hoverEl.querySelector("span")).not.toBe(row);
});

// A comment editor takes its draft as it mounts, which changes the state from
// inside the popup's first render (aidenlx/zotlit#1272).
it("draws a state change its first render makes in the popup it opens", () => {
  using h = host();
  const connected: boolean[] = [];
  h.selected.render = (content) => {
    connected.push(content.isConnected);
    if (connected.length === 1)
      update(
        h.surface,
        ingestCommentDraft("WORD2222", {
          annotationKey: "WORD2222",
          attachmentKey: "RGRPDF24",
          serverID: "test",
          baseline: "",
          text: "worth quoting",
          state: { kind: "editing" },
        }),
      );
    return createElement("span", null, `draw ${connected.length}`);
  };

  update(h.surface, selectMark("WORD2222"));

  expect(connected).toEqual([true, true]);
  expect(document.querySelectorAll(".popover")).toHaveLength(1);
  expect(h.popup()?.hoverEl.textContent).toBe("draw 2");
});

it("closes the popup once nothing floats, and with its own disposal", () => {
  const h = host();
  update(h.surface, selectMark("WORD2222"));
  update(h.surface, selectMark(null));
  expect(h.popup()).toBeNull();

  update(h.surface, selectMark("WORD2222"));
  h.host[Symbol.dispose]();
  expect(h.popup()).toBeNull();

  // A disposed host hears the state no more.
  update(h.surface, selectMark("WORD2222", { stack: ["WORD2222"] }));
  expect(h.popup()).toBeNull();
});

it("tells the create variant its anchor left the screen, so it can drop its selection", () => {
  using h = host();
  update(
    h.surface,
    captureSelection({
      captured: CAPTURED,
      anchorAt: { pageIndex: 0, fx: 0.5, fy: 0.5 },
    }),
  );
  expect(h.popup()).not.toBeNull();

  h.create.moveTo(null);
  h.host.sync();

  expect(h.popup()).toBeNull();
  expect(h.create.unanchored).toHaveBeenCalledOnce();
  expect(h.selected.unanchored).not.toHaveBeenCalled();
});
