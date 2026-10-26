import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { languagePackSettingCopy } from "@/lib/i18n/settings-copy";

import { fakeDevice, startOn } from "./__fixtures__";
import type { LanguagePack } from "./service";

const PACK_URL =
  "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0/zh-CN.json";

/** The kinds the pack moves through after the current one. */
const watchKinds = Effect.fn("test.watchKinds")(function* (
  pack: LanguagePack["Service"],
) {
  const kinds: string[] = [];
  yield* pack.changes.pipe(
    Stream.drop(1),
    Stream.runForEach((situation) =>
      Effect.sync(() => kinds.push(situation.kind)),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  return kinds;
});

const kindOf = (pack: LanguagePack["Service"]) =>
  Effect.map(pack.situation, (situation) => situation.kind);

/** The setting row for `pack` as it stands now. */
const settingCopy = Effect.fn("test.settingCopy")(function* (
  pack: LanguagePack["Service"],
) {
  const situation = yield* pack.situation;
  return languagePackSettingCopy({
    endonym: pack.endonym,
    situation,
    install: () => {},
  });
});

describe("Language Pack startup", () => {
  it.effect("offers a disclosed install without requesting the network", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, { language: "zh" });

      expect(m.hello()).toBe("world");
      expect(device.requests).toEqual([]);
      expect(pack.locale).toBe("zh-CN");
      expect(yield* pack.situation).toEqual({
        kind: "offered",
        pack: { fileName: "zh-CN.json", origin: "github.com/aidenlx/zotlit" },
      });
    }),
  );

  it.effect(
    "renders the consent copy in the target language, naming the Endonym",
    () =>
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language: "zh" });

        expect(pack.endonym).toBe("简体中文");
        expect(m.notice_language_pack_install({ language: pack.endonym })).toBe(
          "ZotLit 简体中文 语言包可用。",
        );
        expect(m.notice_language_pack_decline_action()).toBe("不再询问");
        expect(m.notice_language_pack_downloading()).toBe(
          "正在下载 ZotLit 语言包…",
        );
        expect(m.notice_language_pack_restart()).toBe(
          "重启 Obsidian 以应用 ZotLit 语言包。",
        );
        const offered = yield* settingCopy(pack);
        expect(offered?.name).toBe("语言包");
        expect(offered?.desc).toBe(
          "以 简体中文 显示 ZotLit 界面。安装时将下载语言包。",
        );
        expect(offered?.install).toMatchObject({
          label: "安装",
          disabled: false,
        });
        // Every other Message reads the bundled base pack until a pack applies.
        expect(m.hello()).toBe("world");
        expect(m.workbench_tab_match()).toBe("Match");
      }),
  );

  it.effect.each(["zh", "zh-CN"])(
    "keeps shared editor labels in English before installing the native %s pack",
    (language) =>
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language });

        expect(pack.locale).toBe("zh-CN");
        expect(m.workbench_tab_match()).toBe("Match");
        expect(m.workbench_explorer_section_common()).toBe("Common fields");
        expect(m.workbench_explorer_menu_copy_value()).toBe("Copy value");
      }),
  );

  it.effect(
    "falls back to the locale code for a language outside Obsidian's set",
    () =>
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language: "zh-CN" });

        expect(pack.endonym).toBe("zh-CN");
      }),
  );

  it.effect.each(["en", "fr"])(
    "has nothing to offer for %s, which ZotLit ships no pack for",
    (language) =>
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(), { language });

        expect(pack.locale).toBe("en");
        expect(yield* pack.situation).toEqual({ kind: "unavailable" });
        expect(yield* settingCopy(pack)).toBeUndefined();
        expect(m.settings_language_pack_name()).toBe("Language pack");
        expect(m.workbench_tab_match()).toBe("Match");
        const failed = yield* Effect.flip(pack.install);
        expect(failed._tag).toBe("NoLanguagePack");
        yield* pack.decline;
      }),
  );

  it.effect("exposes the Endonym of the base language", () =>
    Effect.gen(function* () {
      const pack = yield* startOn(fakeDevice(), { language: "en" });

      expect(pack.endonym).toBe("English");
    }),
  );

  it.effect("a device-storage read failure fails startup", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      device.loadLocalStorage = () => {
        throw new Error("storage unavailable");
      };

      const failed = yield* Effect.flip(startOn(device, { language: "zh" }));

      expect(failed.message).toBe("storage unavailable");
      expect(device.requests).toEqual([]);
      expect(m.hello()).toBe("world");
    }),
  );

  it.effect("a consent read failure fails startup", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      let reads = 0;
      device.loadLocalStorage = () => {
        reads += 1;
        if (reads === 2) throw new Error("storage unavailable");
        return null;
      };

      const failed = yield* Effect.flip(startOn(device, { language: "zh" }));

      expect(failed.message).toBe("storage unavailable");
      expect(device.requests).toEqual([]);
      expect(m.hello()).toBe("world");
    }),
  );
});

