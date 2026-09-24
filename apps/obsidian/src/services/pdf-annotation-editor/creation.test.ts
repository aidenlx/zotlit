// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Menu } from "@mock/obsidian";
import { afterEach, expect, it, vi } from "vitest";

import { PdfTextStructure } from "@zotlit/pdf-structure";
import type {
  PdfPageSource,
  SelectedText,
  TextSelection,
} from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationDraft,
  CreateOutcome,
} from "@/services/annotation-repository/service";
import type { TextPosition } from "@/services/annotation-repository/write";
import {
  blockedReason,
  MAX_POSITION_LENGTH,
  writePosition,
} from "@/services/annotation-repository/write";
import { pressSubmit } from "@/views/annot-view/__fixtures__/editor-app";

import {
  annotation,
  annotationEdits,
  pageView,
  READER_NOW as NOW,
  readerSettings,
  readerSurfaces,
} from "./__fixtures__";
import { arm, ingestCapability, selectTextDraft } from "./reader-surface-state";
import type { OverlayPageView } from "./render";
import { toolColorStore } from "./tools";
import type { ToolColorStore } from "./tools";

/** The Fixture's own underline on `rougier-2014.pdf`, in PDF points. */
const QUOTE = [
  [67.011, 612.638, 211.485, 620.77],
  [58.054, 601.98, 211.489, 610.112],
] as const;

const SCALE = 1.5;
const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;
const PAGE_BOX = {
  left: 0,
  top: 0,
  right: PAGE_WIDTH * SCALE,
  bottom: PAGE_HEIGHT * SCALE,
  width: PAGE_WIDTH * SCALE,
  height: PAGE_HEIGHT * SCALE,
};

/** The client box a PDF-point rectangle occupies on the page laid out above. */
function clientBox([x1, y1, x2, y2]: readonly number[]) {
  return {
    left: x1! * SCALE,
    top: (PAGE_HEIGHT - y2!) * SCALE,
    right: x2! * SCALE,
    bottom: (PAGE_HEIGHT - y1!) * SCALE,
  };
}

function boxes(rects: readonly (readonly number[])[] = QUOTE) {
  return rects.map((rect) => clientBox(rect));
}

/** The comment editor the popup holds, or `null` while it holds none. */
function commentView(popup: HTMLElement): EditorView | null {
  const dom = popup.querySelector<HTMLElement>(".cm-editor");
  return dom && EditorView.findFromDOM(dom);
}

/**
 * One reader with a settled text selection over the quote above, and everything
 * the creation surfaces read and write through.
 *
 * happy-dom lays nothing out, so the page box and the selection's own boxes are
 * supplied; every other geometry step is the production one.
 */
function reader(
  options: {
    capability?: EditingCapability;
    outcome?: CreateOutcome;
    /** What the page's characters make of the selection; `null` refuses it. */
    selected?: SelectedText | null;
    /** What the write waits on before Zotero answers. */
    answered?: Promise<void>;
  } = {},
) {
  vi.useFakeTimers();
  const containerEl = document.body.createDiv();
  containerEl.getBoundingClientRect = () => PAGE_BOX as never;
  const pageEl = containerEl.createDiv();
  const textLayer = pageEl.createDiv({
    cls: "textLayer",
    text: "Scientific visualization",
  });
  pageEl.getBoundingClientRect = () => PAGE_BOX as never;

  const drafts: Omit<AnnotationDraft, "parentKey">[] = [];
  const sorted: unknown[] = [];
  const selections: TextSelection[] = [];
  const structure = {
    selectText: vi.fn(async (selection: TextSelection) => {
      selections.push(selection);
      return options.selected === undefined
        ? {
            pageIndex: 0,
            rects: QUOTE.map((rect) => [...rect] as const),
            text: "Scientific visualization",
          }
        : options.selected;
    }),
    sortIndex: vi.fn(async (position: unknown) => {
      sorted.push(position);
      return "00000|000434|00180";
    }),
    pageLabel: vi.fn(async () => "1"),
  };
  const reader = readerSurfaces({
    containerEl,
    page: {
      div: pageEl,
      viewport: {
        transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
      },
    } as never,
    records: [
      annotation("PUPR5FG5", "highlight", {
        pageIndex: 0,
        rects: [[265.833, 611.202, 374.503, 620.019]],
      }),
    ],
    capability: options.capability,
    structure: structure as never,
    annotations: {
      ...annotationEdits(),
      createAnnotation: vi.fn(
        async (
          _key: string,
          draft: Omit<AnnotationDraft, "parentKey">,
        ): Promise<CreateOutcome> => {
          drafts.push(draft);
          await options.answered;
          return (
            options.outcome ?? { kind: "created", annotationKey: "MADE2345" }
          );
        },
      ),
    },
  });
  const { app, creation, store: surfaceState, revealed } = reader;

  return {
    app,
    creation,
    surfaceState,
    containerEl,
    pageEl,
    drafts,
    sorted,
    selections,
    revealed,
    structure,
    slot: document.body.createDiv(),
    /**
     * A drag that starts on the page and releases with text selected, once
     * the selection has been placed on the page's characters.
     */
    async selectText(rects = boxes()) {
      this.startSelecting(rects);
      await creation.settled;
      // Obsidian's hover popover shows on a timer, even at no delay.
      vi.advanceTimersByTime(0);
    },
    /** The same drag, left before its selection has been placed. */
    startSelecting(rects = boxes()) {
      const range = document.createRange();
      range.selectNodeContents(textLayer);
      // The capture clamps a clone of the range to each page, so the boxes are
      // supplied on the prototype rather than on this one object.
      vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(
        rects as never,
      );
      vi.spyOn(window, "getSelection").mockReturnValue({
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => range,
        removeAllRanges: () => undefined,
        toString: () => range.toString(),
      } as never);
      creation.press(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100 }),
      );
      creation.settle();
    },
    /** A press on the page that selects nothing. */
    pressEmpty() {
      vi.spyOn(window, "getSelection").mockReturnValue({
        rangeCount: 0,
        isCollapsed: true,
        getRangeAt: () => document.createRange(),
        removeAllRanges: () => undefined,
      } as never);
      creation.press(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100 }),
      );
    },
    press(key: string, target: EventTarget = containerEl) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      Object.defineProperty(event, "target", { value: target });
      creation.key(event);
      return event;
    },
    popup() {
      return document.querySelector<HTMLElement>(".zt-pdf-mark-popup");
    },
    [Symbol.dispose]() {
      reader[Symbol.dispose]();
      containerEl.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.empty();
});

