// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { m } from "@/paraglide/messages.js";

import { FakeIntersectionObserver } from "./__fixtures__/media-boundary";

// The turn lives in module state, so each case loads a fresh copy of the
// module and of everything that imports it.
beforeEach(() => {
  vi.resetModules();
});

/** A landing recording beside the table demo, both on the page's real modules. */
async function mountRecordingAndDemo() {
  using cleanup = new DisposableStack();
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: RecordingPlayer } = await import("./recording-player");
  const { TableDemo } = await import("./landing/table-demo");

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  cleanup.defer(() => {
    FakeIntersectionObserver.live.clear();
    vi.unstubAllGlobals();
  });

  const container = cleanup.adopt(document.createElement("div"), (element) =>
    element.remove(),
  );
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanup.defer(() => act(() => root.unmount()));
  await act(async () => {
    root.render(
      <>
        <RecordingPlayer
          base="/img/landing/find"
          poster="/img/landing/find.webp"
          alt="Finding a paper"
          fit="cover"
          preload="metadata"
        />
        <TableDemo />
      </>,
    );
  });

  const video = container.querySelector("video")!;
  const figure = container.querySelector("figure")!;
  const lifetime = cleanup.move();
  return {
    act,
    video,
    figure,
    show: (target: Element, ratio: number) =>
      act(() => FakeIntersectionObserver.show(target, ratio)),
    [Symbol.dispose]: () => lifetime.dispose(),
  };
}

describe("the recording turn", () => {
  it("keeps a reader-paused recording's turn from an automatic start, which plays once the paused one leaves view", async () => {
    const { askTurn, awaitTurn, endTurn, holdTurn, takeTurn } =
      await import("./recording-turn");
    const paused = Symbol("paused");
    const next = Symbol("next");
    const restPaused = vi.fn();
    const resume = vi.fn();
    takeTurn(paused, restPaused);
    holdTurn(paused);

    expect(askTurn(next, vi.fn())).toBe(false);
    awaitTurn(next, resume);
    expect(restPaused).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();

    endTurn(paused);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("gives the turn to a reader's play while a paused recording holds it", async () => {
    const { askTurn, holdTurn, takeTurn } = await import("./recording-turn");
    const paused = Symbol("paused");
    const pressed = Symbol("pressed");
    const restPressed = vi.fn();
    takeTurn(paused, vi.fn());
    holdTurn(paused);

    takeTurn(pressed, restPressed);
    // The press ended the hold, so the next automatic start rests the pressed recording as usual.
    expect(askTurn(Symbol("automatic"), vi.fn())).toBe(true);
    expect(restPressed).toHaveBeenCalledOnce();
  });

  it("leaves the table demo stopped when the reader pauses it while it waits behind a paused recording", async () => {
    using page = await mountRecordingAndDemo();
    const { act, video, figure, show } = page;

    // The recording crosses the middle of the viewport and plays on its own.
    show(video, 1);
    expect(video.paused).toBe(false);
    // The reader pauses it, so it holds the turn while in view.
    act(() => video.pause());

    // The demo comes half into view and waits for the turn.
    show(figure, 0.6);
    // The reader pauses the waiting demo, which rests on its finished frame.
    const toggle = figure.querySelector("button")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-label")).toBe(m.docs_home_table_play());
    const finished = figure.textContent;

    // The paused recording leaves view and gives up the turn.
    show(video, 0);

    expect(video.paused).toBe(true);
    expect(figure.textContent).toBe(finished);
  });
});
