// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endPlayback,
  FakeIntersectionObserver,
  queueMediaEvents,
  settle,
  where,
} from "@/components/__fixtures__/media-boundary";
import type { Box } from "@/components/__fixtures__/media-boundary";
import { m } from "@/paraglide/messages.js";

import type { LessonViewData } from "./lesson-view";

// The recording turn lives in module state, so each case loads a fresh copy
// of the page's modules; saved ticks live in this browser's storage.
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

/** Two steps of Lesson 2, whose clips the build finds in `public/img/learn`. */
const lesson: LessonViewData = {
  slug: "annotate-zotero-pdfs-in-obsidian",
  title: "Annotate Zotero PDFs in Obsidian",
  lesson: 2,
  minutes: 10,
  media: "annotate-pdfs-in-obsidian",
  instead:
    "Highlight the PDF in Obsidian to add a card to your literature note.",
  needs: [],
  steps: [
    { title: "Open the paper's PDF", alt: "The PDF opens in Obsidian." },
    { title: "Allow editing in Zotero", alt: "The annotation tools appear." },
  ],
  end: {
    title: "A new highlight and comment in your note",
    caption: "You can now highlight PDFs in Obsidian.",
  },
  others: [],
};
const [first, second] = lesson.steps as [
  LessonViewData["steps"][number],
  LessonViewData["steps"][number],
];

const outcomeScope = '[aria-labelledby="lesson-outcome"]';

/** happy-dom's control of the window and the reader's preferences, which `matchMedia` reads. */
const browser = (
  window as unknown as {
    happyDOM: {
      setViewport(viewport: { width: number }): void;
      settings: { device: { prefersReducedMotion: string } };
    };
  }
).happyDOM;

/**
 * The lesson page on its real modules for a reader with `ticks` saved, in a
 * window `width` pixels wide (below `xl` unless it says otherwise), with
 * reduced motion when `reduced`, and under React's StrictMode, as the dev
 * server runs it, when `strict`.
 */
