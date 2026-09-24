// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Menu } from "@mock/obsidian";
import { Keymap } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RangeAdjustment, SelectedText } from "@zotlit/pdf-structure";

import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import {
  annotation,
  annotationEdits,
  pageView,
  readerSurfaces,
  viewport,
} from "./__fixtures__";
import { setCommenting } from "./reader-surface-state";
import type { OverlayPageView } from "./render";

/**
 * Two marks on page one, the second inside the first, in PDF points. A US
 * Letter page is 792 points tall and PDF space counts up from its foot, so the
 * paragraph draws from y 152 to y 192 down the page and the word inside it from
 * y 162 to y 182 — which is where every client coordinate below comes from,
 * since the seeded page box is the page's own size at its own origin.
 */
const PARAGRAPH = annotation("PARA1111", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});
const WORD = annotation("WORD2222", "highlight", {
  pageIndex: 0,
  rects: [[200, 610, 240, 630]],
});
/** Where a click lands on both of them, and where it lands on neither. */
const ON_WORD = { x: 220, y: 172 };
const ON_PAGE = { x: 220, y: 400 };

/** A seeded client rectangle, as the browser would have measured one. */
function rect({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }) as DOMRect;
}

function setup(
  records: readonly AnnotationRecord[] = [PARAGRAPH, WORD],
  capability: EditingCapability = { kind: "writable" },
) {
  vi.useFakeTimers();
  const containerEl = document.body.appendChild(document.createElement("div"));
  containerEl.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 612,
    height: 500,
  });
  const page = pageView();
  containerEl.append(page.div);
  page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 612,
    height: 792,
  });

  const annotations = annotationEdits();
  const sortIndex = vi.fn(async () => "00000|000012|00517");
  const adjustRange = vi.fn(
    async (_adjustment: RangeAdjustment): Promise<SelectedText | null> => null,
  );
  const reader = readerSurfaces({
    containerEl,
    page: page as unknown as OverlayPageView,
    records,
    capability,
    annotations: { ...annotations, createAnnotation: vi.fn() },
    sortIndex,
    adjustRange,
  });

  return {
    ...reader,
    containerEl,
    page,
    annotations,
    sortIndex,
    adjustRange,
    popup() {
      return reader.parent.hoverPopover as { staticPos: unknown } | null;
    },
    [Symbol.dispose]() {
      reader[Symbol.dispose]();
      containerEl.remove();
    },
  };
}

function press(node: HTMLElement, { x, y }: { x: number; y: number }): void {
  node.dispatchEvent(
    new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }),
  );
}

/** The comment editor the popup holds, or `null` while it holds none. */
function commentView(root: HTMLElement): EditorView | null {
  const dom = root.querySelector<HTMLElement>(".cm-editor");
  return dom && EditorView.findFromDOM(dom);
}

/** One whole gesture: press and release at the same point unless told otherwise. */
function click(
  node: HTMLElement,
  at: { x: number; y: number },
  {
    from = at,
    ...init
  }: { from?: { x: number; y: number } } & MouseEventInit = {},
): void {
  press(node, from);
  node.dispatchEvent(
    new MouseEvent("click", {
      clientX: at.x,
      clientY: at.y,
      bubbles: true,
      ...init,
    }),
  );
}

/** The keyboard the reader surfaces are driven through. */
type Keyboard = Pick<ReturnType<typeof readerSurfaces>, "key">;

/** One key, as Obsidian delivers it to the reader. */
function key(h: Keyboard, name: string, target?: HTMLElement): void {
  h.key({ key: name }, target);
}

/** One key with modifiers held, as Obsidian delivers it to the reader. */
function chord(
  h: Keyboard,
  name: string,
  modifiers: Pick<KeyboardEventInit, "shiftKey" | "altKey" | "metaKey">,
): void {
  h.key({ key: name, ...modifiers });
}

beforeEach(() => {
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: true,
  } as Selection);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("takes the smallest mark under a click, and announces the selection", () => {
  using h = setup();

  click(h.page.div, ON_WORD);

  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  expect(h.reported).toEqual([["WORD2222"]]);
});

it("reads a click against the page inside its border, not the border box", () => {
  using h = setup();
  // The desktop reader draws a border round the page, as wide as the zoom
  // makes it: the content box is the page's own size, inside that border.
  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 652,
    height: 832,
  });
  Object.defineProperties(h.page.div, {
    clientLeft: { value: 20 },
    clientTop: { value: 20 },
  });

  // x 196 on the page: left of the word by more than the hit pad, inside the
  // paragraph.
  click(h.page.div, { x: 216, y: 192 });

  expect([...h.selection.selected]).toEqual(["PARA1111"]);
});

