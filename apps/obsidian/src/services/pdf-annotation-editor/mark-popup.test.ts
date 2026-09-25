// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { annotation } from "./__fixtures__";
import { MarkPopup, markPopupRow, renderMarkPopupRow } from "./mark-popup";
import type { MarkPopupControlId, MarkPopupRow } from "./mark-popup";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const HIGHLIGHT: AnnotationRecord = {
  ...annotation("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [[265.833, 611.202, 374.503, 620.019]],
  }),
  text: "a quoted sentence",
};

function row(
  overrides: {
    annotation?: AnnotationRecord;
    capability?: EditingCapability;
    mutation?: MutationState;
    stack?: { index: number; total: number };
  } = {},
): MarkPopupRow {
  return markPopupRow({
    annotation: overrides.annotation ?? HIGHLIGHT,
    capability: overrides.capability ?? { kind: "writable" },
    mutation: overrides.mutation ?? IDLE,
    stack: overrides.stack ?? { index: 0, total: 1 },
    commenting: false,
    now: NOW,
  });
}

/** Each verb, as its id beside whether it runs and what its tooltip says. */
function verbs(
  built: MarkPopupRow,
): Partial<Record<string, [boolean, string]>> {
  return Object.fromEntries(
    built.verbs.map((verb) => [verb.id, [verb.disabled, verb.tooltip]]),
  );
}

describe("markPopupRow", () => {
  it("draws one row of verbs: colour, comment, copy, delete, reveal", () => {
    expect(row().verbs.map(({ id, icon }) => [id, icon])).toEqual([
      ["color", "palette"],
      ["comment", "message-square-plus"],
      ["copy", "copy"],
      ["delete", "trash-2"],
      ["reveal", "panel-right-open"],
    ]);
  });

  it("says which comment verb it is, and wears the Annotation's colour", () => {
    const commented = { ...HIGHLIGHT, comment: "a note of my own" };
    expect(row({ annotation: commented }).verbs[1]).toEqual({
      id: "comment",
      icon: "message-square",
      pressed: false,
      tooltip: "Edit comment",
      disabled: false,
    });
    expect(row().color).toBe("#2ea8e5");
  });

  it("stands the three writes down under a block, and says why in each", () => {
    const built = row({
      capability: { kind: "read-only", reason: "library-read-only" },
    });
    const reason = "You do not have write access to this library.";
    expect(verbs(built)).toEqual({
      color: [true, reason],
      comment: [true, reason],
      copy: [false, "Copy annotation text"],
      delete: [true, reason],
      reveal: [false, "Reveal in the annotation view"],
    });
  });

  it("stands them down while a write of its own is in flight", () => {
    const built = row({ mutation: { kind: "pending", write: "color" } });
    expect(verbs(built).delete).toEqual([true, "Saving to Zotero…"]);
  });

  it("keeps copying off a mark that carries no text", () => {
    const image = { ...HIGHLIGHT, text: null };
    expect(verbs(row({ annotation: image })).copy?.[0]).toBe(true);
  });

  it("offers the stepper only where marks overlap, counting from one", () => {
    expect(row().stepper).toBeNull();
    expect(row({ stack: { index: 1, total: 3 } }).stepper).toEqual({
      tooltip: "Next mark here (2 of 3)",
      text: "2/3",
    });
  });
});

describe("renderMarkPopupRow", () => {
  function draw(built: MarkPopupRow) {
    const node = document.createElement("div");
    const pressed: MarkPopupControlId[] = [];
    renderMarkPopupRow(node, built, (id) => pressed.push(id));
    return { node, pressed };
  }

  function controls(node: HTMLElement): (string | undefined)[] {
    return [...node.querySelectorAll<HTMLElement>("[data-zt-verb]")].map(
      (control) => control.dataset.ztVerb,
    );
  }

  it("draws every control in order, with the stepper last", () => {
    const { node } = draw(row({ stack: { index: 0, total: 2 } }));
    expect(controls(node)).toEqual([
      "color",
      "comment",
      "copy",
      "delete",
      "reveal",
      "stack",
    ]);
    expect(node.querySelector("[data-zt-verb='stack']")?.textContent).toBe(
      "1/2",
    );
  });

  it("replaces what the row held, so a redraw leaves no second row", () => {
    const { node } = draw(row());
    renderMarkPopupRow(node, row({ stack: { index: 0, total: 2 } }), () => {});
    expect(controls(node)).toHaveLength(6);
  });

  it("gives the palette the Annotation's own colour", () => {
    const { node } = draw(row());
    expect(
      node.querySelector<HTMLElement>("[data-zt-verb='color']")?.style.color,
    ).toBe("#2ea8e5");
  });

  it("runs the gesture a live control was pressed with", () => {
    const { node, pressed } = draw(row());
    node.querySelector<HTMLElement>("[data-zt-verb='delete']")?.click();
    expect(pressed).toEqual(["delete"]);
  });

  it("keeps a blocked verb in its seat, inert and saying so", () => {
    const { node, pressed } = draw(
      row({ capability: { kind: "read-only", reason: "library-read-only" } }),
    );
    const del = node.querySelector<HTMLElement>("[data-zt-verb='delete']")!;
    expect(del.getAttribute("aria-disabled")).toBe("true");
    expect(del.getAttribute("aria-label")).toBe(
      "You do not have write access to this library.",
    );
    del.click();
    expect(pressed).toEqual([]);
  });
});

