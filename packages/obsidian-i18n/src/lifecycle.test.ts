import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  createLanguagePackLifecycle,
  createLanguagePackRuntime,
  type LanguagePackLifecyclePorts,
  type LanguagePackSituation,
  resolveLocale,
} from "./index.js";

const PLUGIN_VERSION = "2.0.0";
const CHINESE_PACK = JSON.stringify({
  schemaVersion: 1,
  locale: "zh-CN",
  messages: { hello: "世界" },
});
const BASE_PACK = {
  schemaVersion: 1,
  locale: "en",
  messages: { hello: "world" },
} as const;
const CATALOG = {
  baseLocale: "en",
  packs: {
    "zh-CN": { fileName: "zh-CN.json" },
  },
} as const;
const SOURCE = {
  baseUrl: "https://github.com/aidenlx/zotlit/releases/download/language-packs",
  origin: "github.com/aidenlx/zotlit",
};
const ALIASES = { zh: "zh-CN" } as const;

/** Never called — exists only so the `aliases` generic is type-checked. */
function assertAliasesRejectUnknownTargets(): void {
  resolveLocale("zh", CATALOG, {
    // @ts-expect-error Locale Alias targets must exist in this catalog.
    zh: "fr",
  });
}
void assertAliasesRejectUnknownTargets;

let runtime = createLanguagePackRuntime(BASE_PACK);

function initI18n({
  namespace = "zotlit",
  ...options
}: {
  pluginVersion: string;
  ports: LanguagePackLifecyclePorts;
  namespace?: string;
}) {
  runtime = createLanguagePackRuntime(BASE_PACK);
  return createLanguagePackLifecycle({
    ...options,
    runtime,
    namespace,
    catalog: CATALOG,
    source: SOURCE,
    aliases: ALIASES,
  });
}

const m = { hello: () => runtime.translate("hello") };

describe("Locale Aliases", () => {
  test("resolve supported Obsidian codes and default to the base locale", () => {
    expect(resolveLocale("zh", CATALOG, ALIASES)).toBe("zh-CN");
    expect(resolveLocale("zh-TW", CATALOG, ALIASES)).toBe("en");
    expect(resolveLocale("fr", CATALOG, ALIASES)).toBe("en");
    expect(resolveLocale("", CATALOG, ALIASES)).toBe("en");
  });
});