it("opens the popup at the bottom centre of the mark, and keeps one popup", () => {
  using h = setup();

  click(h.page.div, ON_WORD);

  const opened = h.popup();
  expect(opened?.staticPos).toEqual({ x: 220, y: 182 });

  // A second click retargets the popup rather than opening another.
  click(h.page.div, ON_WORD);
  expect(h.popup()).toBe(opened);
  expect(opened?.staticPos).toEqual({ x: 300, y: 192 });
});

it("steps through the stack under one point, and wraps", () => {
  using h = setup();

  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["WORD2222"]);
});

it("steps the stack forward from the popup's own stepper", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='stack']")!.click();

  expect([...h.selection.selected]).toEqual(["PARA1111"]);
});

it("opens the mark's colours under the popup verb that opened them", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const verb = popup.hoverEl.querySelector<HTMLElement>(
    "[data-zt-verb='color']",
  )!;

  verb.click();

  const menu = Menu.instances.at(-1)!;
  expect(menu.parentEl).toBe(verb);
  expect(menu.items).not.toHaveLength(0);
});

it("leaves a drag across a mark to the browser's own text selection", () => {
  using h = setup();

  click(h.page.div, ON_WORD, { from: { x: 200, y: 172 } });

  expect(h.selection.selected.size).toBe(0);
  expect(h.reported).toEqual([]);
});

it("leaves a click that left text selected alone", () => {
  using h = setup();
  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
    anchorNode: h.page.div,
  } as unknown as Selection);

  click(h.page.div, ON_WORD);

  expect(h.selection.selected.size).toBe(0);
});

it("stands a selected mark down for a live text selection", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
    anchorNode: h.page.div,
  } as unknown as Selection);
  document.dispatchEvent(new Event("selectionchange"));

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("gives a plain click to the PDF's own link, and Alt to the mark beneath", () => {
  using h = setup();
  const link = h.page.div.appendChild(document.createElement("a"));
  link.href = "#page=4";

  click(link, ON_WORD);
  expect(h.selection.selected.size).toBe(0);

  click(link, ON_WORD, { altKey: true });
  expect([...h.selection.selected]).toEqual(["WORD2222"]);
});

it("treats a click that reaches no mark as the click-away", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  click(h.page.div, ON_PAGE);

  expect(h.selection.selected.size).toBe(0);
  expect(h.reported).toEqual([["WORD2222"], []]);
  expect(h.popup()).toBeNull();
});

it("keeps the popup open through the press that retargets it", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const opened = h.popup();

  // The press ending in the click that steps the stack lands inside the
  // reader, so it is never read as the press that closes the popup.
  click(h.page.div, ON_WORD);

  expect(h.popup()).toBe(opened);
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
});

it("stands the selection down on a press outside the reader", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  h.popup();

  press(document.body, { x: 5, y: 5 });

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("leaves the selection standing for a press inside the popup", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  press(popup.hoverEl, { x: 220, y: 190 });

  expect([...h.selection.selected]).toEqual(["WORD2222"]);
});

it("re-anchors the popup when the page is rendered again", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const opened = h.popup();

  // What a zoom step leaves behind: the same marks, drawn over a taller page.
  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 1224,
    height: 1584,
  });
  h.sync();

  expect(h.popup()).toBe(opened);
  expect(opened?.staticPos).toEqual({ x: 440, y: 364 });
});

it("hides the popup when the mark scrolls out, and keeps the selection", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  expect(h.popup()).not.toBeNull();

  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: -800,
    width: 612,
    height: 792,
  });
  h.containerEl.dispatchEvent(new Event("scroll"));

  expect(h.popup()).toBeNull();
  expect([...h.selection.selected]).toEqual(["WORD2222"]);

  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 612,
    height: 792,
  });
  h.containerEl.dispatchEvent(new Event("scroll"));

  expect(h.popup()?.staticPos).toEqual({ x: 220, y: 182 });
});

it("drops a selection whose Annotation the last read retired", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  h.replace([PARAGRAPH]);
  h.sync();

  expect(h.selection.selected.size).toBe(0);
  expect(h.reported).toEqual([["WORD2222"], []]);
});

