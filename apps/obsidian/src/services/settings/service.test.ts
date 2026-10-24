import { beforeEach, describe, expect, vi } from "vitest";

import { Effect, Fiber, Logger, Queue } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";
import { highlightEmoji } from "@/lib/highlight-mapping";

import { settingsRuntimeBridgeOf } from "./__fixtures__";
import type { SettingsFixtureOptions } from "./__fixtures__";
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
  migrateV9ToV10,
  migrateV10ToV11,
} from "./migrate";
import { defaults } from "./schema";
import { RESET_SETTING } from "./service";

type SettingsServiceOptions = SettingsFixtureOptions;

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

const makeService = Effect.fnUntraced(function* (
  overrides: MakeServiceOptions = {},
) {
  const plugin = overrides.plugin ?? new PluginStub();
  const { settings, bridge, runtime } = yield* settingsRuntimeBridgeOf({
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
    migrateV9: migrateV9ToV10,
    ...overrides,
  }).pipe(
    Effect.provide(
      Logger.layer([
        Logger.make(({ logLevel, message }) => {
          if (logLevel === "Warn") warnSpy(message);
          if (logLevel === "Error") errorSpy(message);
        }),
      ]),
    ),
  );
  return {
    plugin,
    service: {
      runtime,
      get current() {
        return bridge.runSync(settings.current);
      },
      get loaded() {
        return bridge.runPromise(settings.loaded).then(() => {
          return bridge.runSync(settings.current);
        });
      },
      get diagnostics() {
        return bridge.runSync(settings.diagnostics);
      },
      get hydrationOrigin() {
        return bridge.runSync(settings.hydrationOrigin);
      },
      update: (patch: Parameters<typeof settings.update>[0]) =>
        bridge.runSync(settings.update(patch)),
      reset: (keys?: Parameters<typeof settings.reset>[0]) =>
        bridge.runSync(settings.reset(keys)),
      updateDefaultLiteratureNoteProfileBindings: (
        patch: Parameters<
          typeof settings.updateDefaultLiteratureNoteProfileBindings
        >[0],
      ) =>
        bridge.runSync(
          settings.updateDefaultLiteratureNoteProfileBindings(patch),
        ),
      flush: () => bridge.runPromise(settings.flush()),
      release: () => bridge.runSync(settings.release()),
      changes: settings.changes,
    },
  };
});

function defaultProfileWith(
  bindings: Partial<(typeof defaults)["note.default-profile"]["bindings"]> = {},
) {
  return {
    bindings: {
      ...defaults["note.default-profile"].bindings,
      ...bindings,
    },
  };
}

function migratedSettings(
  bindings: Partial<(typeof defaults)["note.default-profile"]["bindings"]> = {},
  overrides: Partial<typeof defaults> = {},
) {
  return {
    ...defaults,
    ...overrides,
    "note.default-profile": defaultProfileWith(bindings),
  };
}

const warnSpy = vi.fn();
const errorSpy = vi.fn();

it.effect(
  "preserves the completed template conversion across a settings reload",
  () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({ __VERSION__: 11 });
      const service = (yield* makeService({ plugin })).service;
      yield* Effect.promise(() => service.loaded);
      service.update({
        "note.template-conversion-result": {
          document: "Research templates/zotlit-profile.default.md",
          trashed: 4,
          pendingCleanup: [],
        },
      });
      yield* Effect.promise(() => service.flush());

      const reopened = (yield* makeService({ plugin })).service;
      expect(
        (yield* Effect.promise(() => reopened.loaded))[
          "note.template-conversion-result"
        ],
      ).toEqual({
        document: "Research templates/zotlit-profile.default.md",
        trashed: 4,
        pendingCleanup: [],
      });
    }),
);

beforeEach(() => {
  warnSpy.mockClear();
  errorSpy.mockClear();
});

