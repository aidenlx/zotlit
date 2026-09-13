import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceContainer, ServiceInitError } from "@/services/service-base";

import {
  migrateLegacyV0,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
} from "./migrate";
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
const noopMigrateV1 = (raw: unknown): unknown => raw;
const noopMigrateV2 = (raw: unknown): unknown => raw;
const noopMigrateV3 = (raw: unknown): unknown => raw;
const noopMigrateV4 = (raw: unknown): unknown => raw;
const noopMigrateV5 = (raw: unknown): unknown => raw;
const noopMigrateV6 = (raw: unknown): unknown => raw;
const noopMigrateV7 = (raw: unknown): unknown => raw;
const noopMigrateV8 = (raw: unknown): unknown => raw;

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
    migrateV1: noopMigrateV1,
    migrateV2: noopMigrateV2,
    migrateV3: noopMigrateV3,
    migrateV4: noopMigrateV4,
    migrateV5: noopMigrateV5,
    migrateV6: noopMigrateV6,
    migrateV7: noopMigrateV7,
    migrateV8: noopMigrateV8,
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
    service.update({ "note.literature-folder": "/after" });
    const snap = await service.loaded;
    expect(snap["note.literature-folder"]).toBe("/after");
  });

  it("loaded resolves to a fresh clone disconnected from state", async () => {
    const { service } = makeService();
    const snap = await service.loaded;
    (snap as { "note.literature-folder": string })["note.literature-folder"] =
      "/tampered";
    expect(service.current?.["note.literature-folder"]).toBe(
      defaults["note.literature-folder"],
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
    const returned = service.update({ "note.literature-folder": "/x" });
    expect(returned).toEqual({ ...defaults, "note.literature-folder": "/x" });
    // Mutating the returned snapshot must not affect the service.
    (returned as { "note.literature-folder": string })[
      "note.literature-folder"
    ] = "/tampered";
    expect(service.current?.["note.literature-folder"]).toBe("/x");
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
    expect(() =>
      service.update({ "note.literature-folder": "/x" }),
    ).not.toThrow();
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/x",
    });
  });

  it("null disk data loads defaults with empty overrides and does not save", async () => {
    const { service, plugin } = makeService();
    const saveSpy = vi.spyOn(plugin, "saveData");
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("valid v9 sparse object loads schema-known overrides and does not save", async () => {
    const plugin = new PluginStub({
      __VERSION__: 9,
      "note.literature-folder": "/from-disk",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/from-disk",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("v9 non-schema keys are ignored and the file is not rewritten", async () => {
    const plugin = new PluginStub({
      __VERSION__: 9,
      "note.literature-folder": "/ok",
      unknownKey: "noise",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/ok",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("v9 invalid per-key values fall back to their default and the file is not rewritten", async () => {
    const plugin = new PluginStub({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
      "server.enabled": "not-a-boolean",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/kept",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("v9 frontmatter field missing language falls back to the default and other keys survive", async () => {
    const plugin = new PluginStub({
      __VERSION__: 9,
      "note.frontmatter-fields": [
        { key: "title", expr: "zt.title", merge: "replace" },
      ],
      "note.literature-folder": "Refs",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "Refs",
    });
    expect(saveSpy).not.toHaveBeenCalled();
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
          migrateV1: noopMigrateV1,
          migrateV2: noopMigrateV2,
          migrateV3: noopMigrateV3,
          migrateV4: noopMigrateV4,
          migrateV5: noopMigrateV5,
          migrateV6: noopMigrateV6,
          migrateV7: noopMigrateV7,
          migrateV8: noopMigrateV8,
        }),
    });
    await expect(registered.services.settings.ready).rejects.toBeInstanceOf(
      ServiceInitError,
    );
  });
});

describe("SettingsService hydrationOrigin", () => {
  it("is null before load finishes", () => {
    const { service } = makeService();
    expect(service.hydrationOrigin).toBeNull();
  });

  it("reports 'absent' for missing data", async () => {
    const { service } = makeService({ plugin: new PluginStub(null) });
    await service.ready;
    expect(service.hydrationOrigin).toBe("absent");
  });

  it("reports 'malformed' for non-plain data", async () => {
    const { service } = makeService({
      plugin: new PluginStub("not-an-object"),
    });
    await service.ready;
    expect(service.hydrationOrigin).toBe("malformed");
  });

  it("reports 'legacy' for versionless (v1 upgrade) data", async () => {
    const { service } = makeService({
      plugin: new PluginStub({ "note.literature-folder": "/legacy" }),
      migrateLegacy: (raw) => raw,
    });
    await service.ready;
    expect(service.hydrationOrigin).toBe("legacy");
  });

  it("reports 'current' for v9 data", async () => {
    const { service } = makeService({
      plugin: new PluginStub({ __VERSION__: 9, "note.literature-folder": "R" }),
    });
    await service.ready;
    expect(service.hydrationOrigin).toBe("current");
  });
});

describe("SettingsService legacy migration", () => {
  it("migrates schema-known keys, drops non-schema keys, writes v9 best-effort", async () => {
    const plugin = new PluginStub({
      "note.literature-folder": "/from-legacy",
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
      "note.literature-folder": "/from-legacy",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/from-legacy",
    });
  });

  it("drops invalid schema-known values during legacy migration", async () => {
    const plugin = new PluginStub({
      "note.literature-folder": "/kept",
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
      "note.literature-folder": "/kept",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("falls back to defaults on migration throw and writes empty v9", async () => {
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
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 9 });
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
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 9 });
  });

  it("treats a Promise return from migrateLegacy as non-plain (no async hooks)", async () => {
    const plugin = new PluginStub({ "note.literature-folder": "/legacy" });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      // Promise prototype is not Object.prototype, so this hits the "non-plain
      // return" branch — proves the hook is treated synchronously, never awaited.
      migrateLegacy: () =>
        Promise.resolve({ "note.literature-folder": "/legacy" }),
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 9 });
  });

  it("logs but stays loaded when legacy migration write fails", async () => {
    const plugin = new PluginStub({ "note.literature-folder": "/legacy-path" });
    vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("disk full"));
    const { service } = makeService({
      plugin,
      migrateLegacy: (raw) => raw,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/legacy-path",
    });
    expect(errorSpy).toHaveBeenCalled();
    // Failed migration writes must not leak into pendingWrite: a subsequent
    // flush() should observe no pending work and resolve cleanly.
    await expect(service.flush()).resolves.toBeUndefined();
  });
});