it("takes the selection a card sends through the Reader Session", () => {
  using h = setup();

  h.selection.select("PARA1111");

  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  expect(h.reported).toEqual([["PARA1111"]]);
  expect(h.popup()?.staticPos).toEqual({ x: 300, y: 192 });
});

it("walks reading order with the arrow keys, and brings the reader along", () => {
  using h = setup();

  key(h, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  key(h, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  key(h, "ArrowUp");
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  expect(h.navigated).toEqual(["PARA1111", "WORD2222", "PARA1111"]);
});

it("deselects on Escape", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  key(h, "Escape");

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("steps back from the selected mark on Escape before the armed tool", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  key(h, "u");

  key(h, "Escape");
  expect(h.selection.selected.size).toBe(0);
  expect(h.store.getState().armed).toBe("underline");

  key(h, "Escape");
  expect(h.store.getState().armed).toBeNull();
});

it("sets a colour from the number row, and deletes from the delete key", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  key(h, "3");
  expect(h.annotations.patchColor).toHaveBeenCalledWith("WORD2222", "#5fb236");

  key(h, "Delete");
  expect(h.annotations.deleteAnnotation).toHaveBeenCalledWith("WORD2222");
});

it("leaves a modified colour key to whatever else holds it", () => {
  // `Alt`+`1` is no edit gesture for the block's notice, so it recolours
  // nothing here either: one keystroke, one answer.
  using h = setup();
  click(h.page.div, ON_WORD);

  h.containerEl.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "1",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

  expect(h.annotations.patchColor).not.toHaveBeenCalled();
});

it("leaves every key to a text field it was typed into", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const field = h.containerEl.appendChild(document.createElement("input"));

  key(h, "Escape", field);
  key(h, "3", field);

  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  expect(h.annotations.patchColor).not.toHaveBeenCalled();
});

it("hands the reveal verb to the Annotation Card", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='reveal']")!.click();

  expect(h.gestures.revealAnnotation).toHaveBeenCalledWith("WORD2222", {
    comment: false,
  });
});

it("deletes from the popup's own verb", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='delete']")!.click();

  expect(h.annotations.deleteAnnotation).toHaveBeenCalledWith("WORD2222");
});

it("closes a comment editor when a database switch hides its draft", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='comment']")!.click();
  expect(commentView(popup.hoverEl)).not.toBeNull();

  h.annotations.hideCommentDraft();
  h.annotations.emit("comment-draft-hidden", "WORD2222");

  expect(commentView(popup.hoverEl)).toBeNull();
  expect(h.annotations.submitComment).not.toHaveBeenCalled();
});

it("keeps a comment editor open when an ordinary draft settles", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='comment']")!.click();

  h.annotations.hideCommentDraft();
  h.annotations.emit("comment-draft-changed", "WORD2222");

  expect(commentView(popup.hoverEl)).not.toBeNull();
});

it("says why an edit key cannot run, rather than writing under a block", () => {
  using h = setup([PARAGRAPH, WORD], {
    kind: "read-only",
    reason: "library-read-only",
  });
  click(h.page.div, ON_WORD);

  key(h, "3");
  key(h, "Delete");

  expect(h.annotations.patchColor).not.toHaveBeenCalled();
  expect(h.annotations.deleteAnnotation).not.toHaveBeenCalled();
  expect(h.gestures.reportBlockedGesture).toHaveBeenCalledTimes(1);
});

it("leaves nothing behind once the binding disposes it", () => {
  const h = setup();
  click(h.page.div, ON_WORD);
  expect(h.popup()).not.toBeNull();

  h.selection[Symbol.dispose]();

  expect(h.parent.hoverPopover).toBeNull();
  click(h.page.div, ON_WORD);
  expect(h.reported).toEqual([["WORD2222"]]);
  h.containerEl.remove();
});

it("stands the selection down at once when its Annotation is deleted", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  expect(h.popup()).not.toBeNull();

  h.annotations.emit("annotation-deleted", "WORD2222");

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
  expect(h.reported).toEqual([["WORD2222"], []]);
});

it("takes a draft typed in the Annotation View into the open editor, keeping the caret", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='comment']")!.click();
  const editor = commentView(popup.hoverEl)!;
  editor.dispatch({
    changes: { from: 0, insert: "worth" },
    selection: { anchor: 2 },
  });

  h.annotations.editComment("WORD2222", "worth quoting");
  h.annotations.emit("comment-draft-changed", "WORD2222");

  expect(commentView(popup.hoverEl)).toBe(editor);
  expect(editor.state.doc.toString()).toBe("worth quoting");
  expect(editor.state.selection.main.head).toBe(2);
});