it("opens the popup in create mode once the drag on the page has ended", async () => {
  using open = reader();

  await open.selectText();

  const verbs = [
    ...(open.popup()?.querySelectorAll<HTMLElement>("[data-zt-verb]") ?? []),
  ].map((node) => node.dataset.ztVerb);
  expect(verbs).toEqual([
    "highlight",
    "underline",
    "color-1",
    "color-2",
    "color-3",
    "color-4",
    "comment",
    "copy",
  ]);
});

it("offers the colour used last first, whichever tool used it", async () => {
  using open = reader();
  await open.selectText();
  open.press("6");
  await open.creation.created;

  await open.selectText();

  const swatches = [
    ...(open
      .popup()
      ?.querySelectorAll<HTMLElement>("[data-zt-verb^='color-']") ?? []),
  ].map((node) => node.dataset.ztVerb);
  expect(swatches).toEqual(["color-6", "color-1", "color-2", "color-3"]);
});

it("opens nothing for a drag that did not start on the page", async () => {
  using open = reader();
  open.pageEl.getBoundingClientRect = () =>
    ({ ...PAGE_BOX, left: 5000, right: 6000 }) as never;

  await open.selectText();

  expect(open.popup()).toBeNull();
});

it("commits a swatch click and reopens on the new mark", async () => {
  using open = reader();
  await open.selectText();

  open.popup()!.querySelector<HTMLElement>('[data-zt-verb="color-3"]')!.click();
  await open.creation.created;

  expect(open.drafts).toEqual([
    expect.objectContaining({
      type: "highlight",
      color: ANNOTATION_COLORS[2],
      text: "Scientific visualization",
      pageLabel: "1",
      sortIndex: "00000|000434|00180",
    }),
  ]);
  expect(open.revealed).toEqual(["MADE2345"]);
  expect(open.popup()).toBeNull();
});

it("reads the selection off the page's text layer", async () => {
  using open = reader();

  await open.selectText();

  expect(open.selections).toEqual([
    {
      text: "Scientific visualization",
      pages: [
        expect.objectContaining({
          pageIndex: 0,
          layerText: "Scientific visualization",
          start: 0,
          end: 24,
        }),
      ],
    },
  ]);
});

it("writes the rectangles and the text the page's characters give", async () => {
  const selected = {
    pageIndex: 0,
    rects: [[58.054, 601.98, 211.489, 610.112]],
    nextPageRects: [[58.05, 263.92, 211.46, 272.05]],
    text: "this process",
  } as SelectedText;
  using open = reader({ selected });
  await open.selectText();

  open.press("h");
  await open.creation.created;

  const position = {
    pageIndex: 0,
    rects: selected.rects,
    nextPageRects: selected.nextPageRects,
  };
  expect(open.sorted).toEqual([position]);
  expect(open.drafts).toEqual([
    expect.objectContaining({ text: "this process", position }),
  ]);
});

it("opens nothing for a selection the page's characters cannot place", async () => {
  using open = reader({ selected: null });

  await open.selectText();

  expect(open.popup()).toBeNull();
});

it("opens nothing for a selection that collapsed before it was placed", async () => {
  using open = reader();

  open.startSelecting();
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 0,
    isCollapsed: true,
  } as never);
  await open.creation.settled;
  vi.advanceTimersByTime(0);

  expect(open.popup()).toBeNull();
});

it("opens nothing for a selection the next press left before it was placed", async () => {
  using open = reader();

  open.startSelecting();
  open.pressEmpty();
  await open.creation.settled;
  vi.advanceTimersByTime(0);

  expect(open.popup()).toBeNull();
});

it.each([
  { key: "h", type: "highlight" },
  { key: "u", type: "underline" },
])(
  "commits $type on $key while a selection is waiting",
  async ({ key, type }) => {
    using open = reader();
    await open.selectText();

    const event = open.press(key);
    await open.creation.created;

    expect(event.defaultPrevented).toBe(true);
    expect(open.drafts.map((draft) => draft.type)).toEqual([type]);
  },
);

it.each([1, 4, 8])(
  "commits in swatch %i while a selection is waiting",
  async (position) => {
    using open = reader();
    await open.selectText();

    open.press(String(position));
    await open.creation.created;

    expect(open.drafts.map(({ color }) => color)).toEqual([
      ANNOTATION_COLORS[position - 1],
    ]);
  },
);

it("opens the comment sheet on c, and saves it with the create", async () => {
  using open = reader();
  await open.selectText();

  open.press("c");
  const editor = commentView(open.popup()!)!;
  editor.dispatch({ changes: { from: 0, insert: "worth quoting" } });
  pressSubmit(open.app);
  await open.creation.created;

  expect(open.drafts.map(({ comment }) => comment)).toEqual(["worth quoting"]);
});

it("arms a tool with h and u while no selection is waiting", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);

  open.press("u");

  expect(
    open.slot
      .querySelector('[data-zt-tool="underline"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(open.drafts).toEqual([]);
});

it("colours the armed tool with 1 to 8 while no selection is waiting", async () => {
  using open = reader();
  open.press("u");
  open.press("5");

  await open.selectText();
  await open.creation.created;

  expect(open.drafts.map(({ type, color }) => [type, color])).toEqual([
    ["underline", ANNOTATION_COLORS[4]],
  ]);
});

it("opens a tool's colours from its own chevron, whether or not it is armed", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  const chevron = open.slot.querySelector<HTMLElement>(
    '[data-zt-tool="underline-color"]',
  )!;

  chevron.click();

  const menu = Menu.instances.at(-1)!;
  expect(menu.parentEl).toBe(chevron);
  expect(menu.items).toHaveLength(ANNOTATION_COLORS.length);
});