describe("PluginSettings loading", () => {
  it.effect.each([false, true])(
    "keeps an existing colored highlight toggle: %s",
    (enabled) =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 9,
          "note.import-colored-highlights": enabled,
        });
        const service = (yield* makeService({ plugin })).service;
        const settings = yield* Effect.promise(() => service.loaded);

        expect(
          settings["note.default-profile"].bindings[
            "note.import-colored-highlights"
          ],
        ).toBe(enabled);
        expect(
          highlightEmoji("blue", settings["note.import-highlight-mappings"]),
        ).toBe("🔵");
        expect(
          highlightEmoji("magenta", settings["note.import-highlight-mappings"]),
        ).toBeNull();
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.import-colored-highlights": enabled,
          }),
        });
      }),
  );

  it.effect("keeps custom mappings on disk while the toggle is off", () =>
    Effect.gen(function* () {
      const { plugin, service } = yield* makeService();
      const store = service;
      yield* Effect.promise(() => store.loaded);
      const mappings = {
        blue: { output: "custom", customEmoji: "👩‍🔬" },
      } as const;
      store.updateDefaultLiteratureNoteProfileBindings({
        "note.import-colored-highlights": true,
      });
      store.update({ "note.import-highlight-mappings": mappings });
      store.updateDefaultLiteratureNoteProfileBindings({
        "note.import-colored-highlights": false,
      });
      yield* Effect.promise(() => store.flush());

      const reloaded = (yield* makeService({ plugin })).service;
      const saved = yield* Effect.promise(() => reloaded.loaded);
      expect(
        saved["note.default-profile"].bindings[
          "note.import-colored-highlights"
        ],
      ).toBe(false);
      expect(saved["note.import-highlight-mappings"]).toEqual(mappings);
      reloaded.updateDefaultLiteratureNoteProfileBindings({
        "note.import-colored-highlights": true,
      });
      expect(
        highlightEmoji(
          "blue",
          reloaded.current!["note.import-highlight-mappings"],
        ),
      ).toBe("👩‍🔬");
    }),
  );

  it.effect(
    "migrates old global note values into the default Profile without changing effective values",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 9,
          "citation.references-style": "apa",
          "note.literature-folder": "Law",
          "note.import-folder": "Law/Imported",
          "note.import-colored-highlights": true,
          "note.import-annotations-as-template": true,
          "note.default-profile": { document: "law.md" },
        });
        const { service } = yield* makeService({
          plugin,
          migrateV9: migrateV9ToV10,
        });

        yield* Effect.promise(() => service.loaded);

        expect(service.current?.["note.default-profile"]).toEqual({
          bindings: {
            "citation.references-style": "apa",
            "note.literature-folder": "Law",
            "note.import-folder": "Law/Imported",
            "note.import-colored-highlights": true,
            "note.import-annotations-as-template": true,
          },
        });
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "note.default-profile": service.current?.["note.default-profile"],
        });
      }),
  );

  it.effect("loaded yields the latest snapshot (post-mutation)", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.hostname": "/after" });
      const snap = yield* Effect.promise(() => service.loaded);
      expect(snap["server.hostname"]).toBe("/after");
    }),
  );

  it.effect("loaded resolves to a fresh clone disconnected from state", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const snap = yield* Effect.promise(() => service.loaded);
      (snap as { "server.hostname": string })["server.hostname"] = "/tampered";
      expect(service.current?.["server.hostname"]).toBe(
        defaults["server.hostname"],
      );
    }),
  );

  it.effect("subscribers receive the settled value", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const seen: (object | null)[] = [];
      const unsub = subscribe(service.runtime, service.changes, (v) =>
        seen.push(v),
      );
      expect(seen).toEqual([defaults]);
      yield* Effect.promise(() => service.loaded);
      expect(seen[0]).toEqual(defaults);
      unsub();
    }),
  );

  it.effect(
    "update() return value is a fresh clone disconnected from state",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        yield* Effect.promise(() => service.loaded);
        const returned = service.update({ "server.hostname": "/x" });
        expect(returned).toEqual({ ...defaults, "server.hostname": "/x" });
        // Mutating the returned snapshot must not affect the service.
        (returned as { "server.hostname": string })["server.hostname"] =
          "/tampered";
        expect(service.current?.["server.hostname"]).toBe("/x");
      }),
  );

  it.effect(
    "a throwing subscriber does not break load or other subscribers",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const seen: (object | null)[] = [];
        subscribe(service.runtime, service.changes, () => {
          throw new Error("boom");
        });
        subscribe(service.runtime, service.changes, (v) => seen.push(v));
        yield* Effect.promise(() =>
          expect(service.loaded).resolves.toEqual(defaults),
        );
        expect(seen).toEqual([defaults]);
        expect(errorSpy).toHaveBeenCalled();
      }),
  );

  it.effect("a throwing subscriber does not break mutations", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      subscribe(service.runtime, service.changes, () => {
        throw new Error("boom");
      });
      expect(() => service.update({ "server.hostname": "/x" })).not.toThrow();
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.hostname": "/x",
      });
    }),
  );

  it.effect(
    "null disk data loads defaults with empty overrides and does not save",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeService();
        const saveSpy = vi.spyOn(plugin, "saveData");
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "valid v11 sparse object loads schema-known overrides and does not save",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 11,
          "server.hostname": "/from-disk",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual({
          ...defaults,
          "server.hostname": "/from-disk",
        });
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "v11 non-schema keys are ignored and the file is not rewritten",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 11,
          "server.hostname": "/ok",
          unknownKey: "noise",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual({
          ...defaults,
          "server.hostname": "/ok",
        });
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "v11 invalid per-key values fall back to their default and the file is not rewritten",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 11,
          "server.hostname": "/kept",
          "server.enabled": "not-a-boolean",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual({
          ...defaults,
          "server.hostname": "/kept",
        });
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "v11 frontmatter field missing language falls back to the default and other keys survive",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 11,
          "note.frontmatter-fields": [
            { key: "title", expr: "zt.title", merge: "replace" },
          ],
          "server.hostname": "Refs",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual({
          ...defaults,
          "server.hostname": "Refs",
        });
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect("malformed disk data falls back to defaults without saving", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub("not-an-object");
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({ plugin });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual(defaults);
      expect(saveSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    }),
  );

  it.effect("loadData rejection logs and uses defaults", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub();
      vi.spyOn(plugin, "loadData").mockRejectedValueOnce(
        new Error("disk on fire"),
      );
      const { service } = yield* makeService({ plugin });
      expect(yield* Effect.promise(() => service.loaded)).toEqual(defaults);
      expect(errorSpy).toHaveBeenCalled();
    }),
  );
});

