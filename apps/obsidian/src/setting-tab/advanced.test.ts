// @vitest-environment happy-dom
import { it as effectIt } from "@effect/vitest";
import { DropdownComponent, renderRow } from "@mock/obsidian";
import { Context, Effect, Stream } from "effect";
import type { SettingDefinitionItem } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError } from "@/lib/legacy-port";
import { Vault } from "@/lib/obsidian-vault";
import * as electron from "@/lib/require";
import { FileNotFound } from "@/lib/vault-errors";
import { LocalBridge } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { profileRowServices, testSettingTab } from "./__fixtures__";
import {
  advancedPageItems,
  openLogFileInSystem,
  saveLogArchive,
} from "./advanced";
import type { SettingsKey, SettingTabContext } from "./context";

function items(overrides: Partial<SettingTabContext> = {}) {
  const settings = { ...defaults, "log.to-file": false };
  const services = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(settings),
    }),
  ).pipe(
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePort: Effect.succeed(null),
        effectivePortChanges: Stream.empty,
      }),
    ),
    Context.add(
      LocalBridge,
      stubService<LocalBridge["Service"]>("LocalBridge", {
        connection: Effect.succeed(null),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(Context.merge(services, profileRowServices())).tab,
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
    ...overrides,
  });
  return advancedPageItems(ctx);
}

it("offers each editor choice in web-enabled builds", () => {
  const preferenceName = m.template_workbench_preference_name();

  const row = items().find(
    (item): item is SettingDefinitionItem<SettingsKey> =>
      "name" in item && item.name === preferenceName,
  )!;
  const dropdown = renderRow(row).components.find(
    (control) => control instanceof DropdownComponent,
  ) as DropdownComponent;
  expect(dropdown.options).toEqual([
    { value: "ask", label: m.template_workbench_preference_ask() },
    { value: "web", label: m.template_workbench_preference_web() },
    { value: "native", label: m.template_workbench_name() },
  ]);
});

const LOG = ".obsidian/plugins/zotlit/zotlit.log";

/** The failure `effect` ends with over `vault`. */
const failureOf = <E>(
  effect: Effect.Effect<void, E, Vault>,
  vault: Partial<Vault["Service"]>,
) =>
  effect.pipe(
    Effect.provideService(Vault, stubService<Vault["Service"]>("Vault", vault)),
    Effect.flip,
  );

describe("log file actions", () => {
  effectIt.effect("fails with the reason the system cannot open the log", () =>
    Effect.gen(function* () {
      const openPath = vi.fn(async () => "No app can open this file");
      yield* Effect.acquireDisposable(
        Effect.sync(() =>
          vi
            .spyOn(electron, "requireElectron")
            .mockReturnValue(
              stubService<ReturnType<typeof electron.requireElectron>>(
                "Electron",
                { shell: stubService<Electron.Shell>("Shell", { openPath }) },
              ),
            ),
        ),
      );
      const failure = yield* failureOf(openLogFileInSystem(LOG), {
        fullPath: (path) => Effect.succeed(`/vault/${path}`),
      });
      expect(openPath).toHaveBeenCalledWith(`/vault/${LOG}`);
      expect(failure).toBeInstanceOf(LegacyPortError);
      expect(failure.message).toBe("No app can open this file");
    }),
  );

  effectIt.effect("fails the export with the log file it cannot read", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(saveLogArchive(LOG), {
        readPath: (path) =>
          Effect.fail(new FileNotFound({ path, cause: null })),
      });
      expect(failure).toBeInstanceOf(FileNotFound);
      expect(failure).toMatchObject({ path: LOG });
    }),
  );
});