describe("SettingsService v1→v9 migration", () => {
  it("migrates schema-known keys, drops non-schema keys, writes v9 best-effort", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.literature-folder": "/from-v1",
      unknownKey: "noise",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/from-v1",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/from-v1",
    });
  });

  it("drops invalid schema-known values and writes v9 without them", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.literature-folder": "/kept",
      "server.enabled": "not-a-boolean",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/kept",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("drops frontmatter fields still missing merge after migration and writes v9 without them", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.frontmatter-fields": [{ key: "title", expr: "zt.title" }],
      "note.literature-folder": "/kept",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/kept",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("happy path: stamps/rewrites frontmatter field language and writes v9 exactly once", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.frontmatter-fields": [
        { key: "title", expr: "zt.title", merge: "replace" },
        { key: "custom", expr: "zt.custom", merge: "replace" },
      ],
      "note.literature-folder": "/from-v1",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV1: migrateV1ToV2,
      migrateV2: migrateV2ToV3,
      migrateV3: migrateV3ToV4,
      migrateV4: migrateV4ToV5,
      migrateV5: migrateV5ToV6,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
    });
    await service.ready;

    const migratedFields = [
      { key: "title", expr: "zt.title", merge: "replace", language: "liquid" },
      {
        key: "custom",
        expr: "zt.custom",
        merge: "replace",
        language: "javascript",
      },
      {
        key: "citekey",
        expr: "zt.citationKey",
        merge: "replace",
        language: "liquid",
      },
    ];
    expect(service.current).toEqual({
      ...defaults,
      "note.frontmatter-fields": migratedFields,
      "note.literature-folder": "/from-v1",
      "citation.open-as-links": true,
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.frontmatter-fields": migratedFields,
      "note.literature-folder": "/from-v1",
      "citation.open-as-links": true,
    });
  });

  it("a hand-edited field missing merge still fails per-key validation and drops the whole key to defaults", async () => {
    // migrateV1ToV2 stamps `language` onto this plain object, but `merge` is
    // still absent, so the whole `note.frontmatter-fields` array fails
    // frontmatterFieldSchema and the key drops to its default.
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.frontmatter-fields": [{ key: "custom", expr: "zt.custom" }],
      "note.literature-folder": "/kept",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin, migrateV1: migrateV1ToV2 });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/kept",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("falls back to defaults on migrateV1 throw and writes empty v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.literature-folder": "/x",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV1: () => {
        throw new Error("boom");
      },
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 9 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to defaults when migrateV1 returns a non-plain object", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "note.literature-folder": "/x",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV1: () => 42,
    });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 9 });
  });

  it("v2 data runs all compatibility migrations and writes v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 2,
      "note.literature-folder": "/from-v2",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV2: migrateV2ToV3,
      migrateV3: migrateV3ToV4,
      migrateV4: migrateV4ToV5,
      migrateV5: migrateV5ToV6,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/from-v2",
      "citation.open-as-links": true,
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v2",
    });
  });

  it("v3 data carries Citation Key Links into Pandoc navigation and writes v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 3,
      "citation.key-links": true,
      "note.literature-folder": "/from-v3",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV3: migrateV3ToV4,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v3",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v3",
    });
  });

  it("v3 data without Citation Key Links keeps Pandoc navigation off", async () => {
    const plugin = new PluginStub({
      __VERSION__: 3,
      "note.literature-folder": "/from-v3",
    });
    const { service } = makeService({
      plugin,
      migrateV3: migrateV3ToV4,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": false,
      "note.literature-folder": "/from-v3",
    });
  });

  it("v4 data drops the retired Citation Key Property and writes v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 4,
      "citation.key-links-frontmatter-key": "bibkey",
      "note.literature-folder": "/from-v4",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV4: migrateV4ToV5,
      migrateV5: migrateV5ToV6,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "note.literature-folder": "/from-v4",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/from-v4",
    });
  });

  it("v5 data preserves the Pandoc and wikilink source choices", async () => {
    const plugin = new PluginStub({
      __VERSION__: 5,
      "citation.citekey-indexing": false,
      "citation.wikilink-citations": true,
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin, migrateV5: migrateV5ToV6 });
    await service.ready;

    expect(service.current).toEqual({
      ...defaults,
      "citation.pandoc-citations": false,
      "citation.wikilink-citations": true,
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.pandoc-citations": false,
      "citation.wikilink-citations": true,
    });
  });

  it("v6 data maps Citekey Editor Treatment to Pandoc navigation", async () => {
    const plugin = new PluginStub({
      __VERSION__: 6,
      "citation.citekey-editor": true,
      "note.literature-folder": "/from-v6",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v6",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v6",
    });
  });

  it("v7 data materializes the Pandoc navigation default and writes v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 7,
      "note.literature-folder": "/from-v7",
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin, migrateV7: migrateV7ToV8 });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v7",
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": true,
      "note.literature-folder": "/from-v7",
    });
  });

  it("v7 data keeps an explicit navigation opt-out and writes v9", async () => {
    const plugin = new PluginStub({
      __VERSION__: 7,
      "citation.open-pandoc-links": false,
    });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin, migrateV7: migrateV7ToV8 });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": false,
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": false,
    });
  });

  it.each([1, 4] as const)(
    "v8 data with default library %i selects my library and drops the retired key",
    async (citationLibrary) => {
      const plugin = new PluginStub({
        __VERSION__: 8,
        "zotero.citation-library": citationLibrary,
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = makeService({ plugin, migrateV8: migrateV8ToV9 });
      await service.ready;
      expect(service.current).toEqual({
        ...defaults,
        "zotero.library-scope": {
          mode: "selected",
          libraries: [{ type: "personal" }],
        },
      });
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 9,
        "zotero.library-scope": {
          mode: "selected",
          libraries: [{ type: "personal" }],
        },
      });
    },
  );

  it("legacy v0 data selects my library and drops the retired key", async () => {
    const plugin = new PluginStub({ citationLibrary: 4 });
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({
      plugin,
      migrateLegacy: migrateLegacyV0,
      migrateV1: migrateV1ToV2,
      migrateV2: migrateV2ToV3,
      migrateV3: migrateV3ToV4,
      migrateV4: migrateV4ToV5,
      migrateV5: migrateV5ToV6,
      migrateV6: migrateV6ToV7,
      migrateV7: migrateV7ToV8,
      migrateV8: migrateV8ToV9,
    });
    await service.ready;
    expect(service.current).toEqual({
      ...defaults,
      "citation.open-as-links": true,
      "zotero.library-scope": {
        mode: "selected",
        libraries: [{ type: "personal" }],
      },
    });
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "citation.open-as-links": true,
      "zotero.library-scope": {
        mode: "selected",
        libraries: [{ type: "personal" }],
      },
    });
  });

  it("a fresh installation persists no override and discovers every library", async () => {
    const plugin = new PluginStub(null);
    const saveSpy = vi.spyOn(plugin, "saveData");
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current?.["zotero.library-scope"]).toEqual({ mode: "all" });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["all libraries", { mode: "all" }],
    [
      "my library alone",
      { mode: "selected", libraries: [{ type: "personal" }] },
    ],
    [
      "my library and groups in canonical order",
      {
        mode: "selected",
        libraries: [
          { type: "personal" },
          { type: "group", groupID: 118 },
          { type: "group", groupID: 4200309 },
        ],
      },
    ],
  ] as const)(
    "a current v9 library scope naming %s loads unchanged and is not rewritten",
    async (_label, scope) => {
      const plugin = new PluginStub({
        __VERSION__: 9,
        "zotero.library-scope": scope,
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = makeService({ plugin });
      await service.ready;
      expect(service.current?.["zotero.library-scope"]).toEqual(scope);
      expect(service.diagnostics).toEqual([]);
      expect(saveSpy).not.toHaveBeenCalled();
    },
  );

  it("version 10 is future and falls back to defaults with a warning", async () => {
    const plugin = new PluginStub({ __VERSION__: 10 });
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.current).toEqual(defaults);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("SettingsService broken overrides", () => {
  function makeBrokenService(): {
    plugin: PluginStub;
    service: SettingsService;
  } {
    return makeService({
      plugin: new PluginStub({
        __VERSION__: 9,
        "server.enabled": "not-a-boolean",
        "note.literature-folder": "/kept",
      }),
    });
  }

  it("has no diagnostics before load finishes", () => {
    const { service } = makeBrokenService();
    expect(service.diagnostics).toEqual([]);
  });

  it("reports the broken key and serves its default in every snapshot", async () => {
    const { service } = makeBrokenService();
    const seen: (object | null)[] = [];
    service.subscribe((v) => seen.push(v));
    await service.ready;

    const effective = {
      ...defaults,
      "note.literature-folder": "/kept",
    };
    expect(service.current).toEqual(effective);
    expect(await service.loaded).toEqual(effective);
    expect(seen[1]).toEqual(effective);
    expect(service.diagnostics).toEqual([
      { key: "server.enabled", value: "not-a-boolean" },
    ]);
  });

  it("hands out a clone, so a consumer cannot mutate the persisted value", async () => {
    const { service, plugin } = makeService({
      plugin: new PluginStub({
        __VERSION__: 9,
        "note.frontmatter-fields": [{ bogus: true }],
      }),
    });
    await service.ready;

    const handedOut = service.diagnostics[0]!.value as { bogus: boolean }[];
    handedOut[0]!.bogus = false;

    expect(service.diagnostics).toEqual([
      { key: "note.frontmatter-fields", value: [{ bogus: true }] },
    ]);
    service.update({ "note.literature-folder": "/moved" });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.frontmatter-fields": [{ bogus: true }],
      "note.literature-folder": "/moved",
    });
  });

  it("keeps the broken raw override on disk when another setting changes", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    service.update({ "note.literature-folder": "/moved" });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "server.enabled": "not-a-boolean",
      "note.literature-folder": "/moved",
    });
    expect(service.diagnostics).toEqual([
      { key: "server.enabled", value: "not-a-boolean" },
    ]);
  });

  it("keeps a broken library scope on disk until the user repairs it", async () => {
    const brokenScope = { mode: "selected", libraries: [] };
    const plugin = new PluginStub({
      __VERSION__: 9,
      "zotero.library-scope": brokenScope,
    });
    const { service } = makeService({ plugin });
    await service.ready;

    expect(service.current?.["zotero.library-scope"]).toEqual(
      defaults["zotero.library-scope"],
    );
    expect(service.diagnostics).toEqual([
      { key: "zotero.library-scope", value: brokenScope },
    ]);

    service.update({ "note.literature-folder": "/moved" });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "zotero.library-scope": brokenScope,
      "note.literature-folder": "/moved",
    });

    service.update({ "zotero.library-scope": { mode: "all" } });
    await service.flush();
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "zotero.library-scope": { mode: "all" },
      "note.literature-folder": "/moved",
    });
  });

  it("replaces the raw override and clears the diagnostic on repair", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    service.update({ "server.enabled": true });
    await service.flush();
    expect(service.current?.["server.enabled"]).toBe(true);
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "server.enabled": true,
      "note.literature-folder": "/kept",
    });
  });

  it("keeps the broken override when a repair fails validation", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    expect(() =>
      // @ts-expect-error — wrong type for runtime check
      service.update({ "server.enabled": "still-not-a-boolean" }),
    ).toThrow(/invalid settings/);
    service.update({ "note.literature-folder": "/moved" });
    await service.flush();
    expect(service.diagnostics).toEqual([
      { key: "server.enabled", value: "not-a-boolean" },
    ]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "server.enabled": "not-a-boolean",
      "note.literature-folder": "/moved",
    });
  });

  it("removes the raw override and clears the diagnostic on reset", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    service.reset(["server.enabled"]);
    await service.flush();
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("RESET_SETTING removes the raw override too", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    service.update({ "server.enabled": RESET_SETTING });
    await service.flush();
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });

  it("reset() with no arguments clears every broken override", async () => {
    const { service, plugin } = makeBrokenService();
    await service.ready;
    service.reset();
    await service.flush();
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({ __VERSION__: 9 });
  });

  it("unknown keys stay dropped without a diagnostic", async () => {
    const { service, plugin } = makeService({
      plugin: new PluginStub({ __VERSION__: 9, unknownKey: "noise" }),
    });
    await service.ready;
    expect(service.diagnostics).toEqual([]);
    service.update({ "note.literature-folder": "/x" });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/x",
    });
  });

  it("migration keeps dropping invalid values instead of preserving them", async () => {
    const plugin = new PluginStub({
      __VERSION__: 1,
      "server.enabled": "not-a-boolean",
      "note.literature-folder": "/kept",
    });
    const { service } = makeService({ plugin });
    await service.ready;
    expect(service.diagnostics).toEqual([]);
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/kept",
    });
  });
});

