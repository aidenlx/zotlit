// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { expect, it, vi } from "vitest";

import { webCompletion } from "./completion";
import { webHover } from "./hover";

it("shows the property after 500 ms without moving focus or selection", async () => {
  await using h = await hoverEditor();
  const { view } = h;
  const selection = view.state.selection;
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 80,
        clientY: 10,
      }),
    );
    await vi.advanceTimersByTimeAsync(499);
  });
  expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(
    document.querySelector('[data-slot="hover-card-content"]')?.textContent,
  ).toContain("title");
  expect(document.querySelector(".cm-tooltip-hover")).toBeNull();
  expect(view.hasFocus).toBe(true);
  expect(view.state.selection.eq(selection)).toBe(true);
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
});

it("cancels a pending hover on leave and keeps an open card while the pointer crosses into it", async () => {
  await using h = await hoverEditor();
  const { view } = h;
  const move = () =>
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 80,
        clientY: 10,
      }),
    );
  await act(async () => {
    move();
    await vi.advanceTimersByTimeAsync(400);
    view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
  await act(async () => {
    move();
    await vi.advanceTimersByTimeAsync(500);
  });
  const card = document.querySelector('[data-slot="hover-card-content"]')!;
  expect(card).not.toBeNull();
  await act(async () => {
    view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(100);
    card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(
    document.querySelector('[data-slot="hover-card-content"]'),
  ).not.toBeNull();
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: 14, insert: "changed" } });
  });
  expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
});

it("cancels the hover when completion consumes Ctrl-Space", async () => {
  await using h = await hoverEditor(true);
  const { view } = h;
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 80, clientY: 10 }),
    );
    await vi.advanceTimersByTimeAsync(400);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        ctrlKey: true,
        code: "Space",
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(document.querySelector('[role="option"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull();
});

async function hoverEditor(completion = false) {
  await using cleanup = new AsyncDisposableStack();
  vi.useFakeTimers();
  cleanup.defer(() => {
    vi.useRealTimers();
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  const read = () => ({ root: "note" as const, partials: [] });
  const view = new EditorView({
    state: EditorState.create({
      doc: "{{ zt.title }}",
      selection: { anchor: 8 },
      extensions: [
        webHover(read),
        ...(completion ? [webCompletion(read)] : []),
      ],
    }),
    parent: document.body,
  });
  cleanup.defer(async () => {
    await act(async () => view.destroy());
  });
  // happy-dom has no text layout. Supply only the browser geometry boundary.
  vi.spyOn(view, "posAtCoords").mockReturnValue(8);
  vi.spyOn(view, "coordsAtPos").mockImplementation((pos) => ({
    left: pos * 10,
    right: pos * 10,
    top: 0,
    bottom: 20,
  }));
  await act(async () => {
    view.focus();
    await vi.advanceTimersByTimeAsync(100);
  });
  const resources = cleanup.move();
  return {
    view,
    [Symbol.asyncDispose]: () => resources[Symbol.asyncDispose](),
  };
}
