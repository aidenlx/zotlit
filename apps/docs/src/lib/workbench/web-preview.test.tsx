import { EditorView } from "@codemirror/view";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  renderProfile,
} from "@zotlit/workbench/render";
import type { ProfileRenderResult } from "@zotlit/workbench/render";
import { createRenderScheduler } from "@zotlit/workbench/ui";

vi.mock("@zotlit/workbench/ui", async (original) => {
  const actual = await original<typeof import("@zotlit/workbench/ui")>();
  return {
    ...actual,
    createRenderScheduler: vi.fn(
      (...args: Parameters<typeof actual.createRenderScheduler>) => {
        const scheduler = actual.createRenderScheduler(...args);
        scheduler[Symbol.dispose] = vi.fn(scheduler[Symbol.dispose]);
        return scheduler;
      },
    ),
  };
});

// @vitest-environment happy-dom
// The web subscribes shared controls and document changes to its scheduler.
import { m } from "@/paraglide/messages.js";

import { renderInThread, open } from "./page-test-host";
import { WebPreview } from "./preview";
import { WebTestHost } from "./test-host";

describe("preview scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(createRenderScheduler).mockClear();
  });
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

  function openPreview(strict = false) {
    using cleanup = new DisposableStack();
    const host = cleanup.adopt(document.createElement("div"), (element) =>
      element.remove(),
    );
    document.body.appendChild(host);
    const root = cleanup.adopt(createRoot(host), (root) => {
      act(() => root.unmount());
    });
    let source = DEFAULT_PROFILE_SOURCE;
    function render() {
      const content = (
        <WebTestHost>
          <WebPreview
            source={source}
            sample={SAMPLE_ITEMS[0]!}
            resources={undefined}
            hold={false}
            mode="note"
            entries={[]}
            sampleBar={null}
            annotationChoice=""
            onAnnotationChoice={() => {}}
            openAnnotation={() => {}}
            goToEntry={() => {}}
            openSource={() => {}}
          />
        </WebTestHost>
      );
      act(() =>
        root.render(strict ? <StrictMode>{content}</StrictMode> : content),
      );
    }
    render();
    const lifetime = cleanup.move();
    return {
      host,
      edit(text: string) {
        source += text;
        render();
      },
      press(label: string) {
        const button = [...host.querySelectorAll("button")].find(
          (node) => node.textContent === label,
        )!;
        act(() => button.click());
      },
      [Symbol.dispose]() {
        lifetime.dispose();
      },
    };
  }

  it("renders and accepts edits after StrictMode effect replay", async () => {
    using page = openPreview(true);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    await act(async () => vi.dynamicImportSettled());
    expect(page.host.textContent).toContain("ioannidisWhyMost2005");
    page.edit("StrictMode edit\n");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).toHaveBeenCalledTimes(2);
    expect(renderInThread.mock.lastCall![0].source).toContain(
      "StrictMode edit",
    );
  });

  it("disposes every StrictMode effect owner and drops late completion after close", async () => {
    let deliver!: (result: ProfileRenderResult) => void;
    renderInThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    using page = openPreview(true);
    const owners = vi
      .mocked(createRenderScheduler)
      .mock.results.map((result) => result.value);
    expect(owners).toHaveLength(2);
    expect(owners[0]![Symbol.dispose]).toHaveBeenCalledOnce();
    expect(owners[1]![Symbol.dispose]).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const request = renderInThread.mock.lastCall![0];
    const pending = owners[1]!.getState();
    page[Symbol.dispose]();
    expect(owners[1]![Symbol.dispose]).toHaveBeenCalledOnce();
    await act(async () => {
      deliver(renderProfile(request.source, request.snapshot, request));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(owners[1]!.getState()).toBe(pending);
    expect(page.host.isConnected).toBe(false);
  });

  it("waits 300 ms after the latest edit and runs on demand immediately", async () => {
    using page = openPreview();
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(renderInThread).not.toHaveBeenCalled();
    page.edit("An introduction\n");
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(renderInThread).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    choose(page.host, m.workbench_preview_refresh(), "demand");
    page.edit("Another introduction\n");
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
    using page = openPreview();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const request = renderInThread.mock.calls[0]![0];
    choose(page.host, m.workbench_preview_refresh(), "demand");
    expect(page.host.textContent).toContain(m.workbench_preview_paused());
    await act(async () => {
      deliver(renderProfile(request.source, request.snapshot, request));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => vi.dynamicImportSettled());
    expect(page.host.textContent).toContain("ioannidisWhyMost2005");
    page.edit("Later edit\n");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    expect(page.host.textContent).toContain(m.workbench_preview_stale());
    choose(page.host, m.workbench_preview_refresh(), "live");
    choose(page.host, m.workbench_preview_refresh(), "demand");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).toHaveBeenCalledTimes(1);
  });

  it("keeps independently mounted Preview controls separate", async () => {
    using first = openPreview();
    using second = openPreview();
    choose(first.host, m.workbench_preview_refresh(), "demand");
    choose(first.host, m.workbench_preview_format(), "markdown");
    const secondControls = [...second.host.querySelectorAll("select")];
    expect(secondControls.map((control) => control.value)).toContain("live");
    expect(secondControls.map((control) => control.value)).toContain("reading");
    first.edit("Held draft\n");
    second.edit("Live draft\n");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderInThread).toHaveBeenCalledTimes(1);
    expect(renderInThread.mock.lastCall![0].source).toContain("Live draft");
    first.press(m.workbench_preview_run());
    expect(renderInThread.mock.lastCall![0].source).toContain("Held draft");
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
