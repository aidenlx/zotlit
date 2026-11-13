// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  endPlayback,
  FakeIntersectionObserver,
} from "@/components/__fixtures__/media-boundary";
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

/** The lesson page on its real modules, below `xl`, for a reader with `ticks` saved. */
async function mountLesson(ticks: number[] = []) {
  using cleanup = new DisposableStack();
  const { act } = await import("react");
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
  await act(async () => {
    root.render(
      <RouterContextProvider router={router}>
        <LessonView lesson={lesson}>
          <Step n={1}>Open the PDF from its card.</Step>
          <Step n={2}>Allow editing in Zotero.</Step>
        </LessonView>
      </RouterContextProvider>,
    );
  });

  /** The clip in the part `scope` selects, once its player's lazy module has loaded. */
  async function player(scope: string) {
    let found: HTMLVideoElement | undefined;
    await vi.waitFor(async () => {
      await act(async () => {});
      found = container.querySelector(`${scope} video`) ?? undefined;
      expect(found).toBeDefined();
    });
    return found!;
  }
  /**
   * The page's buttons named `name`, outside the players' control bars: the
   * bar's play button is named "Replay" too once a clip has ended.
   */
  const buttonNamed = (name: string, within: Element = container) =>
    [...within.querySelectorAll("button")].filter(
      (button) =>
        (button.getAttribute("aria-label") ?? button.textContent) === name &&
        !button.closest(
          `[aria-label="${CSS.escape(m.docs_learn_recording_controls())}"]`,
        ),
    );

  const lifetime = cleanup.move();
  return {
    act,
    container,
    player,
    buttonNamed,
    show: (target: Element, ratio: number) =>
      act(() => FakeIntersectionObserver.show(target, ratio)),
    [Symbol.dispose]: () => lifetime.dispose(),
  };
}

describe("a lesson's recordings", () => {
  it("plays the outcome on its own and in a loop while it crosses the middle of the window", async () => {
    using page = await mountLesson();
    const outcome = await page.player(outcomeScope);

    page.show(outcome, 1);

    expect(outcome.paused).toBe(false);
    expect(outcome.loop).toBe(true);
  });

  it("plays a step once from Start, then dims it under a replay button and gives the turn back", async () => {
    using page = await mountLesson();
    const outcome = await page.player(outcomeScope);
    page.show(outcome, 1);

    const [start] = page.buttonNamed(
      m.docs_learn_start_step({ number: 1, begun: "no" }),
    );
    page.act(() => start!.click());
    const step = await page.player("#step-1-body");
    expect(step.paused).toBe(false);
    expect(step.loop).toBe(false);
    expect(outcome.paused).toBe(true);

    page.act(() => endPlayback(step));

    expect(page.buttonNamed(m.docs_learn_recording_replay())).toHaveLength(1);
    // The step gave its turn back, so the outcome it rested plays again.
    expect(outcome.paused).toBe(false);
  });

  it("replays an ended step on the reader's press, and not when it comes back into view", async () => {
    using page = await mountLesson();
    page.act(() =>
      page
        .buttonNamed(m.docs_learn_start_step({ number: 1, begun: "no" }))[0]!
        .click(),
    );
    const step = await page.player("#step-1-body");
    page.act(() => endPlayback(step));

    page.show(step, 0);
    page.show(step, 1);
    expect(step.paused).toBe(true);

    page.act(() =>
      page.buttonNamed(m.docs_learn_recording_replay())[0]!.click(),
    );
    expect(step.paused).toBe(false);
    expect(page.buttonNamed(m.docs_learn_recording_replay())).toHaveLength(0);
    // The pressed button left with the end; focus stays on the player.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(first.alt);
  });

  it("ticks an ended step from the dimmed picture as the row's own Tick step does", async () => {
    using page = await mountLesson();
    page.act(() =>
      page
        .buttonNamed(m.docs_learn_start_step({ number: 1, begun: "no" }))[0]!
        .click(),
    );
    const step = await page.player("#step-1-body");
    page.act(() => endPlayback(step));

    const picture = step.closest(`[aria-label="${CSS.escape(first.alt)}"]`)!;
    const [tick] = page.buttonNamed(
      m.docs_learn_tick_step({ number: 1 }),
      picture,
    );
    page.act(() => tick!.click());

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
    using page = await mountLesson([1]);
    const step = await page.player("#step-2-body");

    page.show(step, 1);

    expect(step.paused).toBe(false);
    expect(step.loop).toBe(false);
  });
});
