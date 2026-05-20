import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceContainer, ServiceInitError } from "@/services/service-base";
import { defaults } from "./schema";
import { RESET_SETTING, SettingsService } from "./service";

type SettingsServiceOptions = ConstructorParameters<typeof SettingsService>[0];

class PluginStub {
  __data: unknown;

  constructor(initial: unknown = null) {
    this.__data = initial;
  }

  loadData(): Promise<unknown> {
    return Promise.resolve(this.__data);
  }

  saveData(data: unknown): Promise<void> {
    this.__data = data;
    return Promise.resolve();
  }
}

const noopMigrate = (raw: unknown): unknown => raw;

type MakeServiceOptions = Omit<Partial<SettingsServiceOptions>, "plugin"> & {
  plugin?: PluginStub;
};

function makeService(overrides: MakeServiceOptions = {}): {
  plugin: PluginStub;
  service: SettingsService;
} {
  const plugin = overrides.plugin ?? new PluginStub();
  const service = new SettingsService({
    plugin,
    migrateLegacy: noopMigrate,
    ...overrides,
  });
  return { plugin, service };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("SettingsService loading", () => {
  it("returns null current before ready and snapshot after", async () => {
    const { service } = makeService();
    expect(service.current).toBeNull();
    await service.ready;
    expect(service.current).toEqual(defaults);
  });

  it("ready resolves to undefined", async () => {
    const { service } = makeService();
    const value = await service.ready;
    expect(value).toBeUndefined();
  });

  it("loaded yields the latest snapshot (post-mutation)", async () => {
    const { service } = makeService();
    await service.ready;
    service.update({ "zotero.data-dir": "/after" });
    const snap = await service.loaded;
    expect(snap["zotero.data-dir"]).toBe("/after");
  });

  it("loaded resolves to a fresh clone disconnected from state", async () => {
    const { service } = makeService();
    const snap = await service.loaded;
    (snap as { "zotero.data-dir": string })["zotero.data-dir"] = "/tampered";
    expect(service.current?.["zotero.data-dir"]).toBe(
      defaults["zotero.data-dir"],
    );
  });

  it("subscribers receive null then the loaded value", async () => {
    const { service } = makeService();
    const seen: (object | null)[] = [];
    const unsub = service.subscribe((v) => seen.push(v));
    expect(seen).toEqual([null]);
    await service.ready;
    expect(seen[1]).toEqual(defaults);
    unsub();
  });

  it("subscribers receive fresh clones (not the same reference twice)", async () => {
    const { service } = makeService();
    const seen: (object | null)[] = [];
    service.subscribe((v) => seen.push(v));
    await service.ready;
    service.update({ "server.enabled": true });
    // initial null + initial-load snapshot + after update
    expect(seen[1]).not.toBe(seen[2]);
  });

  it("current returns a distinct fresh clone per access", async () => {
    const { service } = makeService();
    await service.ready;
    const a = service.current;
    const b = service.current;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("update() return value is a fresh clone disconnected from state", async () => {
    const { service } = makeService();
    await service.ready;
    const returned = service.update({ "zotero.data-dir": "/x" });
    expect(returned).toEqual({ ...defaults, "zotero.data-dir": "/x" });
    // Mutating the returned snapshot must not affect the service.
    (returned as { "zotero.data-dir": string })["zotero.data-dir"] =
      "/tampered";
    expect(service.current?.["zotero.data-dir"]).toBe("/x");
  });

  it("a throwing subscriber does not break load or other subscribers", async () => {
    const { service } = makeService();
    const seen: (object | null)[] = [];
    service.subscribe(() => {
      throw new Error("boom");
    });
    service.subscribe((v) => seen.push(v));
    await expect(service.ready).resolves.toBeUndefined();
    expect(seen).toEqual([null, defaults]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("a throwing subscriber does not break mutations", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.subscribe(() => {
      throw new Error("boom");
    });
    expect(() => service.update({ "zotero.data-dir": "/x" })).not.toThrow();
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "zotero.data-dir": "/x",
    });
  });

  it("null disk data loads defaults with empty overrides and does not save", async () => {
    const { service, plugin } = makeService();
    const saveSpy = vi.spyOn(plugin, "saveData");
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("valid v1 sparse object loads schema-known overrides and does not save", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "zotero.data-dir": "/from-disk",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/from-disk",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("v1 non-schema keys are ignored and the v1 file is not rewritten", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "zotero.data-dir": "/ok",
      unknownKey: "noise",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/ok",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("v1 invalid per-key values are dropped and the v1 file is not rewritten", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "zotero.data-dir": "/kept",
      "server.enabled": "not-a-boolean",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/kept",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("future __VERSION__ falls back to defaults and never saves", async () => {
    const plugin = new PluginStub({
      __VERSION__: 5,
      "zotero.data-dir": "/ignored",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("malformed disk data falls back to defaults without saving", async () => {
    const plugin = new PluginStub("not-an-object");
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("loadData rejection makes ready reject", async () => {
    const plugin = new PluginStub();
    vi.spyOn(plugin, "loadData").mockRejectedValueOnce(
      new Error("disk on fire"),
    );
    const { service } = makeService({ plugin });
    await expect(service.ready).rejects.toThrow("disk on fire");
  });

  it("loadData rejection through ServiceContainer is wrapped in ServiceInitError", async () => {
    const plugin = new PluginStub();
    vi.spyOn(plugin, "loadData").mockRejectedValueOnce(
      new Error("disk on fire"),
    );
    await using stack = new AsyncDisposableStack();
    const container = new ServiceContainer(stack, () => {});
    const registered = container.use({
      settings: () =>
        new SettingsService({
          plugin,
          migrateLegacy: noopMigrate,
        }),
    });
    await expect(registered.services.settings.ready).rejects.toBeInstanceOf(
      ServiceInitError,
    );
  });
});

describe("SettingsService legacy migration", () => {
  it("migrates schema-known keys, drops non-schema keys, writes v1 best-effort", async () => {
    const plugin = new PluginStub({
      "zotero.data-dir": "/from-legacy",
      junk: 1,
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/from-legacy",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 1,
      "zotero.data-dir": "/from-legacy",
    });
  });

  it("drops invalid schema-known values during legacy migration", async () => {
    const plugin = new PluginStub({
      "zotero.data-dir": "/kept",
      "server.enabled": "not-a-boolean",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/kept",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 1,
      "zotero.data-dir": "/kept",
    });
  });

  it("falls back to defaults on migration throw and writes empty v1", async () => {
    const plugin = new PluginStub({ legacy: "stuff" });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateLegacy: () => {
        throw new Error("boom");
      },
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 1 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to defaults when migration returns non-plain object", async () => {
    const plugin = new PluginStub({ legacy: "stuff" });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateLegacy: () => 42,
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 1 });
  });

  it("treats a Promise return from migrateLegacy as non-plain (no async hooks)", async () => {
    const plugin = new PluginStub({ "zotero.data-dir": "/legacy" });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      // Promise prototype is not Object.prototype, so this hits the "non-plain
      // return" branch — proves the hook is treated synchronously, never awaited.
      migrateLegacy: () => Promise.resolve({ "zotero.data-dir": "/legacy" }),
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 1 });
  });

  it("logs but stays loaded when legacy migration write fails", async () => {
    const plugin = new PluginStub({ "zotero.data-dir": "/legacy-path" });
    vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("disk full"));
    const { service } = makeService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "zotero.data-dir": "/legacy-path",
    });
    expect(errorSpy).toHaveBeenCalled();
    // Failed migration writes must not leak into pendingWrite: a subsequent
    // flush() should observe no pending work and resolve cleanly.
    await expect(service.flush()).resolves.toBeUndefined();
  });
});

describe("SettingsService mutations", () => {
  it("update() before ready throws and points callers at ready/loaded", () => {
    const { service } = makeService();
    expect(() => service.update({ "zotero.data-dir": "/x" })).toThrow(
      /await service\.ready.*service\.loaded/,
    );
  });

  it("reset() before ready throws and points callers at ready/loaded", () => {
    const { service } = makeService();
    expect(() => service.reset()).toThrow(
      /await service\.ready.*service\.loaded/,
    );
  });

  it("update() with unknown key throws and leaves state unchanged", async () => {
    const { service } = makeService();
    await service.ready;
    const before = service.current;
    expect(() =>
      // @ts-expect-error — invalid key for runtime check
      service.update({ unknown: 1 }),
    ).toThrow(/unknown settings key/);
    expect(service.current).toEqual(before);
  });

  it("update() rejects __VERSION__ and leaves state unchanged", async () => {
    const { service } = makeService();
    await service.ready;
    const before = service.current;
    expect(() =>
      // @ts-expect-error — reserved key for runtime check
      service.update({ __VERSION__: 2 }),
    ).toThrow(/reserved/);
    expect(service.current).toEqual(before);
  });

  it("update() with invalid value throws and leaves state unchanged", async () => {
    const { service } = makeService();
    await service.ready;
    const before = service.current;
    expect(() =>
      // @ts-expect-error — wrong type for runtime check
      service.update({ "server.enabled": "loud" }),
    ).toThrow(/invalid settings/);
    expect(service.current).toEqual(before);
  });

  it("update() supports synchronous updater functions", async () => {
    const { service } = makeService();
    await service.ready;
    service.update((current) => ({
      "server.enabled": !current["server.enabled"],
    }));
    expect(service.current?.["server.enabled"]).toBe(
      !defaults["server.enabled"],
    );
  });

  it("RESET_SETTING deletes an override but other overrides remain", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.update({ "zotero.data-dir": "/x", "server.enabled": true });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "zotero.data-dir": "/x",
      "server.enabled": true,
    });
    service.update({ "zotero.data-dir": RESET_SETTING });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "server.enabled": true,
    });
  });

  it("default-equal values persist as explicit overrides", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.update({ "zotero.data-dir": defaults["zotero.data-dir"] });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "zotero.data-dir": defaults["zotero.data-dir"],
    });
  });

  it("reset() deletes selected overrides and throws on unknown keys", async () => {
    const { service } = makeService();
    await service.ready;
    service.update({ "zotero.data-dir": "/x", "server.enabled": true });
    expect(() =>
      service.reset([
        // @ts-expect-error — invalid key for runtime check
        "unknown",
      ]),
    ).toThrow(/unknown settings key/);
    service.reset(["zotero.data-dir"]);
    expect(service.current).toEqual({ ...defaults, "server.enabled": true });
  });

  it("reset() with no arguments clears all overrides", async () => {
    const { service } = makeService();
    await service.ready;
    service.update({ "zotero.data-dir": "/x", "server.enabled": true });
    service.reset();
    expect(service.current).toEqual(defaults);
  });

  it("update({}) still notifies subscribers and schedules a save", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    const seen: (object | null)[] = [];
    service.subscribe((v) => seen.push(v));
    expect(seen).toHaveLength(1);
    service.update({});
    expect(seen).toHaveLength(2);
    await service.flush();
    expect(plugin.__data).toEqual({ __VERSION__: 1 });
  });

  it("reset() of un-overridden keys still notifies and schedules a save", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    const seen: (object | null)[] = [];
    service.subscribe((v) => seen.push(v));
    service.reset(["zotero.data-dir"]);
    expect(seen).toHaveLength(2);
    await service.flush();
    expect(plugin.__data).toEqual({ __VERSION__: 1 });
  });
});