describe("Language Pack install lifecycle", () => {
  beforeEach(() => {
    initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: makePorts({ language: "en" }).ports,
    });
  });

  test("offers a disclosed install without requesting the network", () => {
    const { ports, requests } = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });

    const startup = initI18n({ pluginVersion: PLUGIN_VERSION, ports });

    expect(m.hello()).toBe("world");
    expect(requests).toEqual([]);
    expect(startup.locale).toBe("zh-CN");
    expect(startup.getSituation()).toMatchObject({
      kind: "offered",
      pack: { fileName: "zh-CN.json", origin: "github.com/aidenlx/zotlit" },
    });
  });

  test("install downloads, validates, caches, and applies after restart", async () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    const kinds: string[] = [];
    startup.subscribe(() => kinds.push(startup.getSituation().kind));

    const notice = await startup.install();

    expect(harness.requests).toEqual([
      "https://github.com/aidenlx/zotlit/releases/download/language-packs/zh-CN.json",
    ]);
    expect(notice).toEqual({
      fileName: "zh-CN.json",
    });
    expect(startup.getSituation()).toMatchObject({ kind: "restart-pending" });
    expect(kinds).toEqual(["downloading", "restart-pending"]);
    expect(m.hello()).toBe("world");

    const restarted = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(restarted.locale).toBe("zh-CN");
    expect(restarted.getSituation()).toMatchObject({ kind: "active" });
    expect(m.hello()).toBe("世界");
    expect(harness.requests).toHaveLength(1);
  });

  test("settings install remains available after a persisted decline, distinct from the initial offer", async () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(startup.getSituation().kind).toBe("offered");

    startup.decline();
    const restarted = initI18n({
      pluginVersion: "3.0.0",
      ports: harness.ports,
    });

    // Consent was answered, so this is `installable`, not the initial `offered`.
    expect(restarted.getSituation()).toMatchObject({ kind: "installable" });
    expect(harness.requests).toEqual([]);
    expect(m.hello()).toBe("world");

    const result = await restarted.install();

    expect(result).toEqual({
      fileName: "zh-CN.json",
    });
    expect(restarted.getSituation().kind).toBe("restart-pending");
    expect(harness.requests).toHaveLength(1);

    const afterSettingsInstall = initI18n({
      pluginVersion: "3.0.0",
      ports: harness.ports,
    });
    expect(afterSettingsInstall.getSituation().kind).toBe("active");
    expect(m.hello()).toBe("世界");
  });

  test("a plugin update refreshes silently under existing consent", async () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    const firstStartup = initI18n({
      pluginVersion: "1.0.0",
      ports: harness.ports,
    });
    await firstStartup.install();

    const updatedStartup = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });

    const situation = updatedStartup.getSituation();
    expect(situation.kind).toBe("downloading");
    expect(m.hello()).toBe("world");
    if (situation.kind !== "downloading") throw new Error("unreachable");
    await expect(situation.done).resolves.toEqual({
      fileName: "zh-CN.json",
    });
    expect(m.hello()).toBe("world");
    expect(harness.requests).toHaveLength(2);

    initI18n({ pluginVersion: "2.0.0", ports: harness.ports });
    expect(m.hello()).toBe("世界");
    expect(harness.requests).toHaveLength(2);
  });

  test.each([
    ["invalid JSON", "not json"],
    [
      "wrong schema",
      JSON.stringify({ schemaVersion: 2, locale: "zh-CN", messages: {} }),
    ],
    [
      "wrong locale",
      JSON.stringify({ schemaVersion: 1, locale: "fr", messages: {} }),
    ],
    [
      "invalid structure",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: { hello: { declarations: [], variants: "invalid" } },
      }),
    ],
    [
      "unusable structure",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: { hello: { declarations: [], variants: [] } },
      }),
    ],
    [
      "oversized data",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: { hello: "x".repeat(256 * 1024) },
      }),
    ],
    [
      "message-count cap",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: Object.fromEntries(
          Array.from({ length: 1_001 }, (_, index) => [`m${index}`, "x"]),
        ),
      }),
    ],
    [
      "text-length cap",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: { hello: "x".repeat(10_001) },
      }),
    ],
    [
      "nesting-depth cap",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: {
          hello: {
            declarations: [],
            variants: [{ matches: [], pattern: [deepExpression(20)] }],
          },
        },
      }),
    ],
    [
      "formatter allowlist",
      JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: {
          hello: {
            declarations: [],
            variants: [
              {
                matches: [],
                pattern: [
                  {
                    type: "formatter",
                    name: "execute",
                    argument: { type: "literal", value: "1" },
                    options: {},
                  },
                ],
              },
            ],
          },
        },
      }),
    ],
  ])(
    "%s download rejects and leaves the base pack installed",
    async (_name, response) => {
      const harness = makePorts({ language: "zh", response });
      const startup = initI18n({
        pluginVersion: PLUGIN_VERSION,
        ports: harness.ports,
      });

      await expect(startup.install()).rejects.toThrow(/.+/);
      // Consent was answered by the failed attempt, so this is `installable`.
      expect(startup.getSituation().kind).toBe("installable");
      expect(m.hello()).toBe("world");
    },
  );

  test.each([
    ["offline", new Error("offline")],
    ["failed download", { status: 503, text: "unavailable" }],
  ])(
    "%s rejects and leaves the base pack installed",
    async (_name, failure) => {
      const harness = makePorts({ language: "zh", failure });
      const startup = initI18n({
        pluginVersion: PLUGIN_VERSION,
        ports: harness.ports,
      });

      await expect(startup.install()).rejects.toThrow(/.+/);
      expect(startup.getSituation().kind).toBe("installable");
      expect(m.hello()).toBe("world");
    },
  );

  test("namespaces cached packs and consent per plugin and version", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });

    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    await startup.install();

    expect([...harness.storage.keys()].toSorted()).toEqual([
      "zotlit:i18n:consent:zh-CN",
      `zotlit:i18n:pack:${PLUGIN_VERSION}:zh-CN`,
    ]);

    const otherPlugin = makePorts({ language: "zh", response: CHINESE_PACK });
    const otherStartup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: otherPlugin.ports,
      namespace: "other-plugin",
    });
    await otherStartup.install();

    expect([...otherPlugin.storage.keys()].toSorted()).toEqual([
      "other-plugin:i18n:consent:zh-CN",
      `other-plugin:i18n:pack:${PLUGIN_VERSION}:zh-CN`,
    ]);
  });

  test("a background refresh is one shared download every subscriber observes", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const consented = initI18n({
      pluginVersion: "1.0.0",
      ports: harness.ports,
    });
    await consented.install();

    const updated = initI18n({
      pluginVersion: "2.0.0",
      ports: harness.ports,
    });
    const first: string[] = [];
    const second: string[] = [];
    updated.subscribe(() => first.push(updated.getSituation().kind));
    updated.subscribe(() => second.push(updated.getSituation().kind));

    expect(updated.getSituation().kind).toBe("downloading");
    const situation = updated.getSituation();
    if (situation.kind !== "downloading") throw new Error("unreachable");
    await Promise.all([situation.done, updated.install()]);

    expect(first).toEqual(["restart-pending"]);
    expect(second).toEqual(["restart-pending"]);
    expect(updated.getSituation().kind).toBe("restart-pending");
    expect(harness.requests).toHaveLength(2);
  });

  test("concurrent install() calls share one promise", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });

    const first = startup.install();
    const second = startup.install();

    expect(second).toBe(first);
    const situation = startup.getSituation();
    expect(situation.kind).toBe("downloading");
    if (situation.kind !== "downloading") throw new Error("unreachable");
    expect(situation.done).toBe(first);
    await first;
    expect(harness.requests).toHaveLength(1);
  });

  test("subscribe fires when the download starts, the offer clears, or install is declined", () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(startup.getSituation().kind).toBe("offered");

    const notifications: LanguagePackSituation[] = [];
    startup.subscribe(() => notifications.push(startup.getSituation()));

    void startup.install();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: "downloading" });
  });

  test("decline notifies, moving from offered to installable", () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(startup.getSituation().kind).toBe("offered");

    let notifications = 0;
    startup.subscribe(() => (notifications += 1));
    startup.decline();

    expect(notifications).toBe(1);
    expect(startup.getSituation()).toMatchObject({ kind: "installable" });
  });

  test("situations are frozen and a new object is produced on every change", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });

    const before = startup.getSituation();
    expect(Object.isFrozen(before)).toBe(true);

    await startup.install();

    const after = startup.getSituation();
    expect(Object.isFrozen(after)).toBe(true);
    expect(after).not.toBe(before);
  });

  test("no remote pack for the locale rejects install and no-ops decline", async () => {
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: makePorts({ language: "en" }).ports,
    });

    expect(startup.getSituation()).toEqual({ kind: "unavailable" });
    await expect(startup.install()).rejects.toThrow(/.+/);
    expect(() => startup.decline()).not.toThrow();
  });

  test("reset clears the cache and consent, so the next start offers again", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    await startup.install();

    let notifications = 0;
    startup.subscribe(() => (notifications += 1));
    startup.reset();

    expect([...harness.storage.keys()]).toEqual([]);
    expect(notifications).toBe(1);
    // Nothing was applied this session, so the pending restart is gone too.
    expect(startup.getSituation()).toMatchObject({ kind: "installable" });

    const restarted = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(restarted.getSituation()).toMatchObject({ kind: "offered" });
    expect(m.hello()).toBe("world");
  });

  test("reset on an active pack leaves it active; a restart-pending one becomes installable", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const consented = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    await consented.install();
    const restarted = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(restarted.getSituation().kind).toBe("active");

    restarted.reset();

    expect([...harness.storage.keys()]).toEqual([]);
    // The applied pack keeps running until the app restarts.
    expect(restarted.getSituation().kind).toBe("active");
    expect(m.hello()).toBe("世界");

    const afterReset = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    expect(afterReset.getSituation()).toMatchObject({ kind: "offered" });
    expect(m.hello()).toBe("world");
  });

  test("reset discards a download that is already in flight", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });

    const download = startup.install();
    startup.reset();
    await download;

    expect([...harness.storage.keys()]).toEqual([]);
    expect(startup.getSituation()).toMatchObject({ kind: "installable" });
  });

  test("reset clears locales the current session does not use", async () => {
    const harness = makePorts({ language: "zh", response: CHINESE_PACK });
    const chinese = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });
    await chinese.install();

    const english = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: { ...harness.ports, getLanguage: () => "en" },
    });
    english.reset();

    expect([...harness.storage.keys()]).toEqual([]);
  });

  test("a device-storage read failure propagates out of startup", () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    harness.ports.loadLocalStorage = () => {
      throw new Error("storage unavailable");
    };

    expect(() =>
      initI18n({
        pluginVersion: PLUGIN_VERSION,
        ports: harness.ports,
      }),
    ).toThrow("storage unavailable");
    expect(harness.requests).toEqual([]);
    expect(m.hello()).toBe("world");
  });

  test("a consent read failure propagates out of startup", () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    let readCount = 0;
    harness.ports.loadLocalStorage = () => {
      readCount += 1;
      if (readCount === 2) throw new Error("storage unavailable");
      return null;
    };

    expect(() =>
      initI18n({
        pluginVersion: PLUGIN_VERSION,
        ports: harness.ports,
      }),
    ).toThrow("storage unavailable");
    expect(harness.requests).toEqual([]);
    expect(m.hello()).toBe("world");
  });

  test("a consent write failure rejects install and keeps the base pack", async () => {
    const harness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    harness.ports.saveLocalStorage = () => {
      throw new Error("storage unavailable");
    };
    const startup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: harness.ports,
    });

    await expect(startup.install()).rejects.toThrow("storage unavailable");
    expect(harness.requests).toEqual([]);
    expect(m.hello()).toBe("world");
  });

  test("a download-cache write failure rejects install; a decline write failure propagates", async () => {
    const installHarness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    const save = installHarness.ports.saveLocalStorage.bind(
      installHarness.ports,
    );
    let saveCount = 0;
    installHarness.ports.saveLocalStorage = (key, value) => {
      saveCount += 1;
      if (saveCount === 2) throw new Error("storage unavailable");
      save(key, value);
    };
    const installStartup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: installHarness.ports,
    });

    await expect(installStartup.install()).rejects.toThrow(
      "storage unavailable",
    );
    expect(installStartup.getSituation().kind).toBe("installable");
    expect(m.hello()).toBe("world");

    const declineHarness = makePorts({
      language: "zh",
      response: CHINESE_PACK,
    });
    declineHarness.ports.saveLocalStorage = () => {
      throw new Error("storage unavailable");
    };
    const declineStartup = initI18n({
      pluginVersion: PLUGIN_VERSION,
      ports: declineHarness.ports,
    });
    expect(() => declineStartup.decline()).toThrow("storage unavailable");
    expect(declineHarness.requests).toEqual([]);
    expect(m.hello()).toBe("world");
  });
});