describe("Language Pack install", () => {
  it.effect("downloads, validates, caches, and applies after restart", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, { language: "zh" });
      const kinds = yield* watchKinds(pack);

      expect(yield* pack.install).toEqual({ fileName: "zh-CN.json" });

      // Downloaded from the Resource Release of the running plugin version.
      expect(device.requests).toEqual([PACK_URL]);
      expect(kinds).toEqual(["downloading", "restart-pending"]);
      const downloaded = yield* settingCopy(pack);
      expect(downloaded?.desc).toBe(m.notice_language_pack_restart());
      expect(downloaded?.install).toBeUndefined();
      // Cached, not applied: the facade still reads the bundled base pack.
      expect(m.hello()).toBe("world");
      expect([...device.storage.keys()].toSorted()).toEqual([
        "zotlit:i18n:consent:zh-CN",
        "zotlit:i18n:pack:2.0.0:zh-CN",
      ]);

      const restarted = yield* startOn(device, { language: "zh" });
      expect(restarted.locale).toBe("zh-CN");
      expect(yield* kindOf(restarted)).toBe("active");
      expect(yield* settingCopy(restarted)).toBeUndefined();
      // The pack applied to the very runtime the facade reads.
      expect(m.hello()).toBe("世界（测试）");
      expect(m.workbench_tab_match()).toBe("匹配（测试包）");
      expect(m.workbench_explorer_section_common()).toBe("Common fields");
      expect(device.requests).toHaveLength(1);
    }),
  );

  it.effect("names the pre-release Resource Release it downloads from", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, {
        language: "zh",
        pluginVersion: "2.0.0-beta.4",
      });

      yield* pack.install;

      expect(device.requests).toEqual([
        "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zh-CN.json",
      ]);
    }),
  );

  it.effect(
    "settings install remains available after a persisted decline, distinct from the initial offer",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const pack = yield* startOn(device, { language: "zh" });
        const kinds = yield* watchKinds(pack);

        yield* pack.decline;
        expect(kinds).toEqual(["installable"]);

        const restarted = yield* startOn(device, {
          language: "zh",
          pluginVersion: "3.0.0",
        });
        // Consent was answered, so this is `installable`, not the initial `offered`.
        expect(yield* kindOf(restarted)).toBe("installable");
        expect(device.requests).toEqual([]);

        expect(yield* restarted.install).toEqual({ fileName: "zh-CN.json" });
        expect(yield* kindOf(restarted)).toBe("restart-pending");

        const afterInstall = yield* startOn(device, {
          language: "zh",
          pluginVersion: "3.0.0",
        });
        expect(yield* kindOf(afterInstall)).toBe("active");
        expect(m.hello()).toBe("世界（测试）");
      }),
  );

  it.effect(
    "a plugin update refreshes in the background under existing consent, one download every caller shares",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, {
          language: "zh",
          pluginVersion: "1.0.0",
        })).install;

        const updated = yield* startOn(device, {
          language: "zh",
          pluginVersion: "2.0.0",
        });
        const first = yield* watchKinds(updated);
        const second = yield* watchKinds(updated);

        expect(yield* kindOf(updated)).toBe("downloading");
        expect(m.hello()).toBe("world");
        // Labelled but inert: dropping the button collapses the row's control slot.
        expect((yield* settingCopy(updated))?.install).toMatchObject({
          label: m.notice_language_pack_install_action(),
          disabled: true,
        });
        expect(
          yield* Effect.all([updated.install, updated.install], {
            concurrency: "unbounded",
          }),
        ).toEqual([{ fileName: "zh-CN.json" }, { fileName: "zh-CN.json" }]);

        expect(first).toEqual(["restart-pending"]);
        expect(second).toEqual(["restart-pending"]);
        expect(device.requests).toHaveLength(2);
        expect(m.hello()).toBe("world");

        yield* startOn(device, { language: "zh", pluginVersion: "2.0.0" });
        expect(m.hello()).toBe("世界（测试）");
        expect(device.requests).toHaveLength(2);
      }),
  );

  it.effect("concurrent installs share one download", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, { language: "zh" });

      const first = yield* Effect.forkChild(pack.install, {
        startImmediately: true,
      });
      expect(yield* kindOf(pack)).toBe("downloading");
      expect((yield* settingCopy(pack))?.install).toMatchObject({
        disabled: true,
      });
      expect((yield* settingCopy(pack))?.desc).toBe(
        m.notice_language_pack_downloading(),
      );
      const second = yield* Effect.forkChild(pack.install, {
        startImmediately: true,
      });

      expect(yield* Fiber.join(first)).toEqual({ fileName: "zh-CN.json" });
      expect(yield* Fiber.join(second)).toEqual({ fileName: "zh-CN.json" });
      expect(device.requests).toHaveLength(1);
    }),
  );

  it.effect.each([
    ["invalid JSON", "not json"],
    [
      "wrong schema",
      JSON.stringify({ schemaVersion: 2, locale: "zh-CN", messages: {} }),
    ],
    [
      "wrong locale",
      JSON.stringify({ schemaVersion: 1, locale: "fr", messages: {} }),
    ],
    ["failed download", { status: 503, text: "unavailable" }],
    ["offline", new Error("offline")],
  ] as const)(
    "a %s fails install and leaves the base pack installed",
    ([, answer]) =>
      Effect.gen(function* () {
        const pack = yield* startOn(fakeDevice(answer), { language: "zh" });

        const failed = yield* Effect.flip(pack.install);

        expect(failed._tag).toBe("LanguagePackDownloadFailed");
        expect(failed.message).not.toBe("");
        // Consent was answered by the failed attempt, so this is `installable`.
        expect(yield* kindOf(pack)).toBe("installable");
        expect(m.hello()).toBe("world");
      }),
  );

  it.effect("names the status a download answered with", () =>
    Effect.gen(function* () {
      const pack = yield* startOn(
        fakeDevice({ status: 503, text: "unavailable" }),
        { language: "zh" },
      );

      const failed = yield* Effect.flip(pack.install);

      expect(failed.message).toBe(`${PACK_URL} responded 503`);
    }),
  );

  it.effect("names a dropped connection by the transport's error", () =>
    Effect.gen(function* () {
      const pack = yield* startOn(fakeDevice(new Error("offline")), {
        language: "zh",
      });

      expect((yield* Effect.flip(pack.install)).message).toBe("offline");
    }),
  );

  it.effect("tells a pack from a newer lineage apart: update the plugin", () =>
    Effect.gen(function* () {
      const newer = JSON.stringify({
        schemaVersion: 2,
        locale: "zh-CN",
        messages: {},
      });
      const pack = yield* startOn(fakeDevice(newer), { language: "zh" });

      const failed = yield* Effect.flip(pack.install);

      expect(failed).toMatchObject({
        _tag: "LanguagePackDownloadFailed",
        updateNeeded: true,
      });
    }),
  );

  it.effect("a consent write failure fails install before any download", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      device.saveLocalStorage = () => {
        throw new Error("storage unavailable");
      };
      const pack = yield* startOn(device, { language: "zh" });

      const failed = yield* Effect.flip(pack.install);

      expect(failed).toMatchObject({
        _tag: "LanguagePackStorageFailed",
        message: "storage unavailable",
      });
      expect(device.requests).toEqual([]);
      expect(m.hello()).toBe("world");
    }),
  );

  it.effect(
    "a download-cache write failure fails install; a decline write failure fails decline",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const save = device.saveLocalStorage;
        let saves = 0;
        device.saveLocalStorage = (key, value) => {
          saves += 1;
          if (saves === 2) throw new Error("storage unavailable");
          save(key, value);
        };
        const pack = yield* startOn(device, { language: "zh" });

        expect((yield* Effect.flip(pack.install)).message).toBe(
          "storage unavailable",
        );
        expect(yield* kindOf(pack)).toBe("installable");
        expect(m.hello()).toBe("world");

        const declining = fakeDevice();
        declining.saveLocalStorage = () => {
          throw new Error("storage unavailable");
        };
        const offered = yield* startOn(declining, { language: "zh" });
        expect((yield* Effect.flip(offered.decline)).message).toBe(
          "storage unavailable",
        );
        expect(declining.requests).toEqual([]);
      }),
  );
});

