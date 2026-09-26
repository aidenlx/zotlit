// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Menu } from "@mock/obsidian";
import { Keymap } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RangeAdjustment, SelectedText } from "@zotlit/pdf-structure";

import { AbortError } from "@/lib/abort-error";
import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import * as confirmation from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import {
  libraryReadOnly,
  staleVersionPatch,
} from "@/services/zotero-local-api/__fixtures__";

import {
  annotation,
  pageView,
  READER_NOW,
  readerOverZotero,
  viewport,
} from "./__fixtures__";
import type { readerSurfaces } from "./__fixtures__";
import {
  ingestCapability,
  selectMarkHandles,
  setCommenting,
} from "./reader-surface-state";
import type { OverlayPageView } from "./render";

/** Every notice the reader shows, by its text. */
const notices = vi.hoisted(() => ({ shown: [] as string[] }));
vi.mock("@/lib/notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notice")>();
  return {
    ...actual,
    BaseNotice: class extends actual.BaseNotice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        if (typeof message === "string") notices.shown.push(message);
      }
    },
  };
});

/**
 * Two marks on page one, the second inside the first, in PDF points. A US
 * Letter page is 792 points tall and PDF space counts up from its foot, so the
 * paragraph draws from y 152 to y 192 down the page and the word inside it from
 * y 162 to y 182 — which is where every client coordinate below comes from,
 * since the seeded page box is the page's own size at its own origin.
 */
const PARAGRAPH = annotation("PARA7777", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});
const WORD = annotation("WRDS2222", "highlight", {
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

async function setup(
  records: readonly AnnotationRecord[] = [PARAGRAPH, WORD],
  capability: EditingCapability = { kind: "writable" },
  { external }: { external?: readonly string[] } = {},
) {
  vi.useFakeTimers();
  const stack = new AsyncDisposableStack();
  const containerEl = document.body.appendChild(document.createElement("div"));
  stack.defer(() => containerEl.remove());
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

  const sortIndex = vi.fn(async () => "00000|000012|00517");
  const adjustRange = vi.fn(
    async (_adjustment: RangeAdjustment): Promise<SelectedText | null> => null,
  );
  const reader = await readerOverZotero(stack, {
    containerEl,
    page: page as unknown as OverlayPageView,
    records,
    capability,
    sortIndex,
    adjustRange,
    external,
  });

  return {
    ...reader,
    containerEl,
    page,
    sortIndex,
    adjustRange,
    popup() {
      return reader.parent.hoverPopover as { staticPos: unknown } | null;
    },
    /** Every write Zotero was sent, in order: its method, key and body. */
    writes() {
      return reader.requests
        .filter(({ method }) => method !== "GET")
        .map(({ method, url, body }) => ({
          method,
          key: url.pathname.split("/").at(-1),
          body: body === null ? null : (JSON.parse(body) as unknown),
        }));
    },
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
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

type Harness = Awaited<ReturnType<typeof setup>>;

/**
 * Waits until no write stands pending on one Annotation. The reader asks for
 * a write in the gesture's own task, and the write is pending from then until
 * it settles, so once none is, every write the gesture sent has reached
 * Zotero: a write missing after it was never sent.
 */
async function settled(h: Harness, annotationKey: string): Promise<void> {
  await vi.waitFor(() =>
    expect(h.repository.mutationFor(annotationKey).kind).not.toBe("pending"),
  );
}

/**
 * Waits for the list the reader's re-read answers. An announcement draws the
 * list the repository holds at once, and the read it starts draws another
 * after it, so call this right after the announcement.
 */
async function reread(h: Harness): Promise<void> {
  const drawn = h.store.getState().records;
  await vi.waitFor(() => expect(h.store.getState().records).not.toBe(drawn));
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

it("takes the smallest mark under a click, and announces the selection", async () => {
  await using h = await setup();

  click(h.page.div, ON_WORD);

  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  expect(h.reported).toEqual([["WRDS2222"]]);
});

it("reads a click against the page inside its border, not the border box", async () => {
  await using h = await setup();
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

  expect([...h.selection.selected]).toEqual(["PARA7777"]);
});

it("opens the popup at the bottom centre of the mark, and keeps one popup", async () => {
  await using h = await setup();

  click(h.page.div, ON_WORD);

  const opened = h.popup();
  expect(opened?.staticPos).toEqual({ x: 220, y: 182 });

  // A second click retargets the popup rather than opening another.
  click(h.page.div, ON_WORD);
  expect(h.popup()).toBe(opened);
  expect(opened?.staticPos).toEqual({ x: 300, y: 192 });
});

it("steps through the stack under one point, and wraps", async () => {
  await using h = await setup();

  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["PARA7777"]);
  click(h.page.div, ON_WORD);
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
});

it("steps the stack forward from the popup's own stepper", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='stack']")!.click();

  expect([...h.selection.selected]).toEqual(["PARA7777"]);
});

it("opens the mark's colours under the popup verb that opened them", async () => {
  await using h = await setup();
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

it("leaves a drag across a mark to the browser's own text selection", async () => {
  await using h = await setup();

  click(h.page.div, ON_WORD, { from: { x: 200, y: 172 } });

  expect(h.selection.selected.size).toBe(0);
  expect(h.reported).toEqual([]);
});

it("leaves a click that left text selected alone", async () => {
  await using h = await setup();
  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
    anchorNode: h.page.div,
  } as unknown as Selection);

  click(h.page.div, ON_WORD);

  expect(h.selection.selected.size).toBe(0);
});

it("stands a selected mark down for a live text selection", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);

  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
    anchorNode: h.page.div,
  } as unknown as Selection);
  document.dispatchEvent(new Event("selectionchange"));

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("gives a plain click to the PDF's own link, and Alt to the mark beneath", async () => {
  await using h = await setup();
  const link = h.page.div.appendChild(document.createElement("a"));
  link.href = "#page=4";

  click(link, ON_WORD);
  expect(h.selection.selected.size).toBe(0);

  click(link, ON_WORD, { altKey: true });
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
});

it("treats a click that reaches no mark as the click-away", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);

  click(h.page.div, ON_PAGE);

  expect(h.selection.selected.size).toBe(0);
  expect(h.reported).toEqual([["WRDS2222"], []]);
  expect(h.popup()).toBeNull();
});

