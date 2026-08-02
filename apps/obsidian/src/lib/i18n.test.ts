import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";

import { type LanguagePackLifecyclePorts } from "@zotlit/obsidian-i18n";

import { initI18n } from "./i18n.js";
import * as m from "./i18n/generated/messages.js";
import { languagePackSettingCopy } from "./i18n/settings-copy.js";

/** Overrides a real Message, so an applied pack is observable through the facade. */
const PACK_MESSAGE = "世界（测试）";
const CHINESE_PACK = JSON.stringify({
  schemaVersion: 1,
  locale: "zh-CN",
  messages: { hello: PACK_MESSAGE },
});
/** Bundled with the plugin, so lifecycle copy reads in Chinese with no pack installed. */
const BUNDLED_SETTING_NAME = "语言包";
const BUNDLED_ENDONYM_DESC =
  "以 简体中文 显示 ZotLit 界面。安装时将下载语言包。";

describe("ZotLit Language Pack setting integration", () => {
  beforeEach(() => {
    initI18n({
      pluginVersion: "2.0.0",
      ports: makePorts({ language: "en" }).ports,
    });
  });

  test("stays hidden when ZotLit has no pack for the resolved locale", () => {
    const { ports } = makePorts({ language: "fr" });

    const lifecycle = initI18n({ pluginVersion: "2.0.0", ports });

    expect(languagePackSettingCopy(lifecycle)).toBeUndefined();
  });

  test("stays hidden on the base locale, which has no remote pack", () => {
    const { ports } = makePorts({ language: "en" });

    const lifecycle = initI18n({ pluginVersion: "2.0.0", ports });

    expect(lifecycle.getSituation()).toMatchObject({ kind: "unavailable" });
    expect(languagePackSettingCopy(lifecycle)).toBeUndefined();
  });

  test("renders the startup consent notice in the target language, naming the Endonym", () => {
    const { ports } = makePorts({ language: "zh" });

    const lifecycle = initI18n({ pluginVersion: "2.0.0", ports });

    expect(lifecycle.getSituation().kind).toBe("offered");
    expect(lifecycle.endonym).toBe("简体中文");
    expect(
      m.notice_language_pack_install({ language: lifecycle.endonym }),
    ).toBe("ZotLit 简体中文 语言包可用。");
    expect(m.notice_language_pack_decline_action()).toBe("不再询问");
    expect(m.notice_language_pack_downloading()).toBe(
      "正在下载 ZotLit 语言包…",
    );
    expect(m.notice_language_pack_restart()).toBe(
      "重启 Obsidian 以应用 ZotLit 语言包。",
    );
  });

  test("offers ZotLit's disclosed install, then the restart, then disappears", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const lifecycle = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });

    const offered = languagePackSettingCopy(lifecycle);
    // Chinese before any download: the row reads from the bundled subset and
    // names the language by its Endonym.
    expect(offered?.name).toBe(BUNDLED_SETTING_NAME);
    expect(offered?.desc).toBe(BUNDLED_ENDONYM_DESC);
    expect(offered?.install?.label).toBe("安装");
    expect(offered?.install?.disabled).toBe(false);
    // Every other Message still reads the bundled base pack until a pack applies.
    expect(m.hello()).toBe("world");

    await lifecycle.install();

    const downloaded = languagePackSettingCopy(lifecycle);
    expect(downloaded?.desc).toBe(m.notice_language_pack_restart());
    expect(downloaded?.install).toBeUndefined();
    // Cached, not applied: the facade still reads the bundled base pack.
    expect(m.hello()).toBe("world");

    const restarted = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });
    expect(restarted.getSituation()).toMatchObject({ kind: "active" });
    expect(languagePackSettingCopy(restarted)).toBeUndefined();
    // The lifecycle installed the pack into the very runtime the facade reads.
    expect(m.hello()).toBe(PACK_MESSAGE);
  });

  test("downloads the pack from the Resource Release of the running plugin version", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const lifecycle = initI18n({
      pluginVersion: "2.0.0-beta.4",
      ports: harness.ports,
    });

    await lifecycle.install();

    expect(harness.requestUrl).toHaveBeenCalledWith({
      url: "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zh-CN.json",
    });
  });

  test("disables the install button while ZotLit's consented refresh is in flight", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    await initI18n({
      pluginVersion: "1.0.0",
      ports: harness.ports,
    }).install();

    const updated = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });

    const situation = updated.getSituation();
    expect(situation.kind).toBe("downloading");
    // Labelled but inert: dropping the button collapses the row's control slot.
    expect(languagePackSettingCopy(updated)?.install).toMatchObject({
      label: m.notice_language_pack_install_action(),
      disabled: true,
    });
    if (situation.kind !== "downloading") throw new Error("unreachable");
    await situation.done;
  });

  test("disables the install button while a settings-initiated install is in flight", () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const lifecycle = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });

    const install = lifecycle.install();

    expect(languagePackSettingCopy(lifecycle)?.install).toMatchObject({
      disabled: true,
    });
    expect(languagePackSettingCopy(lifecycle)?.desc).toBe(
      m.notice_language_pack_downloading(),
    );
    return install;
  });
});

function makePorts(options: { language: string; response?: string }): {
  ports: LanguagePackLifecyclePorts;
  requestUrl: Mock<LanguagePackLifecyclePorts["requestUrl"]>;
} {
  const storage = new Map<string, unknown>();
  const requestUrl = vi.fn(async () => ({
    status: 200,
    text: options.response ?? CHINESE_PACK,
  }));
  return {
    requestUrl,
    ports: {
      getLanguage: () => options.language,
      loadLocalStorage: (key) => storage.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        if (value === null) storage.delete(key);
        else storage.set(key, value);
      },
      requestUrl,
    },
  };
}
