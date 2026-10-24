// @vitest-environment happy-dom
import { expect } from "vitest";

import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Stream } from "@/lib/effect";
import { Effect } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import { it } from "@/lib/effect-vitest";
import type { LocalServer } from "@/services/local-server/service";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import { settingsRuntimeOf } from "@/services/settings/__fixtures__";

import { ZotLitSettingTab } from "./index";
import type { ZotLitSettingTabOptions } from "./index";

it.effect(
  "control writes are immediately readable and persist through the settings adapter",
  () =>
    Effect.gen(function* () {
      let disk: unknown;
      const { settings } = yield* settingsRuntimeOf({
        plugin: {
          loadData: async () => null,
          saveData: async (value) => {
            disk = value;
          },
        },
      });
      yield* settings.loaded;
      const cleanup: (() => void)[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const off of cleanup) off();
        }),
      );
      // Other tab services only register callbacks in this control-only host.
      const events = {
        on: () => () => {},
        changed: Stream.empty,
        "compile-status-changed": Stream.empty,
      };
      const changes = {
        binary: stubService<ManagedBinaryApi<Disposable | AsyncDisposable>>(
          "ManagedBinary",
          {
            changes: Stream.empty,
          },
        ),
        runSync: Effect.runSync,
        runPromise: Effect.runPromise,
      };
      const runtime = testRuntime();
      const tab = new ZotLitSettingTab({
        runtime,
        bridge: effectBridge(runtime),
        plugin: { app: {}, register: (off: () => void) => cleanup.push(off) },
        settings,
        localServer: stubService<LocalServer["Service"]>("LocalServer", {
          effectivePort: Effect.succeed(null),
          effectivePortChanges: Stream.empty,
        }),
        localBridge: events,
        libraryScope: events,
        profile: { ...events, ready: new Promise(() => {}) },
        template: events,
        languagePack: { subscribe: () => () => {} },
        pandocEngine: changes,
        chineseSegmenter: changes,
      } as unknown as ZotLitSettingTabOptions);

      tab.setControlValue("citation.at-trigger", true);
      expect(tab.getControlValue("citation.at-trigger")).toBe(true);
      tab.setControlValue("template.auto-trim-leading", "keep");
      expect(tab.getControlValue("template.auto-trim-leading")).toBe("keep");
      tab.setControlValue("log.level", "off");
      expect(tab.getControlValue("log.level")).toBe("off");
      tab.setControlValue("note-profile:default:folder", "Research");
      expect(tab.getControlValue("note-profile:default:folder")).toBe(
        "Research",
      );
      yield* settings.flush();
      expect(disk).toMatchObject({
        __VERSION__: 11,
        "citation.at-trigger": true,
        "template.auto-trim-leading": false,
        "log.level": null,
        "note.default-profile": {
          bindings: { "note.literature-folder": "Research" },
        },
      });
    }),
);