describe("PluginSettings default Profile", () => {
  it.effect("stores only the total default bindings", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.updateDefaultLiteratureNoteProfileBindings({
        "note.literature-folder": "Reading",
      });
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "note.default-profile": {
          bindings: {
            "note.literature-folder": "Reading",
            "citation.references-style": null,
            "note.import-folder": "zotero_notes",
            "note.import-colored-highlights": false,
            "note.import-annotations-as-template": false,
          },
        },
      });
    }),
  );
});

describe("PluginSettings hydrationOrigin", () => {
  it.effect("has a settled origin when acquired", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      expect(service.hydrationOrigin).toBe("absent");
    }),
  );

  it.effect("reports 'absent' for missing data", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService({ plugin: new PluginStub(null) });
      yield* Effect.promise(() => service.loaded);
      expect(service.hydrationOrigin).toBe("absent");
    }),
  );

  it.effect("reports 'malformed' for non-plain data", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService({
        plugin: new PluginStub("not-an-object"),
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.hydrationOrigin).toBe("malformed");
    }),
  );

  it.effect("reports 'legacy' for versionless (v1 upgrade) data", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService({
        plugin: new PluginStub({ "note.literature-folder": "/legacy" }),
        migrateLegacy: (raw) => raw,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.hydrationOrigin).toBe("legacy");
    }),
  );

  it.effect("reports 'current' for v11 data", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService({
        plugin: new PluginStub({ __VERSION__: 11, "server.hostname": "R" }),
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.hydrationOrigin).toBe("current");
    }),
  );
});

describe("PluginSettings legacy migration", () => {
  it.effect(
    "migrates schema-known keys, drops non-schema keys, writes v11 best-effort",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          "note.literature-folder": "/from-legacy",
          junk: 1,
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateLegacy: (raw) => raw,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/from-legacy" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-legacy",
          }),
        });
      }),
  );

  it.effect("drops invalid schema-known values during legacy migration", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        "note.literature-folder": "/kept",
        "server.enabled": "not-a-boolean",
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
        plugin,
        migrateLegacy: (raw) => raw,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual(
        migratedSettings({ "note.literature-folder": "/kept" }),
      );
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "note.default-profile": defaultProfileWith({
          "note.literature-folder": "/kept",
        }),
      });
    }),
  );

  it.effect(
    "falls back to defaults on migration throw and writes empty v11",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({ legacy: "stuff" });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateLegacy: () => {
            throw new Error("boom");
          },
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 11 });
        expect(warnSpy).toHaveBeenCalled();
      }),
  );

  it.effect(
    "falls back to defaults when migration returns non-plain object",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({ legacy: "stuff" });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateLegacy: () => 42,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 11 });
      }),
  );

  it.effect(
    "treats a Promise return from migrateLegacy as non-plain (no async hooks)",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({ "note.literature-folder": "/legacy" });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          // Promise prototype is not Object.prototype, so this hits the "non-plain
          // return" branch — proves the hook is treated synchronously, never awaited.
          migrateLegacy: () =>
            Promise.resolve({ "note.literature-folder": "/legacy" }),
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 11 });
      }),
  );

  it.effect("logs but stays loaded when legacy migration write fails", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        "note.literature-folder": "/legacy-path",
      });
      vi.spyOn(plugin, "saveData").mockRejectedValueOnce(
        new Error("disk full"),
      );
      const { service } = yield* makeService({
        plugin,
        migrateLegacy: (raw) => raw,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual(
        migratedSettings({ "note.literature-folder": "/legacy-path" }),
      );
      expect(errorSpy).toHaveBeenCalled();
      // Failed migration writes must not leak into pendingWrite: a subsequent
      // flush() should observe no pending work and resolve cleanly.
      yield* Effect.promise(() =>
        expect(service.flush()).resolves.toBeUndefined(),
      );
    }),
  );
});