describe("Target-Locale copy", () => {
  const TARGET_BASE_PACK = {
    schemaVersion: 1,
    locale: "en",
    messages: { notice_install: "A language pack is available." },
  } as const;

  function initTargetI18n(language: string) {
    const targeted = createLanguagePackRuntime(TARGET_BASE_PACK, {
      targetLocaleMessages: { "zh-CN": { notice_install: "语言包可用。" } },
    });
    const lifecycle = createLanguagePackLifecycle({
      pluginVersion: PLUGIN_VERSION,
      runtime: targeted,
      namespace: "zotlit",
      catalog: CATALOG,
      source: SOURCE,
      aliases: ALIASES,
      ports: makePorts({ language }).ports,
    });
    return {
      lifecycle,
      notice_install: () => targeted.translateTarget("notice_install"),
    };
  }

  test("renders the offer in the target locale with no pack installed", () => {
    const { lifecycle, notice_install } = initTargetI18n("zh");

    expect(lifecycle.getSituation().kind).toBe("offered");
    expect(notice_install()).toBe("语言包可用。");
  });

  test("leaves copy in the base locale for a locale with no shipped pack", () => {
    const { lifecycle, notice_install } = initTargetI18n("fr");

    expect(lifecycle.getSituation().kind).toBe("unavailable");
    expect(notice_install()).toBe("A language pack is available.");
  });

  test("exposes the resolved language's Endonym", () => {
    expect(initTargetI18n("zh").lifecycle.endonym).toBe("简体中文");
    expect(initTargetI18n("en").lifecycle.endonym).toBe("English");
  });

  test("falls back to the locale code for a language outside Obsidian's set", () => {
    const { lifecycle } = initTargetI18n("zh-CN");

    expect(lifecycle.locale).toBe("zh-CN");
    expect(lifecycle.endonym).toBe("zh-CN");
  });
});

function makePorts(options: {
  language: string;
  response?: string;
  failure?: Error | { status: number; text: string };
}): {
  ports: LanguagePackLifecyclePorts;
  requests: string[];
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  const requests: string[] = [];
  return {
    requests,
    storage,
    ports: {
      getLanguage: () => options.language,
      loadLocalStorage: (key) => storage.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        if (value === null) storage.delete(key);
        else storage.set(key, value);
      },
      requestUrl: vi.fn<LanguagePackLifecyclePorts["requestUrl"]>(
        async ({ url }) => {
          requests.push(url);
          if (options.failure instanceof Error) throw options.failure;
          if (options.failure !== undefined) return options.failure;
          return { status: 200, text: options.response ?? CHINESE_PACK };
        },
      ),
    },
  };
}

function deepExpression(depth: number): unknown {
  if (depth === 0) return { type: "literal", value: "1" };
  return {
    type: "formatter",
    name: "number",
    argument: deepExpression(depth - 1),
    options: {},
  };
}