it("recolours the tool its own chevron opened, leaving the other alone", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  const colorOf = (tool: string) =>
    open.slot.querySelector<HTMLElement>(`[data-zt-tool="${tool}"]`)?.style
      .color;

  open.slot
    .querySelector<HTMLElement>('[data-zt-tool="underline-color"]')!
    .click();
  Menu.instances.at(-1)!.items[2]!.click();

  expect(colorOf("underline")).toBe(ANNOTATION_COLORS[2]);
  expect(colorOf("highlight")).toBe(ANNOTATION_COLORS[0]);
});

it("commits a released selection at once while a tool is armed", async () => {
  using open = reader();

  open.press("u");
  await open.selectText();
  await open.creation.created;

  expect(open.drafts.map(({ type }) => type)).toEqual(["underline"]);
  expect(open.popup()).toBeNull();
});

it("writes a popup colour back as the tool it commits with", async () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  await open.selectText();

  open.popup()!.querySelector<HTMLElement>('[data-zt-verb="color-3"]')!.click();

  expect(
    open.slot.querySelector<HTMLElement>('[data-zt-tool="highlight"]')?.style
      .color,
  ).toBe(ANNOTATION_COLORS[2]);
});

it("opens a tool's colours from its own chevron, armed or not", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  const chevron = open.slot.querySelector<HTMLElement>(
    '[data-zt-tool="underline-color"]',
  )!;

  chevron.click();

  const menu = Menu.instances.at(-1)!;
  expect(menu.parentEl).toBe(chevron);
  expect(menu.items).toHaveLength(ANNOTATION_COLORS.length);
});

it("recolours the tool its own chevron opened, leaving the other alone", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  const colorOf = (tool: string) =>
    open.slot.querySelector<HTMLElement>(`[data-zt-tool="${tool}"]`)?.style
      .color;

  open.slot
    .querySelector<HTMLElement>('[data-zt-tool="underline-color"]')!
    .click();
  Menu.instances.at(-1)!.items[2]!.click();

  expect(colorOf("underline")).toBe(ANNOTATION_COLORS[2]);
  expect(colorOf("highlight")).toBe(ANNOTATION_COLORS[0]);
});

it("commits a released selection at once while a tool is armed", async () => {
  using open = reader();

  open.press("u");
  await open.selectText();
  await open.creation.created;

  expect(open.drafts.map(({ type }) => type)).toEqual(["underline"]);
  expect(open.popup()).toBeNull();
});

it("writes a popup colour back as the tool it commits with", async () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  await open.selectText();

  open.popup()!.querySelector<HTMLElement>('[data-zt-verb="color-3"]')!.click();

  expect(
    open.slot.querySelector<HTMLElement>('[data-zt-tool="highlight"]')?.style
      .color,
  ).toBe(ANNOTATION_COLORS[2]);
});

it("steps back one level on Escape: sheet, then popup, then the armed tool", async () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  await open.selectText();
  open.press("c");
  expect(commentView(open.popup()!)).not.toBeNull();

  open.press("Escape");
  expect(commentView(open.popup()!)).toBeNull();

  open.press("Escape");
  expect(open.popup()).toBeNull();

  open.press("u");
  open.press("Escape");
  expect(
    open.slot
      .querySelector('[data-zt-tool="underline"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("is inert inside a text field", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  const field = document.body.createEl("input");

  for (const key of ["h", "u", "3", "c", "Escape"]) {
    expect(open.press(key, field).defaultPrevented).toBe(false);
  }

  expect(
    open.slot
      .querySelector('[data-zt-tool="highlight"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("leaves a modified keystroke to Obsidian's own commands", () => {
  using open = reader();
  const event = new KeyboardEvent("keydown", {
    key: "h",
    ctrlKey: true,
    cancelable: true,
  });
  Object.defineProperty(event, "target", { value: open.containerEl });

  open.creation.key(event);

  expect(event.defaultPrevented).toBe(false);
});

it("writes nothing under a block, and leaves the notice to the binding", async () => {
  using open = reader({
    capability: { kind: "read-only", reason: "zotero-unavailable" },
  });
  await open.selectText();

  open.press("h");
  await open.creation.created;

  expect(open.drafts).toEqual([]);
});

it("arms nothing under a block, so the toolbar does not answer the notice back", () => {
  using open = reader({
    capability: { kind: "read-only", reason: "zotero-unavailable" },
  });
  open.creation.mountToolbar(open.slot);

  open.press("u");
  open.press("5");

  expect(
    open.slot
      .querySelector('[data-zt-tool="underline"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("dismisses the popup on the next press", async () => {
  using open = reader();
  await open.selectText();

  open.pressEmpty();

  expect(open.popup()).toBeNull();
});

it("stands the popup down when the selection collapses", async () => {
  using open = reader();
  await open.selectText();

  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 0,
    isCollapsed: true,
  } as never);
  open.creation.changed();

  expect(open.popup()).toBeNull();
});

it("keeps the popup while the comment sheet holds the caret", async () => {
  using open = reader();
  await open.selectText();
  open.press("c");

  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 0,
    isCollapsed: true,
  } as never);
  open.creation.changed();

  expect(open.popup()).not.toBeNull();
});

it("takes the marks off the pages and puts them back", () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);

  const visibility = open.slot.querySelector<HTMLElement>(
    '[data-zt-tool="visibility"]',
  )!;
  visibility.click();
  expect(open.surfaceState.getState().marksVisible).toBe(false);

  open.slot.querySelector<HTMLElement>('[data-zt-tool="visibility"]')!.click();
  expect(open.surfaceState.getState().marksVisible).toBe(true);
});

it("leaves the toolbar slot as Obsidian built it when it is disposed", () => {
  const open = reader();
  open.creation.mountToolbar(open.slot);
  expect(open.slot.childElementCount).toBe(1);

  open.creation[Symbol.dispose]();

  expect(open.slot.childElementCount).toBe(0);
});