it("keeps the popup open through the press that retargets it", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const opened = h.popup();

  // The press ending in the click that steps the stack lands inside the
  // reader, so it is never read as the press that closes the popup.
  click(h.page.div, ON_WORD);

  expect(h.popup()).toBe(opened);
  expect([...h.selection.selected]).toEqual(["PARA7777"]);
});

it("stands the selection down on a press outside the reader", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  h.popup();

  press(document.body, { x: 5, y: 5 });

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("leaves the selection standing for a press on a surface that drives it", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const opened = h.popup();
  const list = document.body.appendChild(document.createElement("div"));
  const card = list.appendChild(document.createElement("div"));
  const release = h.session.addSelectionSurface(list);

  // The card's own click, after this press, says what becomes selected.
  press(card, { x: 700, y: 50 });

  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  expect(h.popup()).toBe(opened);

  release();
  press(card, { x: 700, y: 50 });

  expect(h.selection.selected.size).toBe(0);
  list.remove();
});

it("leaves the selection standing for a press inside the popup", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  press(popup.hoverEl, { x: 220, y: 190 });

  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
});

it("re-anchors the popup when the page is rendered again", async () => {
  await using h = await setup();
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

it("hides the popup when the mark scrolls out, and keeps the selection", async () => {
  await using h = await setup();
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
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);

  h.page.div.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 612,
    height: 792,
  });
  h.containerEl.dispatchEvent(new Event("scroll"));

  expect(h.popup()?.staticPos).toEqual({ x: 220, y: 182 });
});

it("drops a selection whose Annotation the last read retired", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);

  h.zotero.eraseInZotero("WRDS2222");
  await h.repository.refresh("RGRPDF24");

  await vi.waitFor(() => expect(h.selection.selected.size).toBe(0));
  expect(h.reported).toEqual([["WRDS2222"], []]);
});

it("takes the selection a card sends through the Reader Session", async () => {
  await using h = await setup();

  h.selection.select("PARA7777");

  expect([...h.selection.selected]).toEqual(["PARA7777"]);
  expect(h.reported).toEqual([["PARA7777"]]);
  expect(h.popup()?.staticPos).toEqual({ x: 300, y: 192 });
});

it("takes a group the Card Selection sends with no popup, and Escape clears it", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  expect(h.popup()).not.toBeNull();

  h.selection.selectMarks(["PARA7777", "WRDS2222"]);
  expect([...h.selection.selected]).toEqual(["PARA7777", "WRDS2222"]);
  expect(h.reported.at(-1)).toEqual(["PARA7777", "WRDS2222"]);
  expect(h.popup()).toBeNull();

  key(h, "Escape");
  expect(h.selection.selected.size).toBe(0);
  expect(h.reported.at(-1)).toEqual([]);
});

it("recolours every mark of a group for a colour key, in one gesture", async () => {
  await using h = await setup();
  h.selection.selectMarks(["PARA7777", "WRDS2222"]);

  key(h, "3");

  const color = ANNOTATION_COLORS[2]!.toLowerCase();
  await vi.waitFor(() => expect(h.zotero.at("PARA7777")?.color).toBe(color));
  await vi.waitFor(() => expect(h.zotero.at("WRDS2222")?.color).toBe(color));
  expect(h.writes().map(({ method, key }) => ({ method, key }))).toEqual([
    { method: "PATCH", key: "PARA7777" },
    { method: "PATCH", key: "WRDS2222" },
  ]);
});

it("copies the text of every selected mark for Ctrl+C, by the Annotation View's rule", async () => {
  await using h = await setup([
    { ...PARAGRAPH, text: "Scientific visualization" },
    { ...WORD, comment: "Check <b>this</b>" },
  ]);
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  h.selection.selectMarks(["PARA7777", "WRDS2222"]);

  const event = h.key({ key: "c", ctrlKey: true });

  expect(event.defaultPrevented).toBe(true);
  expect(write).toHaveBeenCalledExactlyOnceWith(
    "Scientific visualization\n\nCheck this",
  );
});

it("leaves Ctrl+C to a text selection in the PDF", async () => {
  await using h = await setup([
    { ...PARAGRAPH, text: "Scientific visualization" },
  ]);
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  h.selection.selectMarks(["PARA7777"]);
  vi.mocked(window.getSelection).mockReturnValue({
    isCollapsed: false,
    anchorNode: h.page.div,
  } as unknown as Selection);

  const event = h.key({ key: "c", ctrlKey: true });

  expect(event.defaultPrevented).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("deletes every mark of a group for Delete, after one confirmation that counts them", async () => {
  await using h = await setup();
  using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
  h.selection.selectMarks(["PARA7777", "WRDS2222"]);

  key(h, "Delete");

  await vi.waitFor(() => expect(h.zotero.at("PARA7777")).toBeNull());
  await vi.waitFor(() => expect(h.zotero.at("WRDS2222")).toBeNull());
  expect(h.writes()).toEqual([
    { method: "DELETE", key: "PARA7777", body: null },
    { method: "DELETE", key: "WRDS2222", body: null },
  ]);
  expect(ask).toHaveBeenCalledOnce();
  expect(ask.mock.calls[0]?.[0].title).toBe(
    m.annot_view_delete_group_confirm_title({ count: 2 }),
  );
});

it("keeps the marks of a group the last read still holds", async () => {
  await using h = await setup();
  h.selection.selectMarks(["PARA7777", "WRDS2222"]);

  h.zotero.eraseInZotero("WRDS2222");
  await h.repository.refresh("RGRPDF24");

  await vi.waitFor(() =>
    expect([...h.selection.selected]).toEqual(["PARA7777"]),
  );
  expect(h.reported.at(-1)).toEqual(["PARA7777"]);
  // One mark left is a quiet selection: no popup opens over it.
  expect(h.popup()).toBeNull();
});

it("reduces a group to one mark with the arrow keys", async () => {
  await using h = await setup();
  h.selection.selectMarks(["WRDS2222", "PARA7777"]);

  // The walk starts from the group's first mark in reading order.
  key(h, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  expect(h.navigated).toEqual(["WRDS2222"]);
});

it("walks reading order with the arrow keys, and brings the reader along", async () => {
  await using h = await setup();

  key(h, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["PARA7777"]);
  key(h, "ArrowDown");
  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  key(h, "ArrowUp");
  expect([...h.selection.selected]).toEqual(["PARA7777"]);
  expect(h.navigated).toEqual(["PARA7777", "WRDS2222", "PARA7777"]);
});

it("deselects on Escape", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);

  key(h, "Escape");

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
});

it("steps back from the selected mark on Escape before the armed tool", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  key(h, "u");

  key(h, "Escape");
  expect(h.selection.selected.size).toBe(0);
  expect(h.store.getState().armed).toBe("underline");

  key(h, "Escape");
  expect(h.store.getState().armed).toBeNull();
});

