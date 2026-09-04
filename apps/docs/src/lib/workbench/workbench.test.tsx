// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { RenderRequest } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { Workbench } from "./workbench";

// A render needs a Worker, which this environment has none of; the page under
// test is asked only whether it starts one.
const { startRenderWorker } = vi.hoisted(() => ({
  startRenderWorker: vi.fn((_request: RenderRequest) => ({
    terminate: () => {},
  })),
}));
vi.mock("./render-client", () => ({ startRenderWorker }));

const KEY = "zotlit.workbench.draft.standalone";
/** Quiet time after the last change, plus room for the write to land. */
const SETTLE_MS = 700;
/** The width this environment opens on, which every test starts from. */
const DEFAULT_WIDTH = window.innerWidth;
const KEPT = DEFAULT_PROFILE_SOURCE.replace("name: Default", "name: Kept work");
const ETA = DEFAULT_PROFILE_SOURCE.replace("language: liquid", "language: eta");

// This environment carries no Storage of its own, so each test starts on one
// that behaves as a browser's does.
beforeEach(() => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    },
  });
  startRenderWorker.mockClear();
});

// The viewport is one window the whole file shares, so a test that draws the
// page at another width hands the next one back the width it opened on.
afterEach(() => resize(DEFAULT_WIDTH));

