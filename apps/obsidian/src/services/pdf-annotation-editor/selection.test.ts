// @vitest-environment happy-dom
import { Menu, Scope as MockScope } from "@mock/obsidian";
import type { Scope } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepositoryEvents,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { annotation, pageView } from "./__fixtures__";
import { groupAnnotationsByPage } from "./render";
import type { OverlayPageView } from "./render";
import { MarkSelection } from "./selection";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

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

/** The repository, reduced to what the selection reads and writes through. */
function annotationEdits(capability: EditingCapability = { kind: "writable" }) {
  let commentDraft: {
    annotationKey: string;
    attachmentKey: string;
    serverID: string;
    baseline: string;
    text: string;
    state: { kind: "editing" };
  } | null = null;
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  function on<K extends keyof AnnotationRepositoryEvents>(
    event: K,
    listener: AnnotationRepositoryEvents[K],
  ): () => void {
    const registered = listeners.get(event) ?? new Set();
    const callback = listener as (...args: never[]) => void;
    registered.add(callback);
    listeners.set(event, registered);
    return () => {
      registered.delete(callback);
    };
  }
  return {
    capabilityFor: vi.fn(() => capability),
    mutationFor: vi.fn((): MutationState => IDLE),
    patchColor: vi.fn(async () => IDLE),
    deleteAnnotation: vi.fn(async () => IDLE),
    commentDraftFor: vi.fn(() => commentDraft),
    editComment: vi.fn((annotationKey: string, text = "") => {
      commentDraft = {
        annotationKey,
        attachmentKey: "ABCD2345",
        serverID: "test",
        baseline: "",
        text,
        state: { kind: "editing" },
      };
      return commentDraft;
    }),
    submitComment: vi.fn(async () => IDLE),
    discardCommentDraft: vi.fn(),
    retryCommentDraft: vi.fn(async () => IDLE),
    on: vi.fn(on),
    hideCommentDraft() {
      commentDraft = null;
    },
    emit(event: string, annotationKey: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener(annotationKey as never);
      }
    },
  };
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

  const parent = { hoverPopover: null };
  const annotations = annotationEdits(capability);
  const gestures = {
    revealAnnotation: vi.fn(),
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
  const reported: (readonly string[])[] = [];
  const navigated: string[] = [];
  // The creation surfaces hear the same gestures; this records what reaches
  // them, so a key the selected-mark keymap took can be told from one it left.
  const creation = {
    press: vi.fn(),
    settle: vi.fn(),
    changed: vi.fn(),
    key: vi.fn(),
    sync: vi.fn(),
  };
  let held = records;
  const selection = new MarkSelection({
    containerEl,
    scope: new MockScope() as unknown as Scope,
    parent,
    attachmentKey: "ABCD2345",
    marks: () => groupAnnotationsByPage(held),
    records: () => held,
    pageAt: (pageIndex) =>
      pageIndex === 0 ? (page as unknown as OverlayPageView) : null,
    repaint: vi.fn(),
    navigate: (key) => navigated.push(key),
    report: (keys) => reported.push(keys),
    annotations,
    gestures,
    creation,
    now: () => NOW,
  });
  selection.load();

  return {
    selection,
    containerEl,
    page,
    parent,
    annotations,
    gestures,
    creation,
    reported,
    navigated,
    /** What the last read answered, for a refresh that retires a mark. */
    replace(next: readonly AnnotationRecord[]) {
      held = next;
    },
    /** The open popup, once its zero-length wait has run. */
    popup() {
      vi.advanceTimersByTime(0);
      return parent.hoverPopover as { staticPos: unknown } | null;
    },
    [Symbol.dispose]() {
      selection[Symbol.dispose]();
      containerEl.remove();
    },
  };
}

function press(node: HTMLElement, { x, y }: { x: number; y: number }): void {
  node.dispatchEvent(
    new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }),
  );
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

/** The one key the reader's own listener hears, as Obsidian delivers it. */
function key(node: HTMLElement, name: string, target?: HTMLElement): void {
  (target ?? node).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
    }),
  );
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
  } as Selection);

  click(h.page.div, ON_WORD);

  expect(h.selection.selected.size).toBe(0);
});

it("stands a selected mark down for a live text selection", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
  } as Selection);
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
  h.selection.sync();

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
  h.selection.sync();

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

  key(h.containerEl, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  key(h.containerEl, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["WORD2222"]);
  key(h.containerEl, "ArrowUp");
  expect([...h.selection.selected]).toEqual(["PARA1111"]);
  expect(h.navigated).toEqual(["PARA1111", "WORD2222", "PARA1111"]);
});

it("deselects on Escape", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  key(h.containerEl, "Escape");

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("sets a colour from the number row, and deletes from the delete key", () => {
  using h = setup();
  click(h.page.div, ON_WORD);

  key(h.containerEl, "3");
  expect(h.annotations.patchColor).toHaveBeenCalledWith("WORD2222", "#5fb236");

  key(h.containerEl, "Delete");
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

  key(h.containerEl, "Escape", field);
  key(h.containerEl, "3", field);

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
  const editor = popup.hoverEl.querySelector("textarea");
  expect(editor).not.toBeNull();

  h.annotations.hideCommentDraft();
  h.annotations.emit("comment-draft-hidden", "WORD2222");

  expect(popup.hoverEl.querySelector("textarea")).toBeNull();
  expect(h.annotations.submitComment).not.toHaveBeenCalled();
});

it("keeps a comment editor open when an ordinary draft settles", () => {
  using h = setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='comment']")!.click();

  h.annotations.hideCommentDraft();
  h.annotations.emit("comment-draft-changed", "WORD2222");

  expect(popup.hoverEl.querySelector("textarea")).not.toBeNull();
});

it("says why an edit key cannot run, rather than writing under a block", () => {
  using h = setup([PARAGRAPH, WORD], {
    kind: "read-only",
    reason: "library-read-only",
  });
  click(h.page.div, ON_WORD);

  key(h.containerEl, "3");
  key(h.containerEl, "Delete");

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