it("sets a colour from the number row, and deletes from the delete key", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);

  key(h, "3");
  await vi.waitFor(() =>
    expect(h.zotero.at("WRDS2222")?.color).toBe("#5fb236"),
  );

  key(h, "Delete");
  await vi.waitFor(() => expect(h.zotero.at("WRDS2222")).toBeNull());
});

it("leaves a modified colour key to whatever else holds it", async () => {
  // `Alt`+`1` is no edit gesture for the block's notice, so it recolours
  // nothing here either: one keystroke, one answer.
  await using h = await setup();
  click(h.page.div, ON_WORD);

  h.containerEl.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "1",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settled(h, "WRDS2222");

  expect(h.writes()).toEqual([]);
});

it("leaves every key to a text field it was typed into", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const field = h.containerEl.appendChild(document.createElement("input"));

  key(h, "Escape", field);
  key(h, "3", field);
  await settled(h, "WRDS2222");

  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  expect(h.writes()).toEqual([]);
});

it("hands the reveal verb to the Annotation Card", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='reveal']")!.click();

  expect(h.gestures.revealAnnotation).toHaveBeenCalledWith("WRDS2222");
});

it("deletes from the popup's own verb", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='delete']")!.click();

  await vi.waitFor(() => expect(h.zotero.at("WRDS2222")).toBeNull());
});

it("closes a comment editor when a database switch hides its draft", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  commentField(popup.hoverEl)!.click();
  expect(commentView(popup.hoverEl)).not.toBeNull();

  await h.switchDatabase();

  expect(commentView(popup.hoverEl)).toBeNull();
  await settled(h, "WRDS2222");
  expect(h.writes()).toEqual([]);
});

it("keeps a comment editor open when an ordinary draft settles", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  commentField(popup.hoverEl)!.click();
  const editor = commentView(popup.hoverEl)!;
  editor.dispatch({
    changes: { from: 0, insert: "worth quoting" },
    userEvent: "input.type",
  });

  // The autosave comes due, and the draft goes once Zotero holds its text.
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.waitFor(() =>
    expect(h.zotero.at("WRDS2222")?.comment).toBe("worth quoting"),
  );
  await vi.waitFor(() =>
    expect(h.store.getState().commentDrafts.has("WRDS2222")).toBe(false),
  );

  expect(commentView(popup.hoverEl)).toBe(editor);
});

it("says why an edit key cannot run, rather than writing under a block", async () => {
  await using h = await setup([PARAGRAPH, WORD], {
    kind: "read-only",
    reason: "library-read-only",
  });
  click(h.page.div, ON_WORD);

  key(h, "3");
  key(h, "Delete");
  await settled(h, "WRDS2222");

  expect(h.writes()).toEqual([]);
  expect(h.gestures.reportBlockedGesture).toHaveBeenCalledTimes(1);
});

it("leaves nothing behind once the binding disposes it", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  expect(h.popup()).not.toBeNull();

  h.selection[Symbol.dispose]();

  expect(h.parent.hoverPopover).toBeNull();
  click(h.page.div, ON_WORD);
  expect(h.reported).toEqual([["WRDS2222"]]);
});

it("stands the selection down at once when its Annotation is deleted", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  // A comment draft stands on the mark, so the repository announces the
  // deletion itself.
  commentField(popup.hoverEl)!.click();
  expect(h.store.getState().commentDrafts.has("WRDS2222")).toBe(true);

  h.zotero.eraseInZotero("WRDS2222");
  await h.repository.refresh("RGRPDF24");

  expect(h.selection.selected.size).toBe(0);
  expect(h.popup()).toBeNull();
  expect(h.reported).toEqual([["WRDS2222"], []]);
});

it("takes a draft typed in the Annotation View into the open editor, keeping the caret", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  commentField(popup.hoverEl)!.click();
  const editor = commentView(popup.hoverEl)!;
  editor.dispatch({
    changes: { from: 0, insert: "worth" },
    selection: { anchor: 2 },
  });

  h.repository.editTextField("comment", "WRDS2222", "worth quoting");

  expect(commentView(popup.hoverEl)).toBe(editor);
  expect(editor.state.doc.toString()).toBe("worth quoting");
  expect(editor.state.selection.main.head).toBe(2);
});

it("keeps the row's nodes through a write on another mark", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const del = () =>
    popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='delete']");
  const drawn = del();
  const release = h.zotero.holdWrites();

  // A write on the other mark is announced, and leaves this row as it was.
  const recolouring = h.repository.patchColor("PARA7777", "#5fb236");
  await reread(h);
  expect(h.store.getState().mutations.get("PARA7777")?.kind).toBe("pending");
  expect(del()).toBe(drawn);

  // This mark's own write stands its delete verb down.
  key(h, "3");
  await vi.waitFor(() =>
    expect(del()?.getAttribute("aria-disabled")).toBe("true"),
  );

  release();
  await recolouring;
  await settled(h, "WRDS2222");
});

it("keeps the row as it stands while a comment write is in flight", async () => {
  // A mark that holds a comment already, so the comment the write proposes
  // is drawn under the same verbs.
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const verbs = () =>
    [...popup.hoverEl.querySelectorAll<HTMLElement>("[data-zt-verb]")].map(
      (el) => [
        el,
        el.getAttribute("aria-label"),
        el.getAttribute("aria-disabled"),
      ],
    );
  h.repository.editTextField("comment", "WRDS2222", "<p>worth citing</p>");
  const drawn = verbs();
  const release = h.zotero.holdWrites();

  const saving = h.repository.submitTextField("comment", "WRDS2222");
  await reread(h);
  expect(h.store.getState().mutations.get("WRDS2222")).toEqual({
    kind: "pending",
    write: "comment",
  });

  expect(verbs()).toEqual(drawn);
  release();
  await saving;
});

// A browser clicks the node that took both the press and the release, so a
// verb redrawn between the two would lose the click.
it("keeps a pressed verb under the pointer through a write on its mark", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const reveal = () =>
    popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='reveal']");
  const pressed = reveal();
  const release = h.zotero.holdWrites();

  const recolouring = h.repository.patchColor("WRDS2222", "#5fb236");
  await reread(h);
  expect(h.store.getState().mutations.get("WRDS2222")?.kind).toBe("pending");

  expect(reveal()).toBe(pressed);
  release();
  await recolouring;
});