it("closes the create popup and drops its selection on a press on the page", async () => {
  using open = reader();
  await open.selectText();
  expect(open.popup()).not.toBeNull();

  open.pageEl.dispatchEvent(
    new MouseEvent("pointerdown", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );

  expect(open.popup()).toBeNull();
  // Nothing waits any more, so the tool key arms rather than commits.
  open.press("h");
  await open.creation.created;
  expect(open.drafts).toEqual([]);
});

it("keeps the comment sheet and its text through capability announcements", async () => {
  using open = reader();
  await open.selectText();
  open.press("c");
  const editor = commentView(open.popup()!)!;
  editor.dispatch({ changes: { from: 0, insert: "worth quoting" } });

  ingestCapability(open.surfaceState, { kind: "writable" }, NOW);
  expect(commentView(open.popup()!)).toBe(editor);

  // A real block stands the sheet down where it is, rather than rebuilding it.
  ingestCapability(
    open.surfaceState,
    { kind: "read-only", reason: "zotero-unavailable" },
    NOW,
  );
  expect(commentView(open.popup()!)).toBe(editor);
  expect(editor.state.doc.toString()).toBe("worth quoting");
  expect(editor.state.readOnly).toBe(true);
});

it("ignores a drag released while an armed create is still in flight", async () => {
  let answer = () => {};
  using open = reader({
    answered: new Promise<void>((resolve) => {
      answer = resolve;
    }),
  });
  open.press("u");
  open.startSelecting();
  await open.creation.settled;
  const first = open.creation.created;

  open.startSelecting();
  await open.creation.settled;
  expect(open.creation.created).toBe(first);

  answer();
  await open.creation.created;
  expect(open.drafts).toHaveLength(1);
});

it("drops the waiting selection once its page leaves the screen", async () => {
  using open = reader();
  await open.selectText();
  expect(open.popup()).not.toBeNull();

  open.pageEl.getBoundingClientRect = () =>
    ({ ...PAGE_BOX, top: -5000, bottom: -4000 }) as never;
  open.containerEl.dispatchEvent(new Event("scroll"));

  expect(open.popup()).toBeNull();
  expect(open.surfaceState.getState().floating).toEqual({ kind: "none" });
});

it("refuses an image create from a text selection, and offers the popup instead", async () => {
  using open = reader();
  arm(open.surfaceState, "image");

  await open.selectText();
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.popup()).not.toBeNull();
});

/**
 * One reader with the image tool armed from its toolbar, over a US Letter page
 * laid out at its own size at the client origin: a client point `(x, y)` is
 * the PDF point `(x, 792 - y)`. The highlight on it draws round client
 * `(300, 177)`.
 */
function imageReader(
  capability?: EditingCapability,
  {
    create = async () => ({ kind: "created", annotationKey: "MADE2345" }),
    colors,
    closed = false,
    structure: given,
  }: {
    /** What Zotero answers each create with. */
    create?: (
      draft: Omit<AnnotationDraft, "parentKey">,
    ) => Promise<CreateOutcome>;
    /** Each tool's colour and the ink width; held in memory unless given. */
    colors?: ToolColorStore;
    /** Whether the viewer holds no document, so no text structure stands. */
    closed?: boolean;
    /** The text structure the viewer holds on each ask, in place of the stub below. */
    structure?: () => PdfTextStructure | null;
  } = {},
) {
  vi.useFakeTimers();
  const containerEl = document.body.createDiv();
  const page = pageView();
  containerEl.append(page.div);
  page.div.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 612,
      bottom: 792,
      width: 612,
      height: 792,
    }) as DOMRect;
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 0,
    isCollapsed: true,
    removeAllRanges: () => undefined,
  } as never);
  const drafts: Omit<AnnotationDraft, "parentKey">[] = [];
  const structure = {
    page: vi.fn(async () => ({})),
    pageLabels: vi.fn(async () => ["1"]),
    sortIndex: vi.fn(async () => "00000|000100|00100"),
    pageLabel: vi.fn(async () => "1"),
  };
  const surfaces = readerSurfaces({
    containerEl,
    colors,
    page: page as unknown as OverlayPageView,
    records: [
      annotation("PUPR5FG5", "highlight", {
        pageIndex: 0,
        rects: [[265.833, 611.202, 374.503, 620.019]],
      }),
    ],
    capability,
    structure: closed ? null : (given ?? (structure as never)),
    annotations: {
      ...annotationEdits(),
      createAnnotation: vi.fn(
        async (
          _key: string,
          draft: Omit<AnnotationDraft, "parentKey">,
        ): Promise<CreateOutcome> => {
          drafts.push(draft);
          return await create(draft);
        },
      ),
    },
  });
  const slot = document.body.createDiv();
  surfaces.creation.mountToolbar(slot);
  // Armed as a researcher arms it, from the toolbar; the arm itself stands
  // outside any block, which only the capture has to answer.
  arm(surfaces.store, "image");

  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    [x, y]: [number, number],
    pointerId = 1,
  ) =>
    (type === "pointerdown" ? page.div : containerEl).dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  return {
    ...surfaces,
    containerEl,
    slot,
    drafts,
    structure,
    pointer,
    /** One drag from a client point to another, released there. */
    async drag(from: [number, number], to: [number, number]) {
      pointer("pointerdown", from);
      pointer("pointermove", to);
      pointer("pointerup", to);
      await surfaces.creation.created;
    },
    key(name: string) {
      containerEl.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [Symbol.dispose]() {
      surfaces[Symbol.dispose]();
      containerEl.remove();
    },
  };
}

it("creates nothing from a capture released under ten points on a side", async () => {
  using open = imageReader();

  await open.drag([100, 100], [109, 300]);

  expect(open.drafts).toEqual([]);
  expect(open.store.getState()).toMatchObject({
    floating: { kind: "none" },
    armed: "image",
  });
});