/** One popup, with the parent and the row rebuilds a caller can read back. */
function openPopup(anchor = { x: 120, y: 240 }) {
  vi.useFakeTimers();
  const parent: HoverParent = { hoverPopover: null };
  const drawn: string[] = [];
  let label = "first";
  const popup = new MarkPopup({
    parent,
    anchor,
    render: (content) => {
      content.empty();
      drawn.push(label);
      content.createSpan({ text: label });
    },
  });
  return {
    parent,
    popup,
    drawn,
    retarget(next: { x: number; y: number }) {
      popup.retarget(next);
    },
    redraw(nextLabel: string) {
      label = nextLabel;
      popup.refresh();
    },
    [Symbol.dispose]() {
      popup.hide();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MarkPopup", () => {
  it("opens with no delay, from a point rather than a target element", () => {
    using open = openPopup();
    expect(open.popup.targetEl).toBeNull();
    expect(open.popup.staticPos).toEqual({ x: 120, y: 240 });

    vi.advanceTimersByTime(0);

    expect(open.popup.hoverEl.isConnected).toBe(true);
    expect(open.parent.hoverPopover).toBe(open.popup);
  });

  // The create popup opens on the release of a drag, and the same release
  // then clicks, before any timer can run.
  it("stays open through the click that ends the gesture which opened it", () => {
    using open = openPopup();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(open.popup.hoverEl.isConnected).toBe(true);
    expect(open.parent.hoverPopover).toBe(open.popup);
  });

  it("stays open with nothing hovering it, and nothing to hover", () => {
    using open = openPopup();
    vi.advanceTimersByTime(0);

    // What Obsidian runs when the pointer is found to be somewhere else.
    open.popup.onTarget = false;
    open.popup.transition();
    vi.advanceTimersByTime(1000);

    expect(open.popup.isFocused).toBe(true);
    expect(open.popup.hoverEl.isConnected).toBe(true);
  });

  it("carries its content in a row of the plugin's own root", () => {
    using open = openPopup();
    const content = open.popup.hoverEl.firstElementChild;
    expect(open.popup.hoverEl.classList).toContain(themeHook.pdfMarkPopup);
    expect(content?.classList).toContain("zt-root");
    expect(content?.textContent).toBe("first");
  });

  it("moves to another point, rather than opening a second popup", () => {
    using open = openPopup();
    vi.advanceTimersByTime(0);
    const placed = vi.spyOn(open.popup, "position");

    open.retarget({ x: 300, y: 80 });

    expect(open.popup.staticPos).toEqual({ x: 300, y: 80 });
    expect(placed).toHaveBeenCalledTimes(1);
    // Scrolling lands here too, so a move leaves the row as it was.
    expect(open.drawn).toEqual(["first"]);
  });

  it("redraws its row where it stands, when what it acts on changed", () => {
    using open = openPopup();
    vi.advanceTimersByTime(0);
    const placed = vi.spyOn(open.popup, "position");

    open.redraw("second");

    expect(open.popup.hoverEl.textContent).toBe("second");
    expect(placed).not.toHaveBeenCalled();
  });

  it("leaves the document when its owner hides it", () => {
    const open = openPopup();
    vi.advanceTimersByTime(0);

    open.popup.hide();

    expect(open.popup.hoverEl.isConnected).toBe(false);
    expect(open.parent.hoverPopover).toBeNull();
  });
});