describe("SettingsService persistence", () => {
  it("save output is sparse (only overrides + version)", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.update({ "server.enabled": true });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "server.enabled": true,
    });
  });

  it("flush() coalesces multiple updates into one debounced write", async () => {
    const { service, plugin } = makeService();
    const saveSpy = vi.spyOn(plugin, "saveData");
    await service.ready;
    service.update({ "zotero.data-dir": "/a" });
    service.update({ "zotero.data-dir": "/b" });
    service.update({ "zotero.data-dir": "/c" });
    expect(saveSpy).not.toHaveBeenCalled();
    await service.flush();
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 1,
      "zotero.data-dir": "/c",
    });
  });

  it("flush() before load resolves without saving", async () => {
    const plugin = new PluginStub();
    let resolveLoad!: (value: unknown) => void;
    vi.spyOn(plugin, "loadData").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    // Service is unloaded — flush() must not load settings or trigger a save.
    await expect(service.flush()).resolves.toBeUndefined();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(plugin.__data).toBeNull();
    // Let the held load finish so the test's afterEach can clean up.
    resolveLoad(null);
    await service.ready;
  });

  it("flush() awaits in-flight writes", async () => {
    const { service, plugin } = makeService();
    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    vi.spyOn(plugin, "saveData").mockImplementationOnce(async () => {
      await slowSave;
    });
    await service.ready;
    service.update({ "zotero.data-dir": "/slow" });

    const flushPromise = service.flush();
    let flushed = false;
    void flushPromise.then(() => {
      flushed = true;
    });
    // Yield: flush() should be blocked on the slow save.
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);
    resolveSave();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it("background save failure is logged and observable through flush()", async () => {
    const { service, plugin } = makeService();
    vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("io fail"));
    await service.ready;
    service.update({ "zotero.data-dir": "/x" });
    await expect(service.flush()).rejects.toThrow("io fail");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("service disposal flushes pending writes via the committed defer", async () => {
    const plugin = new PluginStub();
    const stack = new AsyncDisposableStack();
    const service = stack.use(
      new SettingsService({
        plugin,
        migrateLegacy: noopMigrate,
      }),
    );
    await service.ready;
    service.update({ "zotero.data-dir": "/on-dispose" });
    expect(plugin.__data).toBeNull();
    await stack.disposeAsync();
    expect(plugin.__data).toEqual({
      __VERSION__: 1,
      "zotero.data-dir": "/on-dispose",
    });
  });
});
