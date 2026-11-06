import { EditorView } from "@codemirror/view";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderProfile } from "@zotlit/workbench/render";
import type { TemplateRenderResult } from "@zotlit/workbench/render";

// @vitest-environment happy-dom
// The Preview reads the editor's one render and the model's preview settings.
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
      '[data-workbench-scroll="note"] [contenteditable]',
    )!;
    const view = EditorView.findFromDOM(content)!;
    act(() =>
      view.dispatch({
        changes: { from: 0, insert: text },
        userEvent: "input.type",
      }),
    );
  }

  it("runs the one render on demand, for the editor and the Preview alike", async () => {
    await using page = await open();
    await page.settle();
    choose(page.host, m.workbench_preview_refresh(), "demand");
    renderInThread.mockClear();
    editNote(page.host, "Held draft\n");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).not.toHaveBeenCalled();
    page.press(m.workbench_preview_run());
    await page.waitFor(() => {
      expect(
        page.host.querySelector('[role="document"]')?.textContent,
      ).toContain("Held draft");
    });
    expect(renderInThread).toHaveBeenCalledTimes(1);
    expect(renderInThread.mock.lastCall![0].source).toContain("Held draft");
  });

  it("interrupts the render in flight when the page closes", async () => {
    let interrupted = false;
    let started = false;
    renderInThread.mockImplementation(() =>
      Effect.callback<TemplateRenderResult>(() => {
        started = true;
        return Effect.sync(() => {
          interrupted = true;
        });
      }),
    );
    const page = await open();
    await page.waitFor(() => expect(started).toBe(true));
    await page[Symbol.asyncDispose]();
    await vi.waitFor(() => expect(interrupted).toBe(true));
  });

  it("passes create and update inputs while preserving the synthesized note's outside text", async () => {
    await using page = await open();
    editNote(page.host, "My own introduction\n");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread.mock.lastCall![0].mode).toBe("create");
    choose(page.host, m.workbench_preview_mode(), "update");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const request = renderInThread.mock.lastCall![0];
    expect(request.mode).toBe("update");
    const result = renderProfile(request.source, request.snapshot, request);
    expect(result.creationBody).toContain("My own introduction");
    // The default body has no Managed Region for an update to refill.
    expect(result.creationBody).not.toContain("%%zt-managed%%");
    expect(result.fold.length).toBeGreaterThan(0);
    await page.waitFor(() => {
      expect(
        page.host.querySelector('[role="document"]')?.textContent,
      ).toContain("My own introduction");
    });
  });
});
