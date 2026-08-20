import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { Localization?: unknown }).Localization = class {
    formatValue(): Promise<string | null> {
      return Promise.resolve(null);
    }
  };
});

import { registerApplicationBlur } from "./application-blur.js";

class FakeWindow extends EventTarget {
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}

let activeWindow: Window | null;
let windows: FakeWindow[];
let windowMediatorListener: nsIWindowMediatorListener | undefined;

function stubServices(): void {
  (globalThis as { Services?: unknown }).Services = {
    focus: {
      get activeWindow() {
        return activeWindow;
      },
    },
    wm: {
      getEnumerator: () => windows,
      addListener(listener: nsIWindowMediatorListener) {
        windowMediatorListener = listener;
      },
      removeListener(listener: nsIWindowMediatorListener) {
        if (windowMediatorListener === listener) {
          windowMediatorListener = undefined;
        }
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  activeWindow = null;
  windows = [new FakeWindow()];
  windowMediatorListener = undefined;
  stubServices();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { Services?: unknown }).Services;
});

describe("registerApplicationBlur", () => {
  it("emits Application Blur when the deferred focus read is null", async () => {
    const onApplicationBlur = vi.fn();
    using _registration = registerApplicationBlur(onApplicationBlur);

    activeWindow = windows[0] as unknown as Window;
    windows[0]?.dispatchEvent(new Event("deactivate"));
    expect(onApplicationBlur).not.toHaveBeenCalled();
    activeWindow = null;
    await vi.runAllTimersAsync();

    expect(onApplicationBlur).toHaveBeenCalledOnce();
  });

  it("stays silent when another Zotero window is active after the tick", async () => {
    const onApplicationBlur = vi.fn();
    using _registration = registerApplicationBlur(onApplicationBlur);

    windows[0]?.dispatchEvent(new Event("deactivate"));
    activeWindow = new FakeWindow() as unknown as Window;
    await vi.runAllTimersAsync();

    expect(onApplicationBlur).not.toHaveBeenCalled();
  });

  it("attaches to top-level windows opened after registration", async () => {
    const onApplicationBlur = vi.fn();
    using _registration = registerApplicationBlur(onApplicationBlur);
    const laterWindow = new FakeWindow();

    windowMediatorListener?.onOpenWindow({
      docShell: { domWindow: laterWindow },
    } as unknown as nsIAppWindow);
    laterWindow.dispatchEvent(new Event("deactivate"));
    await vi.runAllTimersAsync();

    expect(onApplicationBlur).toHaveBeenCalledOnce();
  });

  it("removes window listeners and pending checks on dispose", async () => {
    const onApplicationBlur = vi.fn();
    const registration = registerApplicationBlur(onApplicationBlur);

    windows[0]?.dispatchEvent(new Event("deactivate"));
    registration[Symbol.dispose]();
    windows[0]?.dispatchEvent(new Event("deactivate"));
    await vi.runAllTimersAsync();

    expect(onApplicationBlur).not.toHaveBeenCalled();
  });
});