it("keeps the row's nodes through a mutation announced again unchanged", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const del = () =>
    popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='delete']");
  const drawn = del();

  h.annotations.emit("mutation-changed", "WORD2222");
  expect(del()).toBe(drawn);

  h.annotations.mutationFor.mockReturnValue({ kind: "pending" });
  h.annotations.emit("mutation-changed", "WORD2222");
  expect(del()?.getAttribute("aria-disabled")).toBe("true");
});

it("selects a landed mark without a popup, and opens one for the next selection", () => {
  using h = setup();

  h.selection.select("WORD2222", { popup: false });
  h.sync();

  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  expect(h.reported).toEqual([["WORD2222"]]);
  expect(h.popup()).toBeNull();

  h.selection.select("PARA1111");
  expect(h.popup()?.staticPos).toEqual({ x: 300, y: 192 });
});

it("falls back to the row, and closes the editor, when no draft can be started", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  h.annotations.editComment.mockReturnValue(null as never);

  setCommenting(h.store, true);

  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  expect(commentView(popup.hoverEl)).toBeNull();
  expect(
    popup.hoverEl.querySelector("[data-zt-verb='comment']"),
  ).not.toBeNull();
  expect(h.store.getState().floating).toMatchObject({ commenting: false });
});

/**
 * An image region on page one, in PDF points: it draws from x 100 to 300 and,
 * 792 points down a page counted from its foot, from y 292 to 492 — so its
 * bottom-right Mark Handle sits at the client point (300, 492).
 */
const FIGURE = annotation("FIGR3333", "image", {
  pageIndex: 0,
  rects: [[100, 300, 300, 500]],
});
const ON_FIGURE = { x: 200, y: 392 };
const BOTTOM_RIGHT = { x: 300, y: 492 };

function pointer(
  node: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  { x, y }: { x: number; y: number },
): void {
  node.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The figure selected by a click on its body, as a researcher selects it. */
function figureSelected(capability?: EditingCapability) {
  const h = setup([FIGURE], capability);
  click(h.page.div, ON_FIGURE);
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
  return h;
}

it("saves a handle drag on release, with the Sort Index of the new position", async () => {
  using h = figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 320, y: 500 });
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  // Nothing is written while the pointer moves.
  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await h.selection.adjusted;

  // Forty points right and twenty-five down the page, which is twenty-five
  // points toward the foot in PDF space.
  const position = {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 275, 340, 500]],
  };
  expect(h.sortIndex).toHaveBeenCalledWith(position);
  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("FIGR3333", {
    position,
    sortIndex: "00000|000012|00517",
  });
  // The adjustment ends once the write settled, and the mark stays selected.
  expect(h.store.getState().floating).toEqual(
    expect.not.objectContaining({ adjust: expect.anything() }),
  );
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("moves the selected image by its body", async () => {
  using h = figureSelected();

  pointer(h.page.div, "pointerdown", ON_FIGURE);
  pointer(h.containerEl, "pointermove", { x: 230, y: 382 });
  pointer(h.containerEl, "pointerup", { x: 230, y: 382 });
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("FIGR3333", {
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[130, 310, 330, 510]],
    },
    sortIndex: "00000|000012|00517",
  });
});

it("moves the selected ink by its body, from anywhere in its padded stroke box", async () => {
  // One stroke from (100, 300) to (200, 400) in PDF points: client (100, 492)
  // to (200, 392), its box padded five points out on every side.
  const stroke = annotation("INK44444", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[100, 300, 200, 400]],
  });
  using h = setup([stroke]);
  click(h.page.div, { x: 150, y: 442 });
  expect([...h.selection.selected]).toEqual(["INK44444"]);

  // Four points below the stroke's foot, inside the padding and clear of
  // every corner handle.
  pointer(h.page.div, "pointerdown", { x: 150, y: 496 });
  pointer(h.containerEl, "pointermove", { x: 180, y: 476 });
  pointer(h.containerEl, "pointerup", { x: 180, y: 476 });
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("INK44444", {
    position: {
      kind: "pdf-ink",
      pageIndex: 0,
      width: 2,
      paths: [[130, 320, 230, 420]],
    },
    sortIndex: "00000|000012|00517",
  });
});