it("creates an image from a capture of ten points or more, then stands the tool down", async () => {
  using open = imageReader();

  await open.drag([300, 292], [100, 100]);

  const position = { pageIndex: 0, rects: [[100, 500, 300, 692]] };
  expect(open.structure.sortIndex).toHaveBeenCalledWith(position);
  expect(open.structure.pageLabel).toHaveBeenCalledWith(0, expect.any(Array));
  expect(open.drafts).toEqual([
    {
      type: "image",
      color: open.store.getState().colors.image,
      comment: "",
      text: "",
      pageLabel: "1",
      sortIndex: "00000|000100|00100",
      position,
    },
  ]);
  expect(open.revealed).toEqual(["MADE2345"]);
  expect(open.store.getState()).toMatchObject({
    floating: { kind: "none" },
    armed: null,
  });
  expect(
    open.slot
      .querySelector('[data-zt-tool="image"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("cancels a capture on Escape and keeps the tool; a second Escape stands it down", async () => {
  using open = imageReader();

  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointermove", [300, 300]);
  open.key("Escape");
  open.pointer("pointerup", [300, 300]);
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.store.getState()).toMatchObject({
    floating: { kind: "none" },
    armed: "image",
  });
  open.key("Escape");
  expect(open.store.getState().armed).toBeNull();
});

it("reports a press while editing is not live, and captures nothing", async () => {
  using open = imageReader({
    kind: "read-only",
    reason: "zotero-unavailable",
  });

  await open.drag([100, 100], [300, 300]);

  expect(open.gestures.reportBlockedGesture).toHaveBeenCalledOnce();
  expect(open.drafts).toEqual([]);
  expect(open.store.getState().floating).toEqual({ kind: "none" });
});

it("leaves a press on a mark to the mark while the image tool is armed", async () => {
  using open = imageReader();

  open.pointer("pointerdown", [300, 177]);
  open.pointer("pointerup", [300, 177]);
  open.containerEl.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 177, bubbles: true }),
  );
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.store.getState().floating).toMatchObject({
    kind: "selected",
    key: "PUPR5FG5",
  });
});

/**
 * The image reader with another tool armed from its toolbar instead. A client
 * point `(x, y)` is the PDF point `(x, 792 - y)`.
 */
function toolReader(
  tool: "note" | "text" | "ink",
  ...args: Parameters<typeof imageReader>
) {
  const open = imageReader(...args);
  open.slot.querySelector<HTMLElement>(`[data-zt-tool="${tool}"]`)!.click();
  return open;
}

it("places a 22-point note centred on a click, opens its comment, and stands the tool down", async () => {
  using open = toolReader("note");

  // Released within the click slop: the note sits on the press point.
  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [102, 101]);
  await open.creation.created;

  const position = { pageIndex: 0, rects: [[89, 681, 111, 703]] };
  expect(open.structure.sortIndex).toHaveBeenCalledWith(position);
  expect(open.drafts).toEqual([
    {
      type: "note",
      color: "#ffd400",
      comment: "",
      text: "",
      pageLabel: "1",
      sortIndex: "00000|000100|00100",
      position,
    },
  ]);
  expect(open.revealed).toEqual(["MADE2345"]);
  expect(open.revealedWith).toEqual([{ commenting: true }]);
  expect(open.store.getState().armed).toBeNull();
  expect(
    open.slot
      .querySelector('[data-zt-tool="note"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("leaves a note by the page edge unclamped, as Zotero does", async () => {
  using open = toolReader("note");

  open.pointer("pointerdown", [5, 787]);
  open.pointer("pointerup", [5, 787]);
  await open.creation.created;

  expect(open.drafts.map(({ position }) => position)).toEqual([
    { pageIndex: 0, rects: [[-6, -6, 16, 16]] },
  ]);
});

it("creates no note from a drag, and stays armed", async () => {
  using open = toolReader("note");

  await open.drag([100, 100], [140, 100]);

  expect(open.drafts).toEqual([]);
  expect(open.store.getState().armed).toBe("note");
});

it("takes a note press from the browser, so a drag under it selects no text", () => {
  using open = toolReader("note");

  const pressTaken = !open.pointer("pointerdown", [100, 100]);
  const selectStart = new Event("selectstart", {
    bubbles: true,
    cancelable: true,
  });
  open.containerEl.dispatchEvent(selectStart);

  expect(pressTaken).toBe(true);
  expect(selectStart.defaultPrevented).toBe(true);
});

it.each([
  [
    "a second pointer's press",
    (open: ReturnType<typeof imageReader>) =>
      open.pointer("pointerdown", [200, 200], 2),
  ],
  [
    "a pointer cancel",
    (open: ReturnType<typeof imageReader>) =>
      open.pointer("pointercancel", [100, 100]),
  ],
  [
    "a lost capture",
    (open: ReturnType<typeof imageReader>) =>
      open.containerEl.dispatchEvent(
        new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }),
      ),
  ],
  [
    "a tool change",
    (open: ReturnType<typeof imageReader>) => arm(open.store, "highlight"),
  ],
  [
    "the tool standing down",
    (open: ReturnType<typeof imageReader>) => open.key("Escape"),
  ],
])("creates no note from a press %s discarded", async (_, discard) => {
  using open = toolReader("note");

  open.pointer("pointerdown", [100, 100]);
  discard(open);
  open.pointer("pointerup", [100, 100]);
  open.pointer("pointerup", [200, 200], 2);
  await open.creation.created;

  expect(open.drafts).toEqual([]);
});

it("reports a note press while editing is not live, and creates nothing", async () => {
  // Armed while editing was live, and blocked since.
  using open = toolReader("note");
  ingestCapability(
    open.store,
    { kind: "read-only", reason: "zotero-unavailable" },
    NOW,
  );

  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [100, 100]);
  await open.creation.created;

  expect(open.gestures.reportBlockedGesture).toHaveBeenCalledOnce();
  expect(open.drafts).toEqual([]);
});

it("leaves a press on a mark to the mark while the note tool is armed", async () => {
  using open = toolReader("note");

  open.pointer("pointerdown", [300, 177]);
  open.pointer("pointerup", [300, 177]);
  open.containerEl.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 177, bubbles: true }),
  );
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.store.getState().floating).toMatchObject({
    kind: "selected",
    key: "PUPR5FG5",
  });
});