describe("Language Pack reset", () => {
  it.effect(
    "clears the cache and consent, so the next start offers again",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const pack = yield* startOn(device, { language: "zh" });
        yield* pack.install;
        const kinds = yield* watchKinds(pack);

        yield* pack.reset;

        expect([...device.storage.keys()]).toEqual([]);
        // Nothing was applied this session, so the pending restart is gone too.
        expect(kinds).toEqual(["installable"]);

        const restarted = yield* startOn(device, { language: "zh" });
        expect(yield* kindOf(restarted)).toBe("offered");
        expect(m.hello()).toBe("world");
      }),
  );

  it.effect(
    "leaves an active pack running until restart; the next start offers again",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, { language: "zh" })).install;
        const restarted = yield* startOn(device, { language: "zh" });
        expect(yield* kindOf(restarted)).toBe("active");

        yield* restarted.reset;

        expect([...device.storage.keys()]).toEqual([]);
        // The applied pack keeps running until the app restarts.
        expect(yield* kindOf(restarted)).toBe("active");
        expect(m.workbench_tab_match()).toBe("匹配（测试包）");

        const afterReset = yield* startOn(device, { language: "zh" });
        expect(yield* kindOf(afterReset)).toBe("offered");
        expect(m.workbench_tab_match()).toBe("Match");
        expect(m.workbench_explorer_section_common()).toBe("Common fields");
      }),
  );

  it.effect(
    "interrupts a download in flight before it is cached, and every install joined to it",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const pack = yield* startOn(device, { language: "zh" });

        const install = yield* Effect.forkChild(pack.install, {
          startImmediately: true,
        });
        yield* pack.reset;
        const exit = yield* Fiber.await(install);

        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect([...device.storage.keys()]).toEqual([]);
        expect(yield* kindOf(pack)).toBe("installable");
      }),
  );

  it.effect("clears locales the current session does not use", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      yield* (yield* startOn(device, { language: "zh" })).install;

      const english = yield* startOn(device, { language: "en" });
      yield* english.reset;

      expect([...device.storage.keys()]).toEqual([]);
    }),
  );
});