it("writes nothing for a release that did not move, and keeps the selection", async () => {
  using h = figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  expect(h.popup()).toBeNull();
  pointer(h.containerEl, "pointerup", BOTTOM_RIGHT);
  h.page.div.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 492, bubbles: true }),
  );
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
  // The popup the press hid hangs again from the mark.
  expect(h.popup()).not.toBeNull();
});

it("cancels a drag on Escape, writes nothing, and keeps the mark selected", async () => {
  using h = figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  key(h, "Escape");
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  expect(h.store.getState().floating).toMatchObject({ key: "FIGR3333" });
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
});

it("hides the Mark Popup during a drag and hangs it again on release", async () => {
  using h = figureSelected();
  expect(h.popup()).not.toBeNull();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  expect(h.popup()).toBeNull();
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  expect(h.popup()).toBeNull();

  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  expect(h.popup()).not.toBeNull();
  await h.selection.adjusted;
});

it("takes a press on a handle as an ordinary click while editing is not live", async () => {
  using h = figureSelected({ kind: "read-only", reason: "library-read-only" });

  pointer(h.page.div, "pointerdown", { x: 299, y: 491 });
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await h.selection.adjusted;

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
});

it("snaps a refused write back to the confirmed geometry", async () => {
  using h = figureSelected();
  h.annotations.patchGeometry.mockResolvedValue({
    kind: "failed",
    failure: { kind: "position-too-large" },
  });

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  expect(h.store.getState().floating).toMatchObject({
    adjust: { phase: "saving" },
  });
  await h.selection.adjusted;

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
});

it("takes a press on a handle where it is drawn on a page turned a quarter turn", async () => {
  // A quarter turn lays PDF (x, y) at page units (y, x) on a page 792 wide
  // and 612 high, which the seeded box draws one unit to the pixel: the
  // figure spans x 300–500 and y 100–300, and its bottom-right corner, PDF
  // (300, 300), stands at (300, 300), where render.test.ts sees it drawn.
  using h = setup([FIGURE]);
  h.page.viewport = viewport({ rotation: 90, scale: 1.5 });
  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 792,
    height: 612,
  });
  click(h.page.div, { x: 400, y: 200 });
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);

  pointer(h.page.div, "pointerdown", { x: 300, y: 300 });
  pointer(h.containerEl, "pointermove", { x: 310, y: 320 });
  pointer(h.containerEl, "pointerup", { x: 310, y: 320 });
  await h.selection.adjusted;

  // Ten units right is ten points up PDF's y, and twenty down is twenty
  // points along its x: the corner moves to (320, 310).
  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("FIGR3333", {
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[100, 310, 320, 500]],
    },
    sortIndex: "00000|000012|00517",
  });
});

it("leaves a drag beside the selected image to the text selection", async () => {
  using h = figureSelected();

  pointer(h.page.div, "pointerdown", { x: 400, y: 392 });
  pointer(h.containerEl, "pointermove", { x: 450, y: 392 });
  pointer(h.containerEl, "pointerup", { x: 450, y: 392 });
  await h.selection.adjusted;

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
});

/**
 * A highlight on page one from x 100 to 200 and, counted from the page foot,
 * y 300 to 312 — client y 480 to 492 — so its end strip stands on x 200.
 */
const QUOTE = annotation("QUOT5555", "highlight", {
  pageIndex: 0,
  rects: [[100, 300, 200, 312]],
});
const ON_QUOTE = { x: 150, y: 486 };
const QUOTE_END = { x: 201, y: 486 };

/** The quote selected by a click on it, as a researcher selects it. */
function quoteSelected() {
  const h = setup([QUOTE]);
  click(h.page.div, ON_QUOTE);
  expect([...h.selection.selected]).toEqual(["QUOT5555"]);
  return h;
}

it("saves a range's end dragged along the text, with its quoted text", async () => {
  using h = quoteSelected();
  h.adjustRange.mockResolvedValue({
    pageIndex: 0,
    rects: [[100, 300, 260, 312]],
    text: "the quote, one word longer",
  });

  pointer(h.page.div, "pointerdown", QUOTE_END);
  pointer(h.containerEl, "pointermove", { x: 260, y: 486 });
  // Released before the document answered: the save waits for the answer.
  pointer(h.containerEl, "pointerup", { x: 260, y: 486 });
  await h.selection.adjusted;

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "end",
    point: { pageIndex: 0, x: 260, y: 306 },
  });
  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("QUOT5555", {
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[100, 300, 260, 312]],
    },
    sortIndex: "00000|000012|00517",
    text: "the quote, one word longer",
  });
});

