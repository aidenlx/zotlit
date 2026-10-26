// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import type { App, Plugin, PluginManifest } from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { PluginHost } from "@/lib/plugin-host";
import { AttachmentImport } from "@/services/attachment-import/service";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { LanguagePack } from "@/services/language-pack/service";
import type { LanguagePackSituation } from "@/services/language-pack/service";
import { LibraryScope } from "@/services/library-scope/service";
import { LocalBridge } from "@/services/local-bridge/service";
import type { WorkbenchConnection } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { PandocEngine } from "@/services/pandoc/service";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";

import { unimplementedTabServices } from "./__fixtures__";
import { layerSettingTab } from "./layer";
import type { SettingTabLegacy } from "./layer";

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: null,
};

const OFFERED: LanguagePackSituation = {
  kind: "offered",
  pack: { fileName: "zh-CN.json", origin: "github.com/aidenlx/zotlit" },
};

/**
 * The tab layer over services whose change streams stay quiet but for the
 * Workbench Connection, the Language Pack and the settings, which the test
 * moves. Counts each rebuild of the tab.
 */
const tabLayer = Effect.gen(function* () {
  const settings = yield* SubscriptionRef.make<Settings>(defaults);
  const connection = yield* SubscriptionRef.make<WorkbenchConnection | null>(
    null,
  );
  const situation = yield* SubscriptionRef.make<LanguagePackSituation>({
    kind: "unavailable",
  });
  const rebuilds = { count: 0 };
  const plugin = stubService<Plugin>("Plugin", {
    app: stubService<App>("App", {}),
    manifest: stubService<PluginManifest>("PluginManifest", {}),
  });
  const quiet = { changes: Stream.empty };
  const services = Context.make(
    PluginHost,
    stubService<PluginHost["Service"]>("PluginHost", {
      addSettingTab: (build) =>
        Effect.sync(() => {
          const tab = build(plugin);
          tab.update = () => void rebuilds.count++;
          return tab;
        }),
    }),
  ).pipe(
    Context.add(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {
        changes: SubscriptionRef.changes(settings),
      }),
    ),
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePortChanges: Stream.empty,
      }),
    ),
    Context.add(Profile, stubService<Profile["Service"]>("Profile", quiet)),
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        compileEvents: Stream.empty,
      }),
    ),
    Context.add(
      PandocEngine,
      stubService<PandocEngine["Service"]>("PandocEngine", quiet),
    ),
    Context.add(
      ChineseSegmenter,
      stubService<ChineseSegmenter["Service"]>("ChineseSegmenter", quiet),
    ),
    Context.add(
      LibraryScope,
      stubService<LibraryScope["Service"]>("LibraryScope", quiet),
    ),
    Context.add(
      AttachmentImport,
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFoldersChanges: Stream.empty,
      }),
    ),
    Context.add(
      LocalBridge,
      stubService<LocalBridge["Service"]>("LocalBridge", {
        changes: SubscriptionRef.changes(connection),
      }),
    ),
    Context.add(
      LanguagePack,
      stubService<LanguagePack["Service"]>("LanguagePack", {
        changes: SubscriptionRef.changes(situation),
      }),
    ),
  );
  yield* Layer.build(
    layerSettingTab(stubService<SettingTabLegacy>("SettingTabLegacy", {})).pipe(
      Layer.provide(testNotifier().layer),
      // The test gives the services the tab layer itself reads; the rest
      // stay unimplemented.
      Layer.provide(
        Layer.mergeAll(
          unimplementedTabServices,
          Layer.succeedContext(services),
        ),
      ),
    ),
  );
  return { connection, situation, settings, rebuilds };
});

it.effect(
  "rebuilds once for a connection change and a Language Pack change inside one settle window",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { connection, situation, rebuilds } = yield* tabLayer;

        yield* SubscriptionRef.set(connection, CONNECTION);
        yield* TestClock.adjust("20 millis");
        yield* SubscriptionRef.set(situation, OFFERED);
        yield* TestClock.adjust("49 millis");
        expect(rebuilds.count).toBe(0);

        yield* TestClock.adjust("1 millis");
        expect(rebuilds.count).toBe(1);
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(1);
      }),
    ),
);

it.effect(
  "rebuilds once for reminder flag flips inside one settle window, and not for other settings",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { settings, rebuilds } = yield* tabLayer;
        const flip = (
          key: "release.migration-pending" | "note.template-conversion-pending",
        ) =>
          SubscriptionRef.update(settings, (current) => ({
            ...current,
            [key]: !current[key],
          }));

        // A setting no row's presence reads leaves the definitions alone.
        yield* SubscriptionRef.update(settings, (current) => ({
          ...current,
          "log.to-file": !current["log.to-file"],
        }));
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(0);

        yield* flip("release.migration-pending");
        yield* TestClock.adjust("10 millis");
        yield* flip("note.template-conversion-pending");
        yield* TestClock.adjust("10 millis");
        yield* flip("release.migration-pending");
        yield* TestClock.adjust("49 millis");
        expect(rebuilds.count).toBe(0);

        yield* TestClock.adjust("1 millis");
        expect(rebuilds.count).toBe(1);
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(1);
      }),
    ),
);