it("creates one ink stroke as Zotero smooths it, and stays armed", async () => {
  using open = toolReader("ink");

  await open.drag([100, 100], [110, 100]);

  // Two Chaikin passes over (100, 692)–(110, 692) cut at 100.625, 101.875,
  // 103.75, 106.25, 108.125 and 109.375; the points under one point from the
  // last kept one — 100.625, and the end at 110 — go.
  const position = {
    pageIndex: 0,
    width: 2,
    paths: [
      [
        100, 692, 101.875, 692, 103.75, 692, 106.25, 692, 108.125, 692, 109.375,
        692,
      ],
    ],
  };
  expect(open.structure.sortIndex).toHaveBeenCalledWith(position);
  expect(open.drafts).toEqual([
    {
      type: "ink",
      color: "#2ea8e5",
      comment: "",
      text: "",
      pageLabel: "1",
      sortIndex: "00000|000100|00100",
      position,
    },
  ]);
  expect(open.revealed).toEqual([]);
  expect(open.store.getState()).toMatchObject({
    floating: { kind: "none" },
    armed: "ink",
    liveStroke: null,
  });
});

it("stores a tap as its one point", async () => {
  using open = toolReader("ink");

  await open.drag([100, 100], [100.4, 100]);

  expect(open.drafts.map(({ position }) => position)).toEqual([
    { pageIndex: 0, width: 2, paths: [[100, 692]] },
  ]);
});

it("keeps a stroke run off the page on the page it began on", async () => {
  using open = toolReader("ink");

  await open.drag([600, 100], [700, 100]);

  // The move is taken at the page's right edge, x = 612; the smoothing cuts
  // (600, 612) at 611.25 and drops the end, 0.75 points on.
  const { position } = open.drafts[0]!;
  const [path] = "paths" in position ? position.paths : [];
  expect(Math.max(...path!.filter((_, index) => index % 2 === 0))).toBe(611.25);
});

it("discards a stroke on Escape and keeps the tool; a second Escape stands it down", async () => {
  using open = toolReader("ink");

  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointermove", [150, 150]);
  open.key("Escape");
  open.pointer("pointerup", [150, 150]);
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.store.getState()).toMatchObject({
    armed: "ink",
    liveStroke: null,
    pendingStrokes: [],
  });
  open.key("Escape");
  expect(open.store.getState().armed).toBeNull();
});

it.each([
  [
    "a second pointer's press",
    (open: ReturnType<typeof imageReader>) =>
      open.pointer("pointerdown", [200, 200], 2),
  ],
  [
    "a pointer cancel",
    (open: ReturnType<typeof imageReader>) =>
      open.pointer("pointercancel", [150, 150]),
  ],
  [
    "a lost capture",
    (open: ReturnType<typeof imageReader>) =>
      open.containerEl.dispatchEvent(
        new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }),
      ),
  ],
  [
    "a tool change",
    (open: ReturnType<typeof imageReader>) => arm(open.store, "highlight"),
  ],
])("creates nothing from a stroke %s discarded", async (_, discard) => {
  using open = toolReader("ink");

  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointermove", [150, 150]);
  discard(open);
  open.pointer("pointerup", [150, 150]);
  open.pointer("pointerup", [200, 200], 2);
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.store.getState().liveStroke).toBeNull();
});

/** The ink reader, armed while editing was live and blocked since. */
function blockedInkReader() {
  const open = toolReader("ink");
  ingestCapability(
    open.store,
    { kind: "read-only", reason: "zotero-unavailable" },
    NOW,
  );
  return open;
}

it("reports a press while editing is not live, and draws nothing", async () => {
  using open = blockedInkReader();

  open.pointer("pointerdown", [100, 100]);
  expect(open.store.getState().liveStroke).toBeNull();
  open.pointer("pointerup", [150, 150]);
  await open.creation.created;

  expect(open.gestures.reportBlockedGesture).toHaveBeenCalledOnce();
  expect(open.drafts).toEqual([]);
});

it("leaves a mark unselected under a press while editing is not live", async () => {
  using open = blockedInkReader();

  open.pointer("pointerdown", [300, 177]);
  open.pointer("pointerup", [300, 177]);
  open.containerEl.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 177, bubbles: true }),
  );

  expect(open.store.getState().floating).toEqual({ kind: "none" });
});

it("saves a stroke in the colour it was pressed in", async () => {
  using open = toolReader("ink");
  const pressed = open.store.getState().colors.ink;

  open.pointer("pointerdown", [100, 100]);
  open.key("5");
  open.pointer("pointerup", [100, 100]);
  await vi.waitFor(() => expect(open.drafts).toHaveLength(1));

  expect(open.store.getState().colors.ink).toBe(ANNOTATION_COLORS[4]);
  expect(pressed).not.toBe(ANNOTATION_COLORS[4]);
  expect(open.drafts[0]!.color).toBe(pressed);
});

it("creates an image while an ink stroke still saves", async () => {
  const inkAnswers: ((outcome: CreateOutcome) => void)[] = [];
  using open = toolReader("ink", undefined, {
    create: async (draft) =>
      draft.type === "ink"
        ? await new Promise((resolve) => inkAnswers.push(resolve))
        : { kind: "created", annotationKey: "MADE2345" },
  });
  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [100, 100]);
  await vi.waitFor(() => expect(inkAnswers).toHaveLength(1));

  arm(open.store, "image");
  await open.drag([300, 292], [100, 100]);

  expect(open.drafts.map(({ type }) => type)).toEqual(["ink", "image"]);
  expect(open.revealed).toEqual(["MADE2345"]);
  inkAnswers[0]!({ kind: "created", annotationKey: "INK12345" });
});

it("draws over a mark and leaves the mark unselected", async () => {
  using open = toolReader("ink");

  open.pointer("pointerdown", [300, 177]);
  open.pointer("pointerup", [300, 177]);
  open.containerEl.dispatchEvent(
    new MouseEvent("click", { clientX: 300, clientY: 177, bubbles: true }),
  );
  await open.creation.created;

  expect(open.drafts.map(({ type }) => type)).toEqual(["ink"]);
  expect(open.store.getState().floating).toEqual({ kind: "none" });
});