it("keeps the keyboard on a verb through a write on its mark", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const reveal = () =>
    popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='reveal']");
  reveal()!.focus();
  const release = h.zotero.holdWrites();

  const recolouring = h.repository.patchColor("WRDS2222", "#5fb236");
  await reread(h);

  expect(popup.hoverEl.ownerDocument.activeElement).toBe(reveal());
  release();
  await recolouring;
});

// Obsidian drops a menu whose trigger leaves the document.
it("keeps the colour menu's trigger in the popup through a write on its mark", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='color']")!.click();
  const menu = Menu.instances.at(-1)!;
  const release = h.zotero.holdWrites();

  const recolouring = h.repository.patchColor("WRDS2222", "#5fb236");
  await reread(h);

  expect(menu.parentEl?.isConnected).toBe(true);
  expect(menu.parentEl).toBe(
    popup.hoverEl.querySelector("[data-zt-verb='color']"),
  );
  release();
  await recolouring;
});

const COMMENTED = { ...WORD, comment: "<p>worth quoting</p>" };

/** The rendered comment under the popup's row, or `null` while none stands. */
function commentText(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".zt-annot-comment");
}

/** The resting comment field under the popup's row, or `null` while none stands. */
function commentField(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".zt-annot-comment-field");
}

it("shows the stored comment under the row, and none for a mark without one", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  expect(commentText(popup.hoverEl)?.textContent).toBe("<p>worth quoting</p>");

  h.selection.select("PARA7777");
  expect(commentField(popup.hoverEl)?.textContent).toBe(
    m.annot_view_card_comment_placeholder(),
  );
});

it("puts the caret where the click on the comment landed, and at the end from the keyboard", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  // The DOM here lays nothing out, so the point maps to a position by hand.
  const posAtCoords = vi
    .spyOn(EditorView.prototype, "posAtCoords")
    .mockReturnValue(5);

  commentField(popup.hoverEl)!.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: 12,
      clientY: 34,
      detail: 1,
    }),
  );
  expect(posAtCoords).toHaveBeenCalledWith({ x: 12, y: 34 });
  expect(commentView(popup.hoverEl)!.state.selection.main.head).toBe(5);

  commentView(popup.hoverEl)!.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  commentField(popup.hoverEl)!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  const editor = commentView(popup.hoverEl)!;
  expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
});

it("opens the comment editor in the comment's place from a click on the comment", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  commentField(popup.hoverEl)!.click();

  expect(h.store.getState().floating).toMatchObject({ commenting: true });
  expect(commentView(popup.hoverEl)).not.toBeNull();
  expect(commentText(popup.hoverEl)).toBeNull();
});

it("keeps a click that selected the comment's text a read", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const field = commentField(popup.hoverEl)!;
  // A drag across the comment ends in a click with the text selected.
  const range = document.createRange();
  range.selectNodeContents(field);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);

  field.click();
  document.getSelection()!.removeAllRanges();

  expect(h.store.getState().floating).toMatchObject({ commenting: false });
  expect(commentView(popup.hoverEl)).toBeNull();
});

it("draws the comment read-only while a write is pending on it", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  expect(commentField(popup.hoverEl)?.hasAttribute("aria-disabled")).toBe(
    false,
  );
  const release = h.zotero.holdWrites();

  key(h, "3");

  await vi.waitFor(() =>
    expect(commentField(popup.hoverEl)?.getAttribute("aria-disabled")).toBe(
      "true",
    ),
  );
  expect(commentText(popup.hoverEl)?.textContent).toBe("<p>worth quoting</p>");
  release();
  await settled(h, "WRDS2222");
});

it("keeps a blocked comment field in the tab order, and spends its press on the reason", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED], {
    kind: "authorization-required",
  });
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const field = commentField(popup.hoverEl)!;
  expect(field.tabIndex).toBe(0);
  expect(field.hasAttribute("data-blocked")).toBe(true);

  field.click();

  expect(h.store.getState().floating).toMatchObject({ commenting: false });
  expect(commentView(popup.hoverEl)).toBeNull();
  expect(h.gestures.blockedPress).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ action: "allow-editing" }),
  );
});

it("adds a comment from the empty comment field, and saves and closes it on Escape", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  h.selection.select("PARA7777");
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  expect(popup.hoverEl.querySelector("[data-zt-verb='comment']")).toBeNull();

  commentField(popup.hoverEl)!.click();

  const editor = commentView(popup.hoverEl)!;
  expect(commentField(popup.hoverEl)).toBeNull();
  // The field saves as the user types; no button asks to be pressed.
  expect(popup.hoverEl.querySelector("button.mod-cta")).toBeNull();
  editor.dispatch({ changes: { from: 0, insert: "new note" } });

  editor.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(commentView(popup.hoverEl)).toBeNull();
  expect(h.store.getState().floating).toMatchObject({ commenting: false });
  await vi.waitFor(() =>
    expect(h.zotero.at("PARA7777")?.comment).toBe("new note"),
  );
});

it("keeps the comment's Write Conflict through a later conflict on the Quoted Text", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  h.zotero.changeInZotero("WRDS2222", { comment: "<p>theirs</p>" });
  h.zotero.answerNextWrite(() => staleVersionPatch());
  h.repository.editTextField("comment", "WRDS2222", "<p>mine</p>");
  await h.repository.submitTextField("comment", "WRDS2222");
  h.selection.select("WRDS2222");
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const conflict = () => popup.hoverEl.querySelector(".zt-annot-conflict");
  expect(conflict()).not.toBeNull();

  // A Text Edit meets a conflict of its own after it, so the Annotation's
  // latest outcome is the Quoted Text's.
  h.zotero.changeInZotero("WRDS2222", { text: "theirs" });
  h.zotero.answerNextWrite(() => staleVersionPatch());
  h.repository.editTextField("text", "WRDS2222", "mine");
  await h.repository.submitTextField("text", "WRDS2222");
  expect(h.repository.mutationFor("WRDS2222")).toMatchObject({
    conflict: { write: "text" },
  });

  expect(conflict()).not.toBeNull();
});