describe("the kept draft on the next visit", () => {
  it("holds the last visit's work back until the prompt is accepted", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    // The prompt stands over the document a fresh visit opens on.
    expect(page.host.textContent).toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.key);

    page.press(m.workbench_restore_accept());

    // Both halves come back together: the draft, and the paper it was shown
    // against.
    expect(title(page.host)).toBe("Kept work");
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[1]!.item.key);
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
  });

  it("drops the record when the reader starts clean", () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.press(m.workbench_restore_decline());

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    expect(title(page.host)).toBe("Default");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps what the reader changes before answering the prompt", async () => {
    keep(KEPT, SAMPLE_ITEMS[1]!);
    using page = open();

    page.show(SAMPLE_ITEMS[2]!.item.key);

    // The change answers the prompt the way Start clean does, so the next
    // visit is offered the paper this one chose rather than the older draft.
    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      source: DEFAULT_PROFILE_SOURCE,
      snapshot: SAMPLE_ITEMS[2],
    });
  });

  it("offers nothing an untouched visit left, and clears what it found", async () => {
    localStorage.setItem(KEY, "kept before the snapshot contract moved on");
    using page = open();

    expect(page.host.textContent).not.toContain(m.workbench_restore_heading());
    await page.settle();

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("a profile the web workbench refuses", () => {
  it("shows the handoff, and hands the refused source to no render", async () => {
    keep(ETA, SAMPLE_ITEMS[0]!);
    using page = open();

    page.press(m.workbench_restore_accept());

    expect(page.host.textContent).toContain(m.workbench_unsupported_heading());
    expect(page.host.textContent).toContain(m.workbench_unsupported_download());
    // None of the editing panes are reachable from this screen.
    expect(page.host.querySelector('[role="tablist"]')).toBeNull();
    await page.settle();
    expect(rendered()).not.toContain(ETA);
  });
});

describe("the narrow layout", () => {
  it("carries the result on a tab of its own", () => {
    using page = open();

    // The pane opens the page; the result is the one tap beside it.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());
    // The tabs the wide layout offers stay where they were.
    expect(page.host.textContent).toContain(m.workbench_tab_properties());
  });

  it("inserts from the field sheet where the column would, then closes", async () => {
    using page = open();
    // The list waits for the same Temporal the render does.
    await page.settle();

    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    expect(sheet.getAttribute("aria-label")).toBe(m.workbench_fields_heading());

    selectField(sheet, m.workbench_field_title());
    const snippet = sheet.querySelector("code")!.textContent!;
    press(sheet, m.workbench_fields_put_in_note());

    // The sheet leaves with the snippet it put in the note.
    expect(page.host.querySelector('[role="dialog"]')).toBeNull();
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!).source).toContain(snippet);
  });

  it("carries the reader back to the pane when Advanced opens", () => {
    using page = open();

    page.press(m.workbench_view_result());
    openMenu(page.host);
    page.press(m.workbench_advanced());

    // Advanced stands inside the pane, so a press made from the result tab
    // shows what it opened.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    expect(page.host.textContent).toContain(m.workbench_advanced_heading());
  });

  it("leaves the reader on the result when Advanced closes", () => {
    using page = open();

    openMenu(page.host);
    page.press(m.workbench_advanced());
    page.press(m.workbench_view_result());
    openMenu(page.host);
    page.press(m.workbench_advanced());

    // Closing Advanced opens nothing over the pane, so the result the reader
    // is reading stays the tab they are on.
    expect(chosenView(page.host)).toBe(m.workbench_view_result());
  });

  it("returns the keyboard to the button the field sheet was opened from", () => {
    using page = open();

    page.press(m.workbench_add_field());
    press(openSheet(page.host), m.workbench_fields_close());

    const button = [...page.host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === m.workbench_add_field(),
    );
    expect(document.activeElement).toBe(button);
  });

  it("leaves the field sheet on Escape", () => {
    using page = open();

    page.press(m.workbench_add_field());
    expect(openSheet(page.host)).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(page.host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("returns a widened window to the pane", () => {
    resize(375);
    using page = open();

    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());

    // Past the threshold the two tabs are gone, so the result reads as chosen
    // on a screen carrying no tab that says so.
    resize(900);

    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
  });
});

interface OpenPage extends Disposable {
  host: HTMLElement;
  /** Presses the button carrying `label`. */
  press: (label: string) => void;
  /** Picks the Sample Item the page is shown against. */
  show: (key: string) => void;
  /** Waits out the autosave's quiet time and the render's own. */
  settle: () => Promise<void>;
}

/** The page mounted for real, so its own effects run. */
function open(): OpenPage {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Workbench />));
  return {
    host,
    press: (label) => press(host, label),
    show(key) {
      const select = host.querySelector("select")!;
      select.value = key;
      act(() => {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    async settle() {
      await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)));
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Presses the button reading exactly `label` inside `scope`. */
function press(scope: HTMLElement, label: string): void {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  if (!target) throw new Error(`No button reads '${label}'.`);
  act(() => target.click());
}

/** Selects the field row named `label`, which reveals what the row offers. */
function selectField(scope: HTMLElement, label: string): void {
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.firstElementChild?.textContent === label,
  );
  if (!target) throw new Error(`No field row reads '${label}'.`);
  act(() => target.click());
}

/** Opens the header's More actions menu, where Advanced is offered. */
function openMenu(host: HTMLElement): void {
  const button = host.querySelector<HTMLElement>(
    `button[aria-label="${m.workbench_more_actions()}"]`,
  )!;
  act(() => button.click());
}

/** Draws the page at `width`, the way a window resized to it does. */
function resize(width: number): void {
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport: (size: { width: number }) => void };
  };
  act(() => happyDOM.setViewport({ width }));
}

/** The field list the narrow layout's "Add a field" opened. */
function openSheet(host: HTMLElement): HTMLElement {
  const sheet = host.querySelector<HTMLElement>('[role="dialog"]');
  if (!sheet) throw new Error("No field sheet is open.");
  return sheet;
}

/** The tab the narrow layout reads as chosen: the pane, or the result. */
function chosenView(host: HTMLElement): string {
  const tabs = host.querySelector(
    `[role="tablist"][aria-label="${m.workbench_view_label()}"]`,
  )!;
  return tabs.querySelector('[aria-selected="true"]')!.textContent!;
}

/** Every source a render was started over. */
function rendered(): string[] {
  return startRenderWorker.mock.calls.map(([request]) => request.source);
}

/** Puts a record where the page reads the last visit's own. */
function keep(source: string, snapshot: (typeof SAMPLE_ITEMS)[number]): void {
  localStorage.setItem(KEY, JSON.stringify({ source, snapshot }));
}

/** The profile name the header carries. */
function title(host: HTMLElement): string {
  return host.querySelector("h1")?.textContent ?? "";
}

/** The Sample Item the page says it is showing. */
function shownItem(host: HTMLElement): string {
  return host.querySelector("select")!.value;
}