describe("PluginSettings v1→v11 migration", () => {
  it.effect(
    "migrates schema-known keys, drops non-schema keys, writes v11 best-effort",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.literature-folder": "/from-v1",
          unknownKey: "noise",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/from-v1" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-v1",
          }),
        });
      }),
  );

  it.effect(
    "drops invalid schema-known values and writes v11 without them",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.literature-folder": "/kept",
          "server.enabled": "not-a-boolean",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/kept" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/kept",
          }),
        });
      }),
  );

  it.effect(
    "drops frontmatter fields still missing merge after migration and writes v11 without them",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.frontmatter-fields": [{ key: "title", expr: "zt.title" }],
          "note.literature-folder": "/kept",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/kept" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/kept",
          }),
        });
      }),
  );

  it.effect(
    "happy path: stamps/rewrites frontmatter field language and writes v11 exactly once",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.frontmatter-fields": [
            { key: "title", expr: "zt.title", merge: "replace" },
            { key: "custom", expr: "zt.custom", merge: "replace" },
          ],
          "note.literature-folder": "/from-v1",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV1: migrateV1ToV2,
          migrateV2: migrateV2ToV3,
          migrateV3: migrateV3ToV4,
          migrateV4: migrateV4ToV5,
          migrateV5: migrateV5ToV6,
          migrateV6: migrateV6ToV7,
          migrateV7: migrateV7ToV8,
        });
        yield* Effect.promise(() => service.loaded);

        const migratedFields = [
          {
            key: "title",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
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
        ] as const;
        expect(service.current).toEqual(
          migratedSettings(
            { "note.literature-folder": "/from-v1" },
            {
              "note.frontmatter-fields": migratedFields,
              "citation.open-as-links": true,
            },
          ),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.frontmatter-fields": migratedFields,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-v1",
          }),
          "citation.open-as-links": true,
        });
      }),
  );

  it.effect(
    "a hand-edited field missing merge still fails per-key validation and drops the whole key to defaults",
    () =>
      Effect.gen(function* () {
        // migrateV1ToV2 stamps `language` onto this plain object, but `merge` is
        // still absent, so the whole `note.frontmatter-fields` array fails
        // frontmatterFieldSchema and the key drops to its default.
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.frontmatter-fields": [{ key: "custom", expr: "zt.custom" }],
          "note.literature-folder": "/kept",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV1: migrateV1ToV2,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/kept" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/kept",
          }),
        });
      }),
  );

  it.effect(
    "falls back to defaults on migrateV1 throw and writes empty v11",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.literature-folder": "/x",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV1: () => {
            throw new Error("boom");
          },
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 11 });
        expect(warnSpy).toHaveBeenCalled();
      }),
  );

  it.effect(
    "falls back to defaults when migrateV1 returns a non-plain object",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "note.literature-folder": "/x",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV1: () => 42,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({ __VERSION__: 11 });
      }),
  );

  it.effect("v2 data runs all compatibility migrations and writes v11", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        __VERSION__: 2,
        "note.literature-folder": "/from-v2",
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
        plugin,
        migrateV2: migrateV2ToV3,
        migrateV3: migrateV3ToV4,
        migrateV4: migrateV4ToV5,
        migrateV5: migrateV5ToV6,
        migrateV6: migrateV6ToV7,
        migrateV7: migrateV7ToV8,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual(
        migratedSettings(
          { "note.literature-folder": "/from-v2" },
          { "citation.open-as-links": true },
        ),
      );
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "citation.open-as-links": true,
        "note.default-profile": defaultProfileWith({
          "note.literature-folder": "/from-v2",
        }),
      });
    }),
  );

  it.effect(
    "v3 data carries Citation Key Links into Pandoc navigation and writes v11",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 3,
          "citation.key-links": true,
          "note.literature-folder": "/from-v3",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV3: migrateV3ToV4,
          migrateV6: migrateV6ToV7,
          migrateV7: migrateV7ToV8,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings(
            { "note.literature-folder": "/from-v3" },
            { "citation.open-as-links": true },
          ),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "citation.open-as-links": true,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-v3",
          }),
        });
      }),
  );

  it.effect(
    "v3 data without Citation Key Links keeps Pandoc navigation off",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 3,
          "note.literature-folder": "/from-v3",
        });
        const { service } = yield* makeService({
          plugin,
          migrateV3: migrateV3ToV4,
          migrateV6: migrateV6ToV7,
          migrateV7: migrateV7ToV8,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings(
            { "note.literature-folder": "/from-v3" },
            { "citation.open-as-links": false },
          ),
        );
      }),
  );

  it.effect(
    "v4 data drops the retired Citation Key Property and writes v11",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 4,
          "citation.key-links-frontmatter-key": "bibkey",
          "note.literature-folder": "/from-v4",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV4: migrateV4ToV5,
          migrateV5: migrateV5ToV6,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings({ "note.literature-folder": "/from-v4" }),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-v4",
          }),
        });
      }),
  );

  it.effect("v5 data preserves the Pandoc and wikilink choices", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        __VERSION__: 5,
        "citation.citekey-indexing": false,
        "citation.wikilink-citations": true,
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
        plugin,
        migrateV5: migrateV5ToV6,
      });
      yield* Effect.promise(() => service.loaded);

      expect(service.current).toEqual({
        ...defaults,
        "citation.pandoc-citations": false,
        "citation.wikilink-citations": true,
      });
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "citation.pandoc-citations": false,
        "citation.wikilink-citations": true,
        "note.default-profile": defaultProfileWith(),
      });
    }),
  );

  it.effect(
    "moves the Annotation Link opening choice to the Reader setting",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 10,
          "citation.open-annotation-links": false,
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV10: migrateV10ToV11,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current["reader.open-annotation-links"]).toBe(false);
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "reader.open-annotation-links": false,
        });
      }),
  );

  it.effect("v6 data maps Citekey Editor Treatment to Pandoc navigation", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        __VERSION__: 6,
        "citation.citekey-editor": true,
        "note.literature-folder": "/from-v6",
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
        plugin,
        migrateV6: migrateV6ToV7,
        migrateV7: migrateV7ToV8,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual(
        migratedSettings(
          { "note.literature-folder": "/from-v6" },
          { "citation.open-as-links": true },
        ),
      );
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "citation.open-as-links": true,
        "note.default-profile": defaultProfileWith({
          "note.literature-folder": "/from-v6",
        }),
      });
    }),
  );

  it.effect(
    "v7 data materializes the Pandoc navigation default and writes v11",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 7,
          "note.literature-folder": "/from-v7",
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV7: migrateV7ToV8,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(
          migratedSettings(
            { "note.literature-folder": "/from-v7" },
            { "citation.open-as-links": true },
          ),
        );
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "citation.open-as-links": true,
          "note.default-profile": defaultProfileWith({
            "note.literature-folder": "/from-v7",
          }),
        });
      }),
  );

  it.effect("v7 data keeps an explicit navigation opt-out and writes v11", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({
        __VERSION__: 7,
        "citation.open-pandoc-links": false,
      });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
        plugin,
        migrateV7: migrateV7ToV8,
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual({
        ...defaults,
        "citation.open-as-links": false,
      });
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "citation.open-as-links": false,
        "note.default-profile": defaultProfileWith(),
      });
    }),
  );

  it.effect.each([1, 4] as const)(
    "v8 data with default library %i selects my library and drops the retired key",
    (citationLibrary) =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 8,
          "zotero.citation-library": citationLibrary,
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({
          plugin,
          migrateV8: migrateV8ToV9,
        });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual({
          ...defaults,
          "zotero.library-scope": {
            mode: "selected",
            libraries: [{ type: "personal" }],
          },
        });
        expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith(),
          "zotero.library-scope": {
            mode: "selected",
            libraries: [{ type: "personal" }],
          },
        });
      }),
  );

  it.effect("legacy v0 data selects my library and drops the retired key", () =>
    Effect.gen(function* () {
      const plugin = new PluginStub({ citationLibrary: 4 });
      const saveSpy = vi.spyOn(plugin, "saveData");
      const { service } = yield* makeService({
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
      yield* Effect.promise(() => service.loaded);
      expect(service.current).toEqual({
        ...defaults,
        "citation.open-as-links": true,
        "zotero.library-scope": {
          mode: "selected",
          libraries: [{ type: "personal" }],
        },
      });
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "citation.open-as-links": true,
        "note.default-profile": defaultProfileWith(),
        "zotero.library-scope": {
          mode: "selected",
          libraries: [{ type: "personal" }],
        },
      });
    }),
  );

  it.effect(
    "a fresh installation persists no override and discovers every library",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub(null);
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current?.["zotero.library-scope"]).toEqual({
          mode: "all",
        });
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect.each([
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
    "a current v11 library scope naming %s loads unchanged and is not rewritten",
    ([_label, scope]) =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 11,
          "zotero.library-scope": scope,
        });
        const saveSpy = vi.spyOn(plugin, "saveData");
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current?.["zotero.library-scope"]).toEqual(scope);
        expect(service.diagnostics).toEqual([]);
        expect(saveSpy).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "version 12 is future and falls back to defaults with a warning",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({ __VERSION__: 12 });
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.current).toEqual(defaults);
        expect(warnSpy).toHaveBeenCalled();
      }),
  );
});

