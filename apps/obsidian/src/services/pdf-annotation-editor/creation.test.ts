// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import { afterEach, expect, it, vi } from "vitest";

import type { SelectedText, TextSelection } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationDraft,
  CreateOutcome,
} from "@/services/annotation-repository/service";

import { annotation, toolColors } from "./__fixtures__";
import { MarkCreation } from "./creation";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

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
  const revealed: string[] = [];
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
  let capability = options.capability ?? ({ kind: "writable" } as const);

  const creation = new MarkCreation({
    containerEl,
    parent: { hoverPopover: null },
    attachmentKey: "RGRPDF24",
    pages: () => [
      {
        pageIndex: 0,
        view: {
          div: pageEl,
          viewport: {
            transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
          },
        } as never,
      },
    ],
    records: () => [
      annotation("PUPR5FG5", "highlight", {
        pageIndex: 0,
        rects: [[265.833, 611.202, 374.503, 620.019]],
      }),
    ],
    structure: () => structure as never,
    repaint: vi.fn(),
    reveal: (annotationKey) => revealed.push(annotationKey),
    renderCapability: vi.fn(),
    colors: toolColors(),
    annotations: {
      capabilityFor: () => capability,
      createAnnotation: vi.fn(async (_key: string, draft) => {
        drafts.push(draft);
        return (
          options.outcome ?? { kind: "created", annotationKey: "MADE2345" }
        );
      }),
      on: () => () => undefined,
    } as never,
    now: () => NOW,
  });

  return {
    creation,
    containerEl,
    pageEl,
    drafts,
    sorted,
    selections,
    revealed,
    structure,
    slot: document.body.createDiv(),
    setCapability(next: EditingCapability) {
      capability = next;
    },
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
      creation[Symbol.dispose]();
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
    ...ANNOTATION_COLORS.map((_, index) => `color-${index + 1}`),
    "comment",
    "copy",
  ]);
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
  const editor = open.popup()!.querySelector("textarea")!;
  editor.value = "worth quoting";
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
  );
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

  open.popup()!.querySelector<HTMLElement>('[data-zt-verb="color-6"]')!.click();

  expect(
    open.slot.querySelector<HTMLElement>('[data-zt-tool="highlight"]')?.style
      .color,
  ).toBe(ANNOTATION_COLORS[5]);
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

  open.popup()!.querySelector<HTMLElement>('[data-zt-verb="color-6"]')!.click();

  expect(
    open.slot.querySelector<HTMLElement>('[data-zt-tool="highlight"]')?.style
      .color,
  ).toBe(ANNOTATION_COLORS[5]);
});

it("steps back one level on Escape: sheet, then popup, then the armed tool", async () => {
  using open = reader();
  open.creation.mountToolbar(open.slot);
  await open.selectText();
  open.press("c");
  expect(open.popup()!.querySelector("textarea")).not.toBeNull();

  open.press("Escape");
  expect(open.popup()!.querySelector("textarea")).toBeNull();

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
  expect(open.creation.marksVisible).toBe(false);

  open.slot.querySelector<HTMLElement>('[data-zt-tool="visibility"]')!.click();
  expect(open.creation.marksVisible).toBe(true);
});

it("leaves the toolbar slot as Obsidian built it when it is disposed", () => {
  const open = reader();
  open.creation.mountToolbar(open.slot);
  expect(open.slot.childElementCount).toBe(1);

  open.creation[Symbol.dispose]();

  expect(open.slot.childElementCount).toBe(0);
});
