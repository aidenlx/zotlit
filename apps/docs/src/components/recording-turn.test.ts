import { describe, expect, it, vi } from "vitest";

import {
  askTurn,
  awaitTurn,
  endTurn,
  holdTurn,
  takeTurn,
} from "./recording-turn";

describe("the recording turn", () => {
  it("keeps a reader-paused recording's turn from an automatic start, which plays once the paused one leaves view", () => {
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
    endTurn(next);
  });

  it("gives the turn to a reader's play while a paused recording holds it", () => {
    const paused = Symbol("paused");
    const pressed = Symbol("pressed");
    const automatic = Symbol("automatic");
    const restPressed = vi.fn();
    takeTurn(paused, vi.fn());
    holdTurn(paused);

    takeTurn(pressed, restPressed);
    // The press ended the hold, so the next automatic start rests the pressed recording as usual.
    expect(askTurn(automatic, vi.fn())).toBe(true);
    expect(restPressed).toHaveBeenCalledOnce();
    endTurn(automatic);
  });
});
