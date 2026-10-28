import type { App, PluginManifest } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { getLogger } from "@/lib/log";

import {
  PREVIOUS_RELEASE_WAIT_MS,
  UnloadAwarePlugin,
} from "./plugin-lifecycle";

const manifest: PluginManifest = {
  id: "zotlit",
  name: "ZotLit",
  version: "0.0.0",
  minAppVersion: "1.14.0",
  description: "",
  author: "",
};

function loadedPlugin(): UnloadAwarePlugin {
  const plugin = new UnloadAwarePlugin(stubService<App>("App", {}), manifest);
  plugin.load();
  return plugin;
}

/** An instance whose start-up takes its turn after the instance before it. */
class TurnTakingPlugin extends UnloadAwarePlugin {
  start(stack: AsyncDisposableStack): Promise<void> {
    return this.waitForPreviousAndHoldRelease(stack);
  }
}

function instanceOn(app: App): TurnTakingPlugin {
  const plugin = new TurnTakingPlugin(app, manifest);
  plugin.load();
  return plugin;
}

describe("UnloadAwarePlugin", () => {
  it("keeps a registration's cleanup until the plugin unloads", () => {
    const plugin = loadedPlugin();
    const cleanup = vi.fn();
    plugin.register(cleanup);
    expect(cleanup).not.toHaveBeenCalled();
    plugin.unload();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  // An onload that a disable interrupts registers after the unload; Obsidian
  // never runs those cleanups, and the next enable finds the names taken.
  it("runs the cleanup of a registration after the unload at once (#1786)", () => {
    const plugin = loadedPlugin();
    plugin.unload();
    const cleanup = vi.fn();
    plugin.register(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

// A user who turns ZotLit off and on again while the old instance still
// builds or closes its runtime: the new instance's commands, zotlit:* names
// and Live Updates port must not meet the old instance's (#1786).
describe("UnloadAwarePlugin.waitForPreviousAndHoldRelease", () => {
  it("starts at once when no instance came before", async () => {
    const stack = new AsyncDisposableStack();
    await expect(
      instanceOn(stubService<App>("App", {})).start(stack),
    ).resolves.toBeUndefined();
    await stack.disposeAsync();
  });

  it("lets a start-up go on once the unloaded instance has released all it held (#1786)", async () => {
    const app = stubService<App>("App", {});
    const steps: string[] = [];
    const oldInstance = instanceOn(app);
    const oldStack = new AsyncDisposableStack();
    await oldInstance.start(oldStack);
    oldStack.defer(() => {
      steps.push("old runtime closed");
    });
    oldInstance.unload();

    // Obsidian makes the new instance as soon as it has unloaded the old one.
    const starting = instanceOn(app)
      .start(new AsyncDisposableStack())
      .then(() => steps.push("new start-up"));

    await Promise.all([oldStack.disposeAsync(), starting]);
    expect(steps).toEqual(["old runtime closed", "new start-up"]);
  });

  it("hands on the wait of an instance unloaded while it waited", async () => {
    const app = stubService<App>("App", {});
    const steps: string[] = [];
    const first = instanceOn(app);
    const firstStack = new AsyncDisposableStack();
    await first.start(firstStack);
    firstStack.defer(() => {
      steps.push("first released");
    });
    first.unload();

    const second = instanceOn(app);
    const secondStack = new AsyncDisposableStack();
    const secondWaits = second.start(secondStack);
    secondStack.defer(() => {
      steps.push("second released");
    });
    second.unload();
    // The second's onload sees the unload once its wait ends, and leaves.
    const secondLeaves = (async () => {
      await secondWaits;
      await secondStack.disposeAsync();
    })();

    const third = instanceOn(app)
      .start(new AsyncDisposableStack())
      .then(() => steps.push("third start-up"));
    await Promise.all([firstStack.disposeAsync(), secondLeaves, third]);
    expect(steps).toEqual([
      "first released",
      "second released",
      "third start-up",
    ]);
  });
});

// A previous instance whose runtime never finishes closing must not keep
// ZotLit from starting until the window reloads.
describe("UnloadAwarePlugin.waitForPreviousAndHoldRelease bound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function unloadedWithRelease(app: App): AsyncDisposableStack {
    const previous = instanceOn(app);
    const stack = new AsyncDisposableStack();
    void previous.start(stack);
    previous.unload();
    return stack;
  }

  it("starts after the bound when the previous release never settles, and warns once", async () => {
    vi.useFakeTimers();
    using warn = vi.spyOn(getLogger("plugin-lifecycle"), "warn");
    const app = stubService<App>("App", {});
    unloadedWithRelease(app);
    let startedUp = false;
    const starting = instanceOn(app)
      .start(new AsyncDisposableStack())
      .then(() => {
        startedUp = true;
      });

    await vi.advanceTimersByTimeAsync(PREVIOUS_RELEASE_WAIT_MS - 1);
    expect(startedUp).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await starting;
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      pluginId: "zotlit",
      elapsedMs: PREVIOUS_RELEASE_WAIT_MS,
    });
  });

  it("starts at once and logs nothing when the release comes before the bound", async () => {
    vi.useFakeTimers();
    using warn = vi.spyOn(getLogger("plugin-lifecycle"), "warn");
    const app = stubService<App>("App", {});
    const previousStack = unloadedWithRelease(app);
    const starting = instanceOn(app).start(new AsyncDisposableStack());

    await vi.advanceTimersByTimeAsync(PREVIOUS_RELEASE_WAIT_MS / 2);
    await Promise.all([previousStack.disposeAsync(), starting]);
    await vi.advanceTimersByTimeAsync(PREVIOUS_RELEASE_WAIT_MS);
    expect(warn).not.toHaveBeenCalled();
  });
});