describe("PluginSettings broken overrides", () => {
  const makeBrokenService = () =>
    makeService({
      plugin: new PluginStub({
        __VERSION__: 11,
        "server.enabled": "not-a-boolean",
        "server.hostname": "/kept",
      }),
    });

  it.effect("has settled diagnostics when acquired", () =>
    Effect.gen(function* () {
      const { service } = yield* makeBrokenService();
      expect(service.diagnostics).toEqual([
        { key: "server.enabled", value: "not-a-boolean" },
      ]);
    }),
  );

  it.effect(
    "reports the broken key and serves its default in every snapshot",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeBrokenService();
        const seen: (object | null)[] = [];
        subscribe(service.runtime, service.changes, (v) => seen.push(v));
        yield* Effect.promise(() => service.loaded);

        const effective = {
          ...defaults,
          "server.hostname": "/kept",
        };
        expect(service.current).toEqual(effective);
        expect(yield* Effect.promise(() => service.loaded)).toEqual(effective);
        expect(seen[0]).toEqual(effective);
        expect(service.diagnostics).toEqual([
          { key: "server.enabled", value: "not-a-boolean" },
        ]);
      }),
  );

  it.effect(
    "hands out a clone, so a consumer cannot mutate the persisted value",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeService({
          plugin: new PluginStub({
            __VERSION__: 11,
            "note.frontmatter-fields": [{ bogus: true }],
          }),
        });
        yield* Effect.promise(() => service.loaded);

        const handedOut = service.diagnostics[0]!.value as { bogus: boolean }[];
        handedOut[0]!.bogus = false;

        expect(service.diagnostics).toEqual([
          { key: "note.frontmatter-fields", value: [{ bogus: true }] },
        ]);
        service.update({ "server.hostname": "/moved" });
        yield* Effect.promise(() => service.flush());
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "note.frontmatter-fields": [{ bogus: true }],
          "server.hostname": "/moved",
        });
      }),
  );

  it.effect(
    "keeps the broken raw override on disk when another setting changes",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeBrokenService();
        yield* Effect.promise(() => service.loaded);
        service.update({ "server.hostname": "/moved" });
        yield* Effect.promise(() => service.flush());
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "server.enabled": "not-a-boolean",
          "server.hostname": "/moved",
        });
        expect(service.diagnostics).toEqual([
          { key: "server.enabled", value: "not-a-boolean" },
        ]);
      }),
  );

  it.effect(
    "keeps a broken library scope on disk until the user repairs it",
    () =>
      Effect.gen(function* () {
        const brokenScope = { mode: "selected", libraries: [] };
        const plugin = new PluginStub({
          __VERSION__: 11,
          "zotero.library-scope": brokenScope,
        });
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);

        expect(service.current?.["zotero.library-scope"]).toEqual(
          defaults["zotero.library-scope"],
        );
        expect(service.diagnostics).toEqual([
          { key: "zotero.library-scope", value: brokenScope },
        ]);

        service.update({ "server.hostname": "/moved" });
        yield* Effect.promise(() => service.flush());
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "zotero.library-scope": brokenScope,
          "server.hostname": "/moved",
        });

        service.update({ "zotero.library-scope": { mode: "all" } });
        yield* Effect.promise(() => service.flush());
        expect(service.diagnostics).toEqual([]);
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "zotero.library-scope": { mode: "all" },
          "server.hostname": "/moved",
        });
      }),
  );

  it.effect(
    "replaces the raw override and clears the diagnostic on repair",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeBrokenService();
        yield* Effect.promise(() => service.loaded);
        service.update({ "server.enabled": true });
        yield* Effect.promise(() => service.flush());
        expect(service.current?.["server.enabled"]).toBe(true);
        expect(service.diagnostics).toEqual([]);
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "server.enabled": true,
          "server.hostname": "/kept",
        });
      }),
  );

  it.effect("keeps the broken override when a repair fails validation", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeBrokenService();
      yield* Effect.promise(() => service.loaded);
      expect(() =>
        // @ts-expect-error — wrong type for runtime check
        service.update({ "server.enabled": "still-not-a-boolean" }),
      ).toThrow(/invalid settings/);
      service.update({ "server.hostname": "/moved" });
      yield* Effect.promise(() => service.flush());
      expect(service.diagnostics).toEqual([
        { key: "server.enabled", value: "not-a-boolean" },
      ]);
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.enabled": "not-a-boolean",
        "server.hostname": "/moved",
      });
    }),
  );

  it.effect("removes the raw override and clears the diagnostic on reset", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeBrokenService();
      yield* Effect.promise(() => service.loaded);
      service.reset(["server.enabled"]);
      yield* Effect.promise(() => service.flush());
      expect(service.diagnostics).toEqual([]);
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.hostname": "/kept",
      });
    }),
  );

  it.effect("RESET_SETTING removes the raw override too", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeBrokenService();
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.enabled": RESET_SETTING });
      yield* Effect.promise(() => service.flush());
      expect(service.diagnostics).toEqual([]);
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.hostname": "/kept",
      });
    }),
  );

  it.effect("reset() with no arguments clears every broken override", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeBrokenService();
      yield* Effect.promise(() => service.loaded);
      service.reset();
      yield* Effect.promise(() => service.flush());
      expect(service.diagnostics).toEqual([]);
      expect(plugin.__data).toEqual({ __VERSION__: 11 });
    }),
  );

  it.effect("unknown keys stay dropped without a diagnostic", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService({
        plugin: new PluginStub({ __VERSION__: 11, unknownKey: "noise" }),
      });
      yield* Effect.promise(() => service.loaded);
      expect(service.diagnostics).toEqual([]);
      service.update({ "server.hostname": "/x" });
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.hostname": "/x",
      });
    }),
  );

  it.effect(
    "migration keeps dropping invalid values instead of preserving them",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub({
          __VERSION__: 1,
          "server.enabled": "not-a-boolean",
          "server.hostname": "/kept",
        });
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        expect(service.diagnostics).toEqual([]);
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "note.default-profile": defaultProfileWith(),
          "server.hostname": "/kept",
        });
      }),
  );
});