describe("SettingsService mutations", () => {
  it("update() before ready throws and points callers at ready/loaded", () => {
    const { service } = makeService();
    expect(() => service.update({ "note.literature-folder": "/x" })).toThrow(
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
    service.update({ "note.literature-folder": "/x", "server.enabled": true });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/x",
      "server.enabled": true,
    });
    service.update({ "note.literature-folder": RESET_SETTING });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "server.enabled": true,
    });
  });

  it("default-equal values persist as explicit overrides", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.update({
      "note.literature-folder": defaults["note.literature-folder"],
    });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": defaults["note.literature-folder"],
    });
  });

  it("reset() deletes selected overrides and throws on unknown keys", async () => {
    const { service } = makeService();
    await service.ready;
    service.update({ "note.literature-folder": "/x", "server.enabled": true });
    expect(() =>
      service.reset([
        // @ts-expect-error — invalid key for runtime check
        "unknown",
      ]),
    ).toThrow(/unknown settings key/);
    service.reset(["note.literature-folder"]);
    expect(service.current).toEqual({ ...defaults, "server.enabled": true });
  });

  it("reset() with no arguments clears all overrides", async () => {
    const { service } = makeService();
    await service.ready;
    service.update({ "note.literature-folder": "/x", "server.enabled": true });
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
    expect(plugin.__data).toEqual({ __VERSION__: 9 });
  });

  it("reset() of un-overridden keys still notifies and schedules a save", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    const seen: (object | null)[] = [];
    service.subscribe((v) => seen.push(v));
    service.reset(["note.literature-folder"]);
    expect(seen).toHaveLength(2);
    await service.flush();
    expect(plugin.__data).toEqual({ __VERSION__: 9 });
  });
});

