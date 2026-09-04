// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    press(label) {
      const target = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );
      if (!target) throw new Error(`No button reads '${label}'.`);
      act(() => target.click());
    },
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