describe("PluginSettings mutations", () => {
  it.effect("update() with unknown key throws and leaves state unchanged", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      const before = service.current;
      expect(() =>
        // @ts-expect-error — invalid key for runtime check
        service.update({ unknown: 1 }),
      ).toThrow(/unknown settings key/);
      expect(service.current).toEqual(before);
    }),
  );

  it.effect("update() rejects __VERSION__ and leaves state unchanged", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      const before = service.current;
      expect(() =>
        // @ts-expect-error — reserved key for runtime check
        service.update({ __VERSION__: 2 }),
      ).toThrow(/reserved/);
      expect(service.current).toEqual(before);
    }),
  );

  it.effect(
    "update() with invalid value throws and leaves state unchanged",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        yield* Effect.promise(() => service.loaded);
        const before = service.current;
        expect(() =>
          // @ts-expect-error — wrong type for runtime check
          service.update({ "server.enabled": "loud" }),
        ).toThrow(/invalid settings/);
        expect(service.current).toEqual(before);
      }),
  );

  it.effect("update() supports synchronous updater functions", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.update((current) => ({
        "server.enabled": !current["server.enabled"],
      }));
      expect(service.current?.["server.enabled"]).toBe(
        !defaults["server.enabled"],
      );
    }),
  );

  it.effect(
    "RESET_SETTING deletes an override but other overrides remain",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeService();
        yield* Effect.promise(() => service.loaded);
        service.update({ "server.hostname": "/x", "server.enabled": true });
        yield* Effect.promise(() => service.flush());
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "server.hostname": "/x",
          "server.enabled": true,
        });
        service.update({ "server.hostname": RESET_SETTING });
        yield* Effect.promise(() => service.flush());
        expect(plugin.__data).toEqual({
          __VERSION__: 11,
          "server.enabled": true,
        });
      }),
  );

  it.effect("default-equal values persist as explicit overrides", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.update({
        "server.hostname": defaults["server.hostname"],
      });
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.hostname": defaults["server.hostname"],
      });
    }),
  );

  it.effect(
    "reset() deletes selected overrides and throws on unknown keys",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        yield* Effect.promise(() => service.loaded);
        service.update({ "server.hostname": "/x", "server.enabled": true });
        expect(() =>
          service.reset([
            // @ts-expect-error — invalid key for runtime check
            "unknown",
          ]),
        ).toThrow(/unknown settings key/);
        service.reset(["server.hostname"]);
        expect(service.current).toEqual({
          ...defaults,
          "server.enabled": true,
        });
      }),
  );

  it.effect("reset() with no arguments clears all overrides", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.hostname": "/x", "server.enabled": true });
      service.reset();
      expect(service.current).toEqual(defaults);
    }),
  );
});