describe("SettingsService persistence", () => {
  it("save output is sparse (only overrides + version)", async () => {
    const { service, plugin } = makeService();
    await service.ready;
    service.update({ "server.enabled": true });
    await service.flush();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "server.enabled": true,
    });
  });

  it("flush() coalesces multiple updates into one debounced write", async () => {
    const { service, plugin } = makeService();
    const saveSpy = vi.spyOn(plugin, "saveData");
    await service.ready;
    service.update({ "note.literature-folder": "/a" });
    service.update({ "note.literature-folder": "/b" });
    service.update({ "note.literature-folder": "/c" });
    expect(saveSpy).not.toHaveBeenCalled();
    await service.flush();
    expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
      __VERSION__: 9,
      "note.literature-folder": "/c",
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
    service.update({ "note.literature-folder": "/slow" });

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
    service.update({ "note.literature-folder": "/x" });
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
        migrateV1: noopMigrateV1,
        migrateV2: noopMigrateV2,
        migrateV3: noopMigrateV3,
        migrateV4: noopMigrateV4,
        migrateV5: noopMigrateV5,
        migrateV6: noopMigrateV6,
        migrateV7: noopMigrateV7,
        migrateV8: noopMigrateV8,
      }),
    );
    await service.ready;
    service.update({ "note.literature-folder": "/on-dispose" });
    expect(plugin.__data).toBeNull();
    await stack.disposeAsync();
    expect(plugin.__data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "/on-dispose",
    });
  });
});
