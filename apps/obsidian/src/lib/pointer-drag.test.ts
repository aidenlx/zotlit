// @vitest-environment happy-dom
import type { Scope } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { keymapApp, pressTop } from "./__fixtures__/keymap";
import { pointerDrag } from "./pointer-drag";

const CURSOR = "zt-is-dragging-test";

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames[id - 1] = () => {};
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.className = "";
});

/** Run the frames the drag asked for so far. */
function runFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(0);
}

function pointer(type: string, clientX: number, pointerId = 1) {
  window.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX, pointerId }),
  );
}

function start() {
  const handle = document.body.createDiv();
  const controller = new AbortController();
  const calls: unknown[][] = [];
  const app = keymapApp();
  pointerDrag({
    app,
    press: { pointerId: 1, clientX: 100, clientY: 0 },
    handle,
    cursor: CURSOR,
    controller,
    move: (delta) => calls.push(["move", delta]),
    drop: (delta) => calls.push(["drop", delta]),
    end: () => calls.push(["end"]),
  });
  return { handle, controller, calls, app };
}

it("holds the cursor and the active edge while the drag is on, and moves once a frame with the last offset", () => {
  const { handle, calls } = start();
  expect(document.body.classList.contains(CURSOR)).toBe(true);
  expect(handle.classList.contains("is-active")).toBe(true);

  pointer("pointermove", 110);
  pointer("pointermove", 130);
  // Another pointer moves nothing.
  pointer("pointermove", 500, 2);
  runFrames();
  expect(calls).toEqual([["move", 30]]);

  pointer("pointermove", 90);
  pointer("pointerup", 90);
  // The drop takes the last move's offset; the pending frame does not run.
  runFrames();
  expect(calls).toEqual([["move", 30], ["drop", -10], ["end"]]);
  expect(document.body.classList.contains(CURSOR)).toBe(false);
  expect(handle.classList.contains("is-active")).toBe(false);

  // The window no longer follows the pointer.
  pointer("pointermove", 200);
  pointer("pointerup", 200);
  runFrames();
  expect(calls).toHaveLength(3);
});

it("drops nothing for a press that does not move", () => {
  const { calls } = start();
  pointer("pointermove", 100);
  pointer("pointerup", 100);
  runFrames();
  expect(calls).toEqual([["end"]]);
});

it.each([
  [
    "Escape",
    (app: { scopes: Scope[] }) => {
      // The drag takes the key: the Scope of the list under it never hears it.
      const escape = pressTop(app, { key: "Escape" }, document.body);
      expect(escape.defaultPrevented).toBe(true);
    },
  ],
  ["a lost pointer", () => pointer("pointercancel", 120)],
])("ends without a drop on %s", (_, cancel) => {
  const { calls, app } = start();
  pointer("pointermove", 120);
  expect(app.scopes).toHaveLength(1);
  cancel(app);
  runFrames();
  pointer("pointerup", 120);
  expect(calls).toEqual([["end"]]);
  expect(document.body.classList.contains(CURSOR)).toBe(false);
  expect(app.scopes).toEqual([]);
});

it("ends without a drop when its controller aborts, as a closing view does", () => {
  const { controller, calls } = start();
  pointer("pointermove", 120);
  controller.abort();
  runFrames();
  pointer("pointerup", 120);
  expect(calls).toEqual([["end"]]);
});

it("follows the pointer along y when the drag says so, and leaves a move along x alone", () => {
  const handle = document.body.createDiv();
  const calls: unknown[][] = [];
  pointerDrag({
    app: keymapApp(),
    press: { pointerId: 1, clientX: 100, clientY: 300 },
    axis: "y",
    handle,
    cursor: CURSOR,
    controller: new AbortController(),
    move: (delta) => calls.push(["move", delta]),
    drop: (delta) => calls.push(["drop", delta]),
    end: () => calls.push(["end"]),
  });
  const move = (type: string, clientX: number, clientY: number) =>
    window.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }),
    );
  move("pointermove", 160, 300);
  runFrames();
  expect(calls).toEqual([]);
  move("pointermove", 160, 260);
  runFrames();
  move("pointerup", 160, 260);
  expect(calls).toEqual([["move", -40], ["drop", -40], ["end"]]);
});