it("drops a range the document answers after Escape took its drag back", async () => {
  using h = quoteSelected();
  let answer!: (selected: SelectedText) => void;
  h.adjustRange.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );

  pointer(h.page.div, "pointerdown", QUOTE_END);
  pointer(h.containerEl, "pointermove", { x: 260, y: 486 });
  key(h, "Escape");
  // A fresh press on the same strip, before the first drag's answer lands.
  pointer(h.page.div, "pointerdown", QUOTE_END);
  answer({
    pageIndex: 0,
    rects: [[100, 300, 260, 312]],
    text: "the quote, one word longer",
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(h.store.getState().floating).toMatchObject({
    adjust: { phase: "pressed", proposal: QUOTE.position },
  });
});

it("hides the Mark Popup at the press on a range's end, before the document answers", async () => {
  using h = quoteSelected();
  expect(h.popup()).not.toBeNull();

  pointer(h.page.div, "pointerdown", QUOTE_END);
  expect(h.popup()).toBeNull();

  pointer(h.containerEl, "pointerup", QUOTE_END);
  await h.selection.adjusted;
  expect(h.popup()).not.toBeNull();
});

it("leaves a press inside the selected highlight to the text selection", async () => {
  using h = quoteSelected();

  pointer(h.page.div, "pointerdown", ON_QUOTE);
  pointer(h.containerEl, "pointermove", { x: 180, y: 486 });
  pointer(h.containerEl, "pointerup", { x: 180, y: 486 });
  await h.selection.adjusted;

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.adjustRange).not.toHaveBeenCalled();
});

it("commits one Geometry Edit for Shift+ArrowRight on the selected image, with a recomputed Sort Index", async () => {
  using h = figureSelected();

  chord(h, "ArrowRight", { shiftKey: true });
  await h.selection.adjusted;

  // Five points wider, on its right edge.
  const position = {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 300, 305, 500]],
  };
  expect(h.sortIndex).toHaveBeenCalledWith(position);
  expect(h.annotations.patchGeometry).toHaveBeenCalledTimes(1);
  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("FIGR3333", {
    position,
    sortIndex: "00000|000012|00517",
  });
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("nudges the selected image five points down the page for Alt+ArrowDown", async () => {
  using h = figureSelected();

  chord(h, "ArrowDown", { altKey: true });
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("FIGR3333", {
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[100, 295, 300, 495]],
    },
    sortIndex: "00000|000012|00517",
  });
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("keeps walking the reading order with a plain arrow while an image is selected", async () => {
  using h = setup([FIGURE, WORD]);
  click(h.page.div, ON_FIGURE);

  key(h, "ArrowUp");
  key(h, "ArrowRight");
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  expect([...h.selection.selected]).not.toEqual(["FIGR3333"]);
});

it("writes nothing for a Geometry Edit key while editing is not live", async () => {
  using h = figureSelected({ kind: "read-only", reason: "library-read-only" });

  chord(h, "ArrowRight", { shiftKey: true });
  chord(h, "ArrowDown", { shiftKey: true });
  chord(h, "ArrowDown", { altKey: true });
  await h.selection.adjusted;

  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("steps a highlight's start for Mod+Shift+ArrowLeft, saving its quoted text", async () => {
  vi.spyOn(Keymap, "isModifier").mockImplementation(
    (event, modifier) => modifier === "Mod" && event.metaKey,
  );
  using h = quoteSelected();
  h.adjustRange.mockResolvedValue({
    pageIndex: 0,
    rects: [[95, 300, 200, 312]],
    text: "a quote",
  });

  chord(h, "ArrowLeft", { shiftKey: true, metaKey: true });
  await h.selection.adjusted;

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "start",
    step: "left",
  });
  expect(h.annotations.patchGeometry).toHaveBeenCalledWith("QUOT5555", {
    position: {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[95, 300, 200, 312]],
    },
    sortIndex: "00000|000012|00517",
    text: "a quote",
  });
});

it("steps a highlight's end for Shift+ArrowDown, and writes nothing for a step the document refuses", async () => {
  using h = quoteSelected();

  chord(h, "ArrowDown", { shiftKey: true });
  await h.selection.adjusted;

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "end",
    step: "down",
  });
  expect(h.annotations.patchGeometry).not.toHaveBeenCalled();
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["QUOT5555"]);
});