it("closes the open editor on Escape after editing became blocked", async () => {
  await using h = await setup([PARAGRAPH, COMMENTED]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  commentField(popup.hoverEl)!.click();
  const editor = commentView(popup.hoverEl)!;

  ingestCapability(h.store, { kind: "authorization-required" }, READER_NOW);
  editor.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  expect(commentView(popup.hoverEl)).toBeNull();
  expect(h.store.getState().floating).toMatchObject({ commenting: false });
  expect(h.gestures.blockedPress).not.toHaveBeenCalled();
});

it("selects a landed mark without a popup, and opens one for the next selection", async () => {
  await using h = await setup();

  h.selection.select("WRDS2222", { popup: false });
  h.sync();

  expect([...h.selection.selected]).toEqual(["WRDS2222"]);
  expect(h.reported).toEqual([["WRDS2222"]]);
  expect(h.popup()).toBeNull();

  h.selection.select("PARA7777");
  expect(h.popup()?.staticPos).toEqual({ x: 300, y: 192 });
});

/** The tag editor's field in the popup, or `null` while none is open. */
function tagInput(root: HTMLElement): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(".zt-annot-tag-input");
}

it("saves a tag session once as it ends, from the tag verb or a new selection", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const verb = () =>
    popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!;

  verb().click();
  expect(h.store.getState().floating).toMatchObject({ tagging: true });
  tagInput(popup.hoverEl)!.value = "figure";
  await settled(h, "WRDS2222");
  expect(h.writes()).toEqual([]);

  verb().click();
  expect(h.store.getState().floating).toMatchObject({ tagging: false });
  await vi.waitFor(() =>
    expect(h.zotero.at("WRDS2222")?.tags).toEqual(["figure"]),
  );
  expect(h.writes()).toHaveLength(1);

  verb().click();
  tagInput(popup.hoverEl)!.value = "method";
  h.selection.select("PARA7777");
  await vi.waitFor(() =>
    expect(h.zotero.at("WRDS2222")?.tags).toEqual(["figure", "method"]),
  );
  expect(h.writes()).toHaveLength(2);
});

it("closes only the tag editor for Escape, and keeps the selection", async () => {
  await using h = await setup([PARAGRAPH, { ...WORD, tags: ["figure"] }]);
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!.click();
  // The chip's own remove button takes the one tag off.
  popup.hoverEl.querySelector<HTMLElement>(".zt-annot-tag-remove")!.click();

  // The Reader Keymap runs this for an Escape outside a text field, such as
  // one on a chip's remove button.
  expect(h.selection.escape()).toBe(true);

  expect(h.store.getState().floating).toMatchObject({
    key: "WRDS2222",
    tagging: false,
  });
  await vi.waitFor(() => expect(h.zotero.at("WRDS2222")?.tags).toEqual([]));
  expect(h.writes()).toHaveLength(1);
});

it("takes no typed name into a tag draft a database switch hid", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!.click();
  expect(h.store.getState().tagDrafts.has("WRDS2222")).toBe(true);
  tagInput(popup.hoverEl)!.value = "typed before the switch";

  await h.switchDatabase();

  // The other database's list has no such mark, so the selection may end too.
  expect(h.store.getState().floating).not.toMatchObject({ tagging: true });
  expect(tagInput(popup.hoverEl)).toBeNull();
  // The typed name starts no second draft, and nothing reaches Zotero.
  expect(h.store.getState().tagDrafts.has("WRDS2222")).toBe(false);
  await settled(h, "WRDS2222");
  expect(h.writes()).toEqual([]);
});

it("opens no tag editor while no tag session can start", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  // Zotero quits, and the repository learns it before the reader does.
  h.zotero.quit();
  await h.repository.probe();

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!.click();

  expect(h.store.getState().floating).toMatchObject({ tagging: false });
  expect(tagInput(popup.hoverEl)).toBeNull();
});

it("binds the held tags panel to Save tags and Discard, and keeps it through a refresh", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const button = (label: string) =>
    [...popup.hoverEl.querySelectorAll("button")].find(
      (el) => el.textContent === label,
    );
  /** One tag session whose save loses its reply, which holds its draft. */
  async function holdTag(name: string): Promise<void> {
    const verb = () =>
      popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!;
    verb().click();
    tagInput(popup.hoverEl)!.value = name;
    h.zotero.answerNextWrite(() =>
      Promise.reject(new AbortError("reader closed")),
    );
    verb().click();
    await vi.waitFor(() =>
      expect(button(m.annot_view_tags_save())).toBeDefined(),
    );
  }

  await holdTag("figure");
  const save = button(m.annot_view_tags_save());
  expect(save).toBeDefined();

  // A comment write in flight refreshes the popup, and the held panel it
  // draws again is the same, so a click between press and release lands.
  const release = h.zotero.holdWrites();
  h.repository.editTextField("comment", "WRDS2222", "worth quoting");
  const commenting = h.repository.submitTextField("comment", "WRDS2222");
  await reread(h);
  expect(h.store.getState().mutations.get("WRDS2222")).toEqual({
    kind: "pending",
    write: "comment",
  });
  expect(button(m.annot_view_tags_save())).toBe(save);
  release();
  await commenting;

  save!.click();
  // Save tags carries no `automatic`, so the held draft is written.
  await vi.waitFor(() =>
    expect(h.zotero.at("WRDS2222")?.tags).toEqual(["figure"]),
  );
  await vi.waitFor(() =>
    expect(button(m.annot_view_tags_save())).toBeUndefined(),
  );

  await holdTag("method");
  // Editing that needs Allow editing puts the reader's own route on the panel.
  ingestCapability(h.store, { kind: "authorization-required" }, READER_NOW);
  button(m.capability_enable_editing())!.click();
  expect(h.gestures.allowEditing).toHaveBeenCalledOnce();

  button(m.annot_view_comment_discard())!.click();
  await vi.waitFor(() =>
    expect(button(m.annot_view_tags_save())).toBeUndefined(),
  );
  await settled(h, "WRDS2222");
  expect(h.zotero.at("WRDS2222")?.tags).toEqual(["figure"]);
});