async function mountLesson({
  ticks = [],
  width,
  reduced = false,
  strict = false,
}: {
  ticks?: number[];
  width?: number;
  reduced?: boolean;
  strict?: boolean;
} = {}) {
  using cleanup = new DisposableStack();
  if (width !== undefined) {
    const before = window.innerWidth;
    browser.setViewport({ width });
    cleanup.defer(() => browser.setViewport({ width: before }));
  }
  if (reduced) {
    const { device } = browser.settings;
    const before = device.prefersReducedMotion;
    device.prefersReducedMotion = "reduce";
    cleanup.defer(() => {
      device.prefersReducedMotion = before;
    });
  }
  const { act, StrictMode, Fragment } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const {
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import("@tanstack/react-router");
  const { LessonView } = await import("./lesson-view");
  const { Step } = await import("./lesson-mdx");

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  cleanup.defer(() => {
    FakeIntersectionObserver.live.clear();
    vi.unstubAllGlobals();
  });
  cleanup.use(queueMediaEvents());
  if (ticks.length > 0) {
    localStorage.setItem(
      "zotlit:learn-progress",
      JSON.stringify({ [lesson.slug]: { ticks, done: false } }),
    );
  }

  const history = cleanup.adopt(
    createMemoryHistory({ initialEntries: [`/learn/${lesson.slug}`] }),
    (history) => history.destroy(),
  );
  const router = createRouter({ history, routeTree: createRootRoute() });
  const container = cleanup.adopt(document.createElement("div"), (element) =>
    element.remove(),
  );
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanup.defer(() => act(() => root.unmount()));
  const Mode = strict ? StrictMode : Fragment;
  await act(async () => {
    root.render(
      <Mode>
        <RouterContextProvider router={router}>
          <LessonView lesson={lesson}>
            <Step n={1}>Open the PDF from its card.</Step>
            <Step n={2}>Allow editing in Zotero.</Step>
          </LessonView>
        </RouterContextProvider>
      </Mode>,
    );
    await settle();
  });

  /** The clip in the part `scope` selects, once its player's lazy module has loaded. */
  async function player(scope: string) {
    let found: HTMLVideoElement | undefined;
    await vi.waitFor(async () => {
      await act(settle);
      found = container.querySelector(`${scope} video`) ?? undefined;
      expect(found).toBeDefined();
    });
    return found!;
  }
  const buttonNamed = (name: string, within: Element = container) =>
    [...within.querySelectorAll("button")].filter(
      (button) =>
        (button.getAttribute("aria-label") ?? button.textContent) === name,
    );

  const lifetime = cleanup.move();
  return {
    container,
    player,
    buttonNamed,
    /** Does `action` as the reader, then lets the browser's queued tasks run. */
    act: (action: () => void) =>
      act(async () => {
        action();
        await settle();
      }),
    place: (target: Element, box: Box) =>
      act(async () => {
        FakeIntersectionObserver.place(target, box);
        await settle();
      }),
    start: () =>
      act(async () => {
        buttonNamed(
          m.docs_learn_start_step({ number: 1, begun: "no" }),
        )[0]!.click();
        await settle();
      }),
    [Symbol.dispose]: () => lifetime.dispose(),
  };
}

describe("a lesson's recordings", () => {
  it("plays the outcome on its own and in a loop while it crosses the middle of the window", async () => {
    using page = await mountLesson();
    const outcome = await page.player(outcomeScope);

    await page.place(outcome, where.edge());
    expect(outcome.paused).toBe(true);
    await page.place(outcome, where.middle());

    expect(outcome.paused).toBe(false);
    expect(outcome.loop).toBe(true);
  });

  it("plays the step from Start again once the outcome that crossed the middle of the window on the way to it leaves", async () => {
    using page = await mountLesson();
    const outcome = await page.player(outcomeScope);
    await page.start();
    const step = await page.player("#step-1-body");
    await page.place(step, where.edge());
    expect(step.paused).toBe(false);

    // The scroll to the opened row carries the outcome through the middle of the window.
    await page.place(outcome, where.middle());
    expect(outcome.paused).toBe(false);
    expect(step.paused).toBe(true);
    await page.place(outcome, where.away());

    expect(step.paused).toBe(false);
  });

  it("plays the step from Start once the scroll to its row brings it into view", async () => {
    using page = await mountLesson();
    // In a narrow window the opened row's picture starts below the fold.
    await page.start();
    const step = await page.player("#step-1-body");

    await page.place(step, where.edge());

    expect(step.paused).toBe(false);
  });

  it("plays a step once from Start, then shows one Replay on the dimmed frame and gives the turn back", async () => {
    using page = await mountLesson();
    const outcome = await page.player(outcomeScope);
    await page.place(outcome, where.middle());

    await page.start();
    const step = await page.player("#step-1-body");
    await page.place(step, where.middle());
    expect(step.paused).toBe(false);
    expect(step.loop).toBe(false);
    expect(outcome.paused).toBe(true);

    await page.act(() => endPlayback(step));

    expect(page.buttonNamed(m.docs_learn_recording_replay())).toHaveLength(1);
    // The step gave its turn back, so the outcome it rested plays again.
    expect(outcome.paused).toBe(false);
  });

  it("gives the turn back to the outcome under StrictMode, which runs the Start clip's effects twice", async () => {
    using page = await mountLesson({ strict: true });
    const outcome = await page.player(outcomeScope);
    await page.place(outcome, where.middle());
    expect(outcome.paused).toBe(false);

    await page.start();
    const step = await page.player("#step-1-body");
    await page.place(step, where.middle());
    expect(outcome.paused).toBe(true);
    await page.act(() => endPlayback(step));

    expect(outcome.paused).toBe(false);
  });

  it("replays an ended step on the reader's press, and not when it comes back into view", async () => {
    using page = await mountLesson();
    await page.start();
    const step = await page.player("#step-1-body");
    await page.place(step, where.middle());
    await page.act(() => endPlayback(step));

    await page.place(step, where.away());
    await page.place(step, where.middle());
    expect(step.paused).toBe(true);

    await page.act(() =>
      page.buttonNamed(m.docs_learn_recording_replay())[0]!.click(),
    );
    expect(step.paused).toBe(false);
    expect(page.buttonNamed(m.docs_learn_recording_replay())).toHaveLength(0);
    // The pressed button left with the end; focus stays on the player.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(first.alt);
  });

  it("ticks an ended step from the dimmed picture as the row's own Tick step does", async () => {
    using page = await mountLesson();
    await page.start();
    const step = await page.player("#step-1-body");
    await page.place(step, where.middle());
    await page.act(() => endPlayback(step));

    const picture = step.closest(`[aria-label="${CSS.escape(first.alt)}"]`)!;
    const [tick] = page.buttonNamed(
      m.docs_learn_tick_step({ number: 1 }),
      picture,
    );
    await page.act(() => tick!.click());

    const box = page.container.querySelector<HTMLInputElement>(
      `input[aria-label="${CSS.escape(
        m.docs_learn_step_name({ number: 1, total: 2, title: first.title }),
      )}"]`,
    )!;
    expect(box.checked).toBe(true);
    expect(
      page.container
        .querySelector("#step-2-toggle")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      page.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe(
      m.docs_learn_say_ticked({ number: 1, next: 2, title: second.title }),
    );
  });

  it("plays the row open on load on its own while it crosses the middle of the window", async () => {
    using page = await mountLesson({ ticks: [1] });
    const step = await page.player("#step-2-body");

    await page.place(step, where.edge());
    expect(step.paused).toBe(true);
    await page.place(step, where.middle());

    expect(step.paused).toBe(false);
    expect(step.loop).toBe(false);
  });

  it("rests a step on its poster under reduced motion, and after the reader's play ends it under the dimmed end actions", async () => {
    using page = await mountLesson({ ticks: [1], reduced: true });
    const step = await page.player("#step-2-body");

    await page.place(step, where.middle());
    expect(step.paused).toBe(true);

    await page.act(() => void step.play());
    expect(step.paused).toBe(false);
    await page.act(() => endPlayback(step));

    const picture = step.closest(`[aria-label="${CSS.escape(second.alt)}"]`)!;
    expect(
      page.buttonNamed(m.docs_learn_tick_step({ number: 2 }), picture),
    ).toHaveLength(1);
    expect(
      page.buttonNamed(m.docs_learn_recording_replay(), picture),
    ).toHaveLength(1);
  });

  it("turns the media panel from the ended last step to the looping outcome, which shares its clip", async () => {
    using page = await mountLesson({ ticks: [1], width: 1440 });
    const panel = `aside[aria-label="${CSS.escape(m.docs_learn_panel_label())}"]`;
    const step = await page.player(panel);
    await page.place(step, where.middle());
    await page.act(() => endPlayback(step));

    await page.act(() =>
      page
        .buttonNamed(
          m.docs_learn_tick_step({ number: 2 }),
          step.closest(`[aria-label="${CSS.escape(second.alt)}"]`)!,
        )[0]!
        .click(),
    );

    const outcome = await page.player(panel);
    expect(outcome.loop).toBe(true);
    expect(page.buttonNamed(m.docs_learn_recording_replay())).toHaveLength(0);
  });
});