describe("PluginSettings persistence", () => {
  it.effect(
    "hands a change made just before the plugin unloads to the instance that loads next",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub();
        const handoff = {};
        const { service: before } = yield* makeService({ plugin, handoff });
        yield* Effect.promise(() => before.loaded);
        let finishWrite!: () => void;
        vi.spyOn(plugin, "saveData").mockImplementationOnce(
          (data) =>
            new Promise<void>((resolve) => {
              finishWrite = () => {
                plugin.__data = data;
                resolve();
              };
            }),
        );
        before.update({ "citation.at-trigger": true });
        before.release();
        const reopening = yield* Effect.forkChild(
          makeService({ plugin, handoff }),
          { startImmediately: true },
        );
        finishWrite();
        const { service: after } = yield* Fiber.join(reopening);
        expect(after.current?.["citation.at-trigger"]).toBe(true);
      }),
  );

  it.effect(
    "hands the next instance a change made after the unload began, as a closing view saves its state",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub();
        const handoff = {};
        const { service: before } = yield* makeService({ plugin, handoff });
        yield* Effect.promise(() => before.loaded);
        // Each write lands only when the test lets it, in the order it began.
        const writes = yield* Queue.unbounded<() => void>();
        vi.spyOn(plugin, "saveData").mockImplementation(
          (data) =>
            new Promise<void>((resolve) => {
              Queue.offerUnsafe(writes, () => {
                plugin.__data = data;
                resolve();
              });
            }),
        );
        before.update({ "citation.at-trigger": true });
        before.release();
        // The Library View closes after the plugin began to unload, and keeps
        // its document then.
        before.update({ "server.enabled": true });
        const reopening = yield* Effect.forkChild(
          makeService({ plugin, handoff }),
          { startImmediately: true },
        );
        (yield* Queue.take(writes))();
        (yield* Queue.take(writes))();
        const { service: after } = yield* Fiber.join(reopening);
        expect(after.current?.["citation.at-trigger"]).toBe(true);
        expect(after.current?.["server.enabled"]).toBe(true);
      }),
  );

  it.effect(
    "keeps the last change on disk where an earlier write would land after it",
    () =>
      Effect.gen(function* () {
        const plugin = new PluginStub();
        const { service } = yield* makeService({ plugin });
        yield* Effect.promise(() => service.loaded);
        // A disk that lands the newest of the writes in flight first.
        const writes = yield* Queue.unbounded<() => void>();
        vi.spyOn(plugin, "saveData").mockImplementation(
          (data) =>
            new Promise<void>((resolve) => {
              Queue.offerUnsafe(writes, () => {
                plugin.__data = data;
                resolve();
              });
            }),
        );
        service.update({ "server.hostname": "/a" });
        const first = service.flush();
        service.update({ "server.hostname": "/b" });
        const second = service.flush();
        (yield* Queue.take(writes))();
        (yield* Queue.take(writes))();
        yield* Effect.promise(() => Promise.all([first, second]));
        expect(plugin.__data).toMatchObject({ "server.hostname": "/b" });
      }),
  );

  it.effect("save output is sparse (only overrides + version)", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.enabled": true });
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toEqual({
        __VERSION__: 11,
        "server.enabled": true,
      });
    }),
  );

  it.effect("flush() coalesces multiple updates into one debounced write", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      const saveSpy = vi.spyOn(plugin, "saveData");
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.hostname": "/a" });
      service.update({ "server.hostname": "/b" });
      service.update({ "server.hostname": "/c" });
      expect(saveSpy).not.toHaveBeenCalled();
      yield* Effect.promise(() => service.flush());
      expect(saveSpy).toHaveBeenCalledExactlyOnceWith({
        __VERSION__: 11,
        "server.hostname": "/c",
      });
    }),
  );

  it.effect("flush() without edits resolves without saving", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      yield* Effect.promise(() => service.flush());
      expect(plugin.__data).toBeNull();
    }),
  );

  it.effect("flush() awaits in-flight writes", () =>
    Effect.gen(function* () {
      const { service, plugin } = yield* makeService();
      let resolveSave!: () => void;
      const started = Promise.withResolvers<void>();
      const slowSave = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      vi.spyOn(plugin, "saveData").mockImplementationOnce(async () => {
        started.resolve();
        await slowSave;
      });
      yield* Effect.promise(() => service.loaded);
      service.update({ "server.hostname": "/slow" });

      const flushPromise = service.flush();
      let flushed = false;
      void flushPromise.then(() => {
        flushed = true;
      });
      yield* Effect.promise(() => started.promise);
      expect(flushed).toBe(false);
      resolveSave();
      yield* Effect.promise(() => flushPromise);
      expect(flushed).toBe(true);
    }),
  );

  it.effect(
    "background save failure is logged and observable through flush()",
    () =>
      Effect.gen(function* () {
        const { service, plugin } = yield* makeService();
        vi.spyOn(plugin, "saveData").mockRejectedValueOnce(
          new Error("io fail"),
        );
        yield* Effect.promise(() => service.loaded);
        service.update({ "server.hostname": "/x" });
        yield* Effect.promise(() =>
          expect(service.flush()).rejects.toThrow("io fail"),
        );
        expect(errorSpy).toHaveBeenCalled();
      }),
  );
});