it("falls back to the comment field, and closes the editor, when no draft can be started", async () => {
  await using h = await setup();
  click(h.page.div, ON_WORD);
  // Zotero quits, and the repository learns it before the reader does.
  h.zotero.quit();
  await h.repository.probe();

  setCommenting(h.store, true);

  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  expect(commentView(popup.hoverEl)).toBeNull();
  expect(commentField(popup.hoverEl)).not.toBeNull();
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

/**
 * Waits until the last Geometry Edit's write reached Zotero. The selection
 * settles `adjusted` once it has asked for the write, or ended without one,
 * and the write is pending on the mark from that ask until Zotero answers.
 */
async function geometrySaved(h: Harness, annotationKey: string): Promise<void> {
  await h.selection.adjusted;
  await settled(h, annotationKey);
}

/** The figure selected by a click on its body, as a researcher selects it. */
async function figureSelected(capability?: EditingCapability) {
  const h = await setup([FIGURE], capability);
  click(h.page.div, ON_FIGURE);
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
  return h;
}

it("saves a handle drag on release, with the Sort Index of the new position", async () => {
  await using h = await figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 320, y: 500 });
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  // Nothing is asked while the pointer moves: a write is pending from its ask.
  expect(h.repository.mutationFor("FIGR3333").kind).toBe("idle");
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await geometrySaved(h, "FIGR3333");
  expect(h.writes()).toHaveLength(1);

  // Forty points right and twenty-five down the page, which is twenty-five
  // points toward the foot in PDF space.
  expect(h.sortIndex).toHaveBeenCalledWith({
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 275, 340, 500]],
  });
  expect(h.zotero.at("FIGR3333")).toMatchObject({
    position: { pageIndex: 0, rects: [[100, 275, 340, 500]] },
    sortIndex: "00000|000012|00517",
  });
  // The adjustment ends once the write settled, and the mark stays selected.
  expect(h.store.getState().floating).toEqual(
    expect.not.objectContaining({ adjust: expect.anything() }),
  );
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("moves the selected image by its body", async () => {
  await using h = await figureSelected();

  pointer(h.page.div, "pointerdown", ON_FIGURE);
  pointer(h.containerEl, "pointermove", { x: 230, y: 382 });
  pointer(h.containerEl, "pointerup", { x: 230, y: 382 });
  await geometrySaved(h, "FIGR3333");

  expect(h.zotero.at("FIGR3333")).toMatchObject({
    position: { pageIndex: 0, rects: [[130, 310, 330, 510]] },
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
  await using h = await setup([stroke]);
  click(h.page.div, { x: 150, y: 442 });
  expect([...h.selection.selected]).toEqual(["INK44444"]);

  // Four points below the stroke's foot, inside the padding and clear of
  // every corner handle.
  pointer(h.page.div, "pointerdown", { x: 150, y: 496 });
  pointer(h.containerEl, "pointermove", { x: 180, y: 476 });
  pointer(h.containerEl, "pointerup", { x: 180, y: 476 });
  await geometrySaved(h, "INK44444");

  expect(h.zotero.at("INK44444")).toMatchObject({
    position: { pageIndex: 0, width: 2, paths: [[130, 320, 230, 420]] },
    sortIndex: "00000|000012|00517",
  });
});

it("writes nothing for a release that did not move, and keeps the selection", async () => {
  await using h = await figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  expect(h.popup()).toBeNull();
  pointer(h.containerEl, "pointerup", BOTTOM_RIGHT);
  h.page.div.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 492, bubbles: true }),
  );
  await geometrySaved(h, "FIGR3333");

  expect(h.writes()).toEqual([]);
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
  // The popup the press hid hangs again from the mark.
  expect(h.popup()).not.toBeNull();
});

it("cancels a drag on Escape, writes nothing, and keeps the mark selected", async () => {
  await using h = await figureSelected();

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  key(h, "Escape");
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await geometrySaved(h, "FIGR3333");

  expect(h.writes()).toEqual([]);
  expect(h.store.getState().floating).toMatchObject({ key: "FIGR3333" });
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
});

it("hides the Mark Popup during a drag and hangs it again on release", async () => {
  await using h = await figureSelected();
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
  await using h = await figureSelected({
    kind: "read-only",
    reason: "library-read-only",
  });

  pointer(h.page.div, "pointerdown", { x: 299, y: 491 });
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await geometrySaved(h, "FIGR3333");

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.writes()).toEqual([]);
});

it("snaps a refused write back to the confirmed geometry", async () => {
  await using h = await figureSelected();
  h.zotero.answerNextWrite(() => libraryReadOnly());

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  expect(h.store.getState().floating).toMatchObject({
    adjust: { phase: "saving" },
  });
  await geometrySaved(h, "FIGR3333");

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  // Zotero keeps the confirmed geometry, and the mark draws it again.
  expect(h.zotero.at("FIGR3333")?.position).toMatchObject({
    rects: [[100, 300, 300, 500]],
  });
  await vi.waitFor(() =>
    expect(
      h.store.getState().records.find(({ key }) => key === "FIGR3333")
        ?.position,
    ).toMatchObject({ rects: [[100, 300, 300, 500]] }),
  );
});

it("takes a press on a handle where it is drawn on a page turned a quarter turn", async () => {
  // A quarter turn lays PDF (x, y) at page units (y, x) on a page 792 wide
  // and 612 high, which the seeded box draws one unit to the pixel: the
  // figure spans x 300–500 and y 100–300, and its bottom-right corner, PDF
  // (300, 300), stands at (300, 300), where render.test.ts sees it drawn.
  await using h = await setup([FIGURE]);
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
  await geometrySaved(h, "FIGR3333");

  // Ten units right is ten points up PDF's y, and twenty down is twenty
  // points along its x: the corner moves to (320, 310).
  expect(h.zotero.at("FIGR3333")).toMatchObject({
    position: { pageIndex: 0, rects: [[100, 310, 320, 500]] },
    sortIndex: "00000|000012|00517",
  });
});

it("leaves a drag beside the selected image to the text selection", async () => {
  await using h = await figureSelected();

  pointer(h.page.div, "pointerdown", { x: 400, y: 392 });
  pointer(h.containerEl, "pointermove", { x: 450, y: 392 });
  pointer(h.containerEl, "pointerup", { x: 450, y: 392 });
  await geometrySaved(h, "FIGR3333");

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.writes()).toEqual([]);
});

/**
 * A highlight on page one from x 100 to 200 and, counted from the page foot,
 * y 300 to 312 — client y 480 to 492 — so its end strip stands on x 200.
 */
const QUOTE = annotation("QUTE5555", "highlight", {
  pageIndex: 0,
  rects: [[100, 300, 200, 312]],
});
const ON_QUOTE = { x: 150, y: 486 };
const QUOTE_END = { x: 201, y: 486 };

