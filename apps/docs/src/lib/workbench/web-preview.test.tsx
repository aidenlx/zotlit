import { EditorView } from "@codemirror/view";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderProfile } from "@zotlit/workbench/render";
import type { ProfileRenderResult } from "@zotlit/workbench/render";

// @vitest-environment happy-dom
// The web subscribes shared controls and document changes to its scheduler.
import { m } from "@/paraglide/messages.js";

import { renderInThread, open } from "./page-test-host";

describe("preview scheduling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function choose(scope: HTMLElement, label: string, value: string) {
    const control = [...scope.querySelectorAll("label")]
      .find((node) => node.textContent?.includes(label))!
      .querySelector("select")!;
    act(() => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function editNote(scope: HTMLElement, text: string) {
    const content = scope.querySelector<HTMLElement>(
      `[aria-label="${m.workbench_tab_note()}"][contenteditable]`,
    )!;
    const view = EditorView.findFromDOM(content)!;
    act(() =>
      view.dispatch({
        changes: { from: 0, insert: text },
        userEvent: "input.type",
      }),
    );
  }

  it("waits 300 ms after the latest edit and runs on demand immediately", async () => {
    using page = open();
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(renderInThread).not.toHaveBeenCalled();
    editNote(page.host, "An introduction\n");
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(renderInThread).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    choose(page.host, m.workbench_preview_refresh(), "demand");
    editNote(page.host, "Another introduction\n");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    expect(page.host.textContent).toContain(m.workbench_preview_stale());
    page.press(m.workbench_preview_run());
    expect(renderInThread).toHaveBeenCalledTimes(2);
    expect(renderInThread.mock.calls[1]![0].source).toContain(
      "Another introduction",
    );
  });

  it("pauses queued and future work while an in-flight render completes", async () => {
    let deliver!: (result: ProfileRenderResult) => void;
    renderInThread.mockImplementation(
      () =>
        new Promise<ProfileRenderResult>((resolve) => {
          deliver = resolve;
        }),
    );
    using page = open();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const request = renderInThread.mock.calls[0]![0];
    choose(page.host, m.workbench_preview_refresh(), "demand");
    expect(page.host.textContent).toContain(m.workbench_preview_paused());
    editNote(page.host, "Later edit\n");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    await act(async () => {
      deliver(renderProfile(request.source, request.snapshot, request));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(page.host.textContent).toContain("ioannidisWhyMost2005");
    choose(page.host, m.workbench_preview_refresh(), "live");
    choose(page.host, m.workbench_preview_refresh(), "demand");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).toHaveBeenCalledTimes(1);
  });

  it("passes create and update inputs while preserving the synthesized note's outside text", async () => {
    using page = open();
    editNote(page.host, "My own introduction\n");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread.mock.lastCall![0].mode).toBe("create");
    choose(page.host, m.workbench_preview_mode(), "update");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const request = renderInThread.mock.lastCall![0];
    expect(request.mode).toBe("update");
    const result = renderProfile(request.source, request.snapshot, request);
    expect(result.creationBody).toContain("My own introduction");
    expect(result.creationBody).toContain("%%zt-managed%%");
    expect(result.fold.length).toBeGreaterThan(0);
    expect(page.host.querySelector('[role="document"]')?.textContent).toContain(
      "My own introduction",
    );
  });
});