it("draws while an earlier stroke saves, and creates in release order", async () => {
  const answers: (() => void)[] = [];
  using open = toolReader("ink", undefined, {
    create: () =>
      new Promise((resolve) =>
        answers.push(() =>
          resolve({ kind: "created", annotationKey: `MADE${answers.length}` }),
        ),
      ),
  });

  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [100, 100]);
  open.pointer("pointerdown", [200, 200]);
  open.pointer("pointerup", [200, 200]);
  await vi.waitFor(() => expect(open.drafts).toHaveLength(1));

  // The second stroke waits on the first create, and both stay on the page.
  expect(
    open.store.getState().pendingStrokes.map(({ paths }) => paths),
  ).toEqual([[[100, 692]], [[200, 592]]]);
  answers[0]!();
  await vi.waitFor(() => expect(open.drafts).toHaveLength(2));
  answers[1]!();
  await open.creation.created;

  expect(open.drafts.map(({ position }) => position)).toEqual([
    { pageIndex: 0, width: 2, paths: [[100, 692]] },
    { pageIndex: 0, width: 2, paths: [[200, 592]] },
  ]);
});

it("takes a refused stroke off the page", async () => {
  using open = toolReader("ink", undefined, {
    create: async () => ({
      kind: "failed",
      failure: { kind: "position-too-large" },
    }),
  });

  await open.drag([100, 100], [150, 150]);

  expect(open.drafts).toHaveLength(1);
  expect(open.store.getState().pendingStrokes).toEqual([]);
});

it("takes a stroke off the page and says why when editing lapsed while it waited", async () => {
  const answers: (() => void)[] = [];
  using open = toolReader("ink", undefined, {
    create: () =>
      new Promise((resolve) =>
        answers.push(() =>
          resolve({ kind: "created", annotationKey: "MADE2345" }),
        ),
      ),
  });
  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [100, 100]);
  open.pointer("pointerdown", [200, 200]);
  open.pointer("pointerup", [200, 200]);
  await vi.waitFor(() => expect(answers).toHaveLength(1));

  // The second stroke was released while editing was live, and waits.
  ingestCapability(
    open.store,
    { kind: "read-only", reason: "zotero-unavailable" },
    NOW,
  );
  answers[0]!();
  await open.creation.created;

  expect(open.drafts).toHaveLength(1);
  expect(open.gestures.reportBlockedGesture).toHaveBeenCalledOnce();
  // The first stroke saved and waits on the read; the second is gone.
  expect(open.store.getState().pendingStrokes.map(({ key }) => key)).toEqual([
    "MADE2345",
  ]);
});

it("takes a stroke off the page when the viewer holds no document", async () => {
  using open = toolReader("ink", undefined, { closed: true });

  await open.drag([100, 100], [150, 150]);

  expect(open.drafts).toEqual([]);
  expect(open.gestures.reportBlockedGesture).not.toHaveBeenCalled();
  expect(open.store.getState().pendingStrokes).toEqual([]);
});

it("takes a stroke off the page when its create throws, and creates the next", async () => {
  let throws = true;
  using open = toolReader("ink", undefined, {
    create: async () => {
      if (throws) throw new Error("The request did not run");
      return { kind: "created", annotationKey: "MADE2345" };
    },
  });

  await open.drag([100, 100], [150, 150]);
  expect(open.store.getState().pendingStrokes).toEqual([]);

  throws = false;
  await open.drag([200, 200], [250, 250]);
  expect(open.drafts).toHaveLength(2);
});

/** The menu label of one ink width. */
const step = (width: number) =>
  m.pdf_toolbar_ink_width_step({ width: String(width) });

/** The ink tool's chevron menu, opened from the toolbar as a researcher opens it. */
function inkMenu(open: ReturnType<typeof toolReader>) {
  open.slot.querySelector<HTMLElement>('[data-zt-tool="ink-color"]')!.click();
  const { items } = Menu.instances.at(-1)!;
  return {
    checked: items.filter(({ checked }) => checked).map(({ title }) => title),
    pick: (title: string) =>
      items.find((item) => item.title === title)!.click(),
    items,
  };
}

it("offers the ink widths under the colours, the current one checked, and draws at the one picked", async () => {
  using open = toolReader("ink");

  const menu = inkMenu(open);
  expect(
    menu.items.slice(ANNOTATION_COLORS.length).map(({ title }) => title),
  ).toEqual([
    m.pdf_toolbar_ink_width(),
    // Zotero's own width steps, the short run the ink tool offers.
    ...[0.4, 1, 2, 3, 5, 8, 12].map(step),
  ]);
  expect(menu.items[ANNOTATION_COLORS.length]!.isLabel).toBe(true);
  // One colour and one width stand checked: the ink colour, and width 2.
  expect(menu.checked).toHaveLength(2);
  expect(menu.checked.at(-1)).toBe(step(2));
  menu.pick(step(5));
  await open.drag([100, 100], [100.4, 100]);

  expect(open.drafts.map(({ position }) => position)).toEqual([
    { pageIndex: 0, width: 5, paths: [[100, 692]] },
  ]);
  expect(inkMenu(open).checked.at(-1)).toBe(step(5));
});

it("keeps the picked ink width in the settings, so the next PDF draws at it", async () => {
  const settings = readerSettings();
  expect(toolColorStore(settings).inkWidth()).toBe(2);
  {
    using first = toolReader("ink", undefined, {
      colors: toolColorStore(settings),
    });
    inkMenu(first).pick(step(8));
  }

  expect(settings.current?.["reader.ink-width"]).toBe(8);
  using next = toolReader("ink", undefined, {
    colors: toolColorStore(settings),
  });
  await next.drag([100, 100], [100.4, 100]);
  expect(next.drafts.map(({ position }) => position)).toEqual([
    { pageIndex: 0, width: 8, paths: [[100, 692]] },
  ]);
});