/** The quote selected by a click on it, as a researcher selects it. */
async function quoteSelected() {
  const h = await setup([QUOTE]);
  click(h.page.div, ON_QUOTE);
  expect([...h.selection.selected]).toEqual(["QUTE5555"]);
  return h;
}

it("saves a range's end dragged along the text, with its quoted text", async () => {
  await using h = await quoteSelected();
  h.adjustRange.mockResolvedValue({
    pageIndex: 0,
    rects: [[100, 300, 260, 312]],
    text: "the quote, one word longer",
  });

  pointer(h.page.div, "pointerdown", QUOTE_END);
  pointer(h.containerEl, "pointermove", { x: 260, y: 486 });
  // Released before the document answered: the save waits for the answer.
  pointer(h.containerEl, "pointerup", { x: 260, y: 486 });
  await geometrySaved(h, "QUTE5555");

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "end",
    point: { pageIndex: 0, x: 260, y: 306 },
  });
  expect(h.zotero.at("QUTE5555")).toMatchObject({
    position: { pageIndex: 0, rects: [[100, 300, 260, 312]] },
    sortIndex: "00000|000012|00517",
    text: "the quote, one word longer",
  });
});

it("drops a range the document answers after Escape took its drag back", async () => {
  await using h = await quoteSelected();
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
  await using h = await quoteSelected();
  expect(h.popup()).not.toBeNull();

  pointer(h.page.div, "pointerdown", QUOTE_END);
  expect(h.popup()).toBeNull();

  pointer(h.containerEl, "pointerup", QUOTE_END);
  await h.selection.adjusted;
  expect(h.popup()).not.toBeNull();
});

it("leaves a press inside the selected highlight to the text selection", async () => {
  await using h = await quoteSelected();

  pointer(h.page.div, "pointerdown", ON_QUOTE);
  pointer(h.containerEl, "pointermove", { x: 180, y: 486 });
  pointer(h.containerEl, "pointerup", { x: 180, y: 486 });
  await h.selection.adjusted;

  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.adjustRange).not.toHaveBeenCalled();
});

it("commits one Geometry Edit for Shift+ArrowRight on the selected image, with a recomputed Sort Index", async () => {
  await using h = await figureSelected();

  chord(h, "ArrowRight", { shiftKey: true });
  await geometrySaved(h, "FIGR3333");

  // Five points wider, on its right edge.
  expect(h.sortIndex).toHaveBeenCalledWith({
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 300, 305, 500]],
  });
  expect(h.writes()).toHaveLength(1);
  expect(h.zotero.at("FIGR3333")).toMatchObject({
    position: { pageIndex: 0, rects: [[100, 300, 305, 500]] },
    sortIndex: "00000|000012|00517",
  });
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("nudges the selected image five points down the page for Alt+ArrowDown", async () => {
  await using h = await figureSelected();

  chord(h, "ArrowDown", { altKey: true });
  await geometrySaved(h, "FIGR3333");

  expect(h.zotero.at("FIGR3333")).toMatchObject({
    position: { pageIndex: 0, rects: [[100, 295, 300, 495]] },
    sortIndex: "00000|000012|00517",
  });
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("keeps walking the reading order with a plain arrow while an image is selected", async () => {
  await using h = await setup([FIGURE, WORD]);
  click(h.page.div, ON_FIGURE);

  key(h, "ArrowUp");
  key(h, "ArrowRight");
  await geometrySaved(h, "FIGR3333");

  expect(h.writes()).toEqual([]);
  expect([...h.selection.selected]).not.toEqual(["FIGR3333"]);
});

it("writes nothing for a Geometry Edit key while editing is not live, and says why", async () => {
  await using h = await figureSelected({
    kind: "read-only",
    reason: "library-read-only",
  });

  chord(h, "ArrowRight", { shiftKey: true });
  chord(h, "ArrowDown", { shiftKey: true });
  chord(h, "ArrowDown", { altKey: true });
  await geometrySaved(h, "FIGR3333");

  expect(h.writes()).toEqual([]);
  expect(h.gestures.reportBlockedGesture).toHaveBeenCalledTimes(3);
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["FIGR3333"]);
});

it("steps a highlight's start for Mod+Shift+ArrowLeft, saving its quoted text", async () => {
  vi.spyOn(Keymap, "isModifier").mockImplementation(
    (event, modifier) => modifier === "Mod" && event.metaKey,
  );
  await using h = await quoteSelected();
  h.adjustRange.mockResolvedValue({
    pageIndex: 0,
    rects: [[95, 300, 200, 312]],
    text: "a quote",
  });

  chord(h, "ArrowLeft", { shiftKey: true, metaKey: true });
  await geometrySaved(h, "QUTE5555");

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "start",
    step: "left",
  });
  expect(h.zotero.at("QUTE5555")).toMatchObject({
    position: { pageIndex: 0, rects: [[95, 300, 200, 312]] },
    sortIndex: "00000|000012|00517",
    text: "a quote",
  });
});

it("steps a highlight's end for Shift+ArrowDown, and writes nothing for a step the document refuses", async () => {
  await using h = await quoteSelected();

  chord(h, "ArrowDown", { shiftKey: true });
  await geometrySaved(h, "QUTE5555");

  expect(h.adjustRange).toHaveBeenCalledWith({
    position: QUOTE.position,
    end: "end",
    step: "down",
  });
  expect(h.writes()).toEqual([]);
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect([...h.selection.selected]).toEqual(["QUTE5555"]);
});

/**
 * A Locked Annotation where the word lies: the key the repository fixture's
 * database holds, marked there as imported from the PDF file, since a lock is
 * read from the database alone. It carries a comment, so the popup shows the
 * comment field.
 */
const LOCKED_WORD = {
  ...WORD,
  key: "PUPR5FG5",
  comment: "<p>imported with the file</p>",
};
/** The same Locked Annotation, drawn as an image, so it has a body to move. */
const LOCKED_FIGURE = { ...FIGURE, key: "PUPR5FG5" };
const LOCK_REASON = m.annot_view_lock_external();

async function lockedSelected(
  record: AnnotationRecord,
  at: { x: number; y: number },
  capability?: EditingCapability,
) {
  const h = await setup([record], capability, { external: ["PUPR5FG5"] });
  expect(h.store.getState().records[0]?.lock).toEqual({ reason: "external" });
  click(h.page.div, at);
  expect([...h.selection.selected]).toEqual(["PUPR5FG5"]);
  return h;
}

it("dims the Mark Popup's colour, tag and delete verbs on a Locked Annotation, with the Lock Reason", async () => {
  await using h = await lockedSelected(LOCKED_WORD, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  const verbs = [
    ...popup.hoverEl.querySelectorAll<HTMLElement>("[data-zt-verb]"),
  ];
  expect(
    verbs.map((node) => ({
      verb: node.dataset.ztVerb,
      blocked: node.getAttribute("aria-disabled") === "true",
      tooltip: node.getAttribute("aria-label"),
    })),
  ).toEqual([
    { verb: "color", blocked: true, tooltip: LOCK_REASON },
    { verb: "tags", blocked: true, tooltip: LOCK_REASON },
    { verb: "copy", blocked: false, tooltip: expect.any(String) },
    { verb: "delete", blocked: true, tooltip: LOCK_REASON },
    { verb: "reveal", blocked: false, tooltip: expect.any(String) },
  ]);

  verbs.find((node) => node.dataset.ztVerb === "delete")!.click();
  await settled(h, "PUPR5FG5");
  expect(h.writes()).toEqual([]);
});

it("spends a press on a Locked Annotation's comment on the Lock Reason, with no action", async () => {
  await using h = await lockedSelected(LOCKED_WORD, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };
  const field = commentField(popup.hoverEl)!;
  expect(field.hasAttribute("data-blocked")).toBe(true);

  field.click();
  field.click();

  expect(commentView(popup.hoverEl)).toBeNull();
  expect(h.store.getState().floating).toMatchObject({ commenting: false });
  expect(h.gestures.blockedPress.mock.calls).toEqual([
    [{ reason: LOCK_REASON, action: null, source: "lock" }],
    [{ reason: LOCK_REASON, action: null, source: "lock" }],
  ]);
});

it("gives a Locked Annotation no Mark Handles, and moves it by no drag", async () => {
  await using h = await lockedSelected(LOCKED_FIGURE, ON_FIGURE);
  expect(selectMarkHandles(h.store.getState())).toBe(false);

  // Where a handle would sit, and then the body: neither press takes a grip.
  for (const [from, to] of [
    [BOTTOM_RIGHT, { x: 340, y: 517 }],
    [ON_FIGURE, { x: 240, y: 420 }],
  ] as const) {
    pointer(h.page.div, "pointerdown", from);
    pointer(h.containerEl, "pointermove", to);
    expect(h.store.getState().floating).not.toHaveProperty("adjust");
    pointer(h.containerEl, "pointerup", to);
  }
  await geometrySaved(h, "PUPR5FG5");

  expect(h.writes()).toEqual([]);
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
});

it("refuses every edit key on a Locked Annotation with the Lock Reason, on every press", async () => {
  await using h = await lockedSelected(LOCKED_FIGURE, ON_FIGURE);

  key(h, "3");
  key(h, "Delete");
  key(h, "Backspace");
  chord(h, "ArrowRight", { shiftKey: true });
  chord(h, "ArrowDown", { altKey: true });
  await geometrySaved(h, "PUPR5FG5");

  expect(h.writes()).toEqual([]);
  expect(h.store.getState().floating).not.toHaveProperty("adjust");
  expect(h.gestures.blockedPress.mock.calls).toEqual(
    Array.from({ length: 5 }, () => [
      { reason: LOCK_REASON, action: null, source: "lock" },
    ]),
  );
  expect(h.gestures.reportBlockedGesture).not.toHaveBeenCalled();
});

it("says the Lock Reason alone for a Geometry Edit the lock refuses on release", async () => {
  await using h = await setup([LOCKED_FIGURE]);
  click(h.page.div, ON_FIGURE);
  notices.shown.length = 0;

  pointer(h.page.div, "pointerdown", BOTTOM_RIGHT);
  pointer(h.containerEl, "pointermove", { x: 340, y: 517 });
  // Zotero imports the Annotation from the PDF file while the pointer is down.
  h.importFromPdf("PUPR5FG5");
  await vi.waitFor(() =>
    expect(h.store.getState().records[0]?.lock).toEqual({ reason: "external" }),
  );
  pointer(h.containerEl, "pointerup", { x: 340, y: 517 });
  await geometrySaved(h, "PUPR5FG5");

  expect(h.writes()).toEqual([]);
  expect(notices.shown).toEqual([LOCK_REASON]);
});

it("refuses a group Delete or colour key with one Locked Annotation before the confirmation, with its Lock Reason", async () => {
  await using h = await setup([PARAGRAPH, LOCKED_WORD], undefined, {
    external: ["PUPR5FG5"],
  });
  using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
  h.selection.selectMarks(["PARA7777", "PUPR5FG5"]);

  key(h, "Delete");
  key(h, "3");
  await settled(h, "PUPR5FG5");

  expect(ask).not.toHaveBeenCalled();
  expect(h.writes()).toEqual([]);
  expect(h.gestures.blockedPress.mock.calls).toEqual([
    [{ reason: LOCK_REASON, action: null, source: "lock" }],
    [{ reason: LOCK_REASON, action: null, source: "lock" }],
  ]);
});

it("answers an edit key on a Locked Annotation with the Editing Capability's block first", async () => {
  await using h = await lockedSelected(LOCKED_FIGURE, ON_FIGURE, {
    kind: "read-only",
    reason: "library-read-only",
  });

  key(h, "Delete");
  chord(h, "ArrowRight", { shiftKey: true });
  chord(h, "ArrowDown", { altKey: true });
  await geometrySaved(h, "PUPR5FG5");

  expect(h.writes()).toEqual([]);
  expect(h.gestures.reportBlockedGesture).toHaveBeenCalledTimes(3);
  expect(h.gestures.blockedPress).not.toHaveBeenCalled();
});

it("keeps the tag editor closed for a press on a Locked Annotation's tag verb", async () => {
  await using h = await lockedSelected(LOCKED_WORD, ON_WORD);
  const popup = h.popup() as unknown as { hoverEl: HTMLElement };

  popup.hoverEl.querySelector<HTMLElement>("[data-zt-verb='tags']")!.click();

  expect(h.store.getState().floating).toMatchObject({ tagging: false });
  expect(h.repository.tagDraftFor("PUPR5FG5")).toBeNull();
  expect(h.writes()).toEqual([]);
});