it("finishes a stroke that reaches the position ceiling as its own Annotation, and draws on with the pointer held", async () => {
  using open = toolReader("ink");
  // A zig-zag scribble of three-point steps, row after row, as long as about
  // one and a half Annotations hold.
  const samples = Array.from({ length: 3000 }, (_, index): [number, number] => {
    const row = Math.floor(index / 150);
    const column = index % 150;
    return [
      100 + 3 * (row % 2 === 0 ? column : 149 - column),
      60 + 12 * row + (index % 2) * 5,
    ];
  });

  open.pointer("pointerdown", samples[0]!);
  for (const sample of samples.slice(1)) open.pointer("pointermove", sample);
  await vi.waitFor(() => expect(open.drafts).toHaveLength(1));

  // The pointer still draws, and the tool is still armed.
  expect(open.creation.capturing).toBe(true);
  expect(open.store.getState()).toMatchObject({ armed: "ink" });
  open.pointer("pointerup", samples.at(-1)!);
  await vi.waitFor(() => expect(open.drafts).toHaveLength(2));
  await open.creation.created;

  const [first, second] = open.drafts.map(({ position }) => position);
  expect(writePosition(first!).length).toBeLessThanOrEqual(MAX_POSITION_LENGTH);
  expect(first).toMatchObject({ pageIndex: 0, width: 2 });
  expect(second).toMatchObject({ pageIndex: 0, width: 2 });
  const firstPath = "paths" in first! ? first.paths[0]! : [];
  const secondPath = "paths" in second! ? second.paths[0]! : [];
  // The second part begins where the first one ends, so the two meet.
  expect(secondPath.slice(0, 2)).toEqual(firstPath.slice(-2));
  expect(firstPath.slice(0, 2)).toEqual([samples[0]![0], 792 - samples[0]![1]]);
  expect(open.store.getState()).toMatchObject({
    armed: "ink",
    liveStroke: null,
  });
});

/**
 * A 2D context that sets each character half a font size wide. happy-dom has
 * no canvas to measure the interface font with.
 */
function halfEmContext() {
  let fontSize = 0;
  return {
    set font(font: string) {
      fontSize = Number.parseFloat(font);
    },
    measureText: (text: string) => ({ width: (text.length * fontSize) / 2 }),
  };
}

/**
 * Opens a Text Draft with a click on page one, and types `text` into it as
 * its textarea's input hands it on, measured by {@link halfEmContext}.
 */
function typeDraft(open: ReturnType<typeof toolReader>, text: string) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    halfEmContext() as never,
  );
  open.pointer("pointerdown", [100, 100]);
  open.pointer("pointerup", [100, 100]);
  open.creation.typeDraft(text);
}

/**
 * One text page with no characters, read from a document the view can close.
 * After `close()` the viewer holds no document, as Obsidian's own unload
 * leaves it before ZotLit's disposal runs, and every read rejects, as PDF.js
 * rejects on a destroyed document.
 */
function closingDocument() {
  let closed = false;
  const read = async <T>(value: T): Promise<T> => {
    if (closed) throw new Error("Worker was destroyed");
    return value;
  };
  const source: PdfPageSource = {
    numPages: 1,
    getViewBox: () => read([0, 0, 612, 792]),
    getTextItems: () => read([]),
    getCatalogPageLabels: () => read(null),
  };
  const structure = new PdfTextStructure(source);
  return {
    structure: () => (closed ? null : structure),
    /** Settles once the reads a click on page one started have answered. */
    read: async () => {
      await Promise.all([structure.page(0), structure.pageLabels()]);
    },
    close: () => {
      closed = true;
    },
  };
}

it("says why when a Text Draft's create throws, and takes the draft off the page", async () => {
  using open = toolReader("text", undefined, {
    create: async () => {
      throw new Error("The request did not run");
    },
  });

  typeDraft(open, "Typed");
  open.key("Escape");
  await open.creation.created;

  expect(open.drafts).toHaveLength(1);
  expect(open.reportCreateFailure.mock.calls).toEqual([
    [m.annot_view_write_reason_unknown_outcome()],
  ]);
  expect(selectTextDraft(open.store.getState())).toBeNull();
});

it("says why when no document stands to create a Text Draft from", async () => {
  using open = toolReader("text", undefined, { closed: true });

  typeDraft(open, "Typed");
  open.key("Escape");
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  expect(open.reportCreateFailure.mock.calls).toEqual([
    [m.pdf_create_reason_no_document()],
  ]);
  expect(selectTextDraft(open.store.getState())).toBeNull();
});

it("says why a Text Draft finished after editing lapsed was not created", async () => {
  using open = toolReader("text");
  const lapsed: EditingCapability = {
    kind: "read-only",
    reason: "zotero-unavailable",
  };

  typeDraft(open, "Typed");
  ingestCapability(open.store, lapsed, NOW);
  open.key("Escape");
  await open.creation.created;

  expect(open.drafts).toEqual([]);
  // The typed text is lost, so the create failure names the block.
  expect(open.reportCreateFailure.mock.calls).toEqual([
    [blockedReason(lapsed, NOW)],
  ]);
  expect(open.gestures.reportBlockedGesture).not.toHaveBeenCalled();
  expect(selectTextDraft(open.store.getState())).toBeNull();
});

it("creates a Text Draft finished as the view closes, from the page it read at the click", async () => {
  const document_ = closingDocument();
  const open = toolReader("text", undefined, {
    structure: document_.structure,
  });
  {
    using _closing = open;
    typeDraft(open, "Typed");
    // The reads the click started run to their end before the view closes.
    await document_.read();
    document_.close();
  }
  await open.creation.created;

  expect(open.reportCreateFailure).not.toHaveBeenCalled();
  expect(open.drafts).toEqual([
    {
      type: "text",
      color: open.store.getState().colors.text,
      comment: "Typed",
      text: "",
      pageLabel: "1",
      sortIndex: expect.stringMatching(/^00000\|/),
      position: {
        pageIndex: 0,
        fontSize: 14,
        rotation: 0,
        rects: [expect.any(Array)],
      },
    },
  ]);
  // The box the typing refit: five characters half a font size wide, and
  // Zotero's five points past them.
  const [box] = (open.drafts[0]!.position as TextPosition).rects;
  expect(box![2]! - box![0]!).toBeCloseTo(40, 2);
});
