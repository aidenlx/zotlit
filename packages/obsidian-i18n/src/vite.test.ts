import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";
import { describe, expect, onTestFinished, test } from "vitest";

import {
  addLocale,
  createFixtureProject,
  writeCatalog,
} from "./test-fixtures.js";
import { obsidianI18n } from "./vite.js";

describe("obsidianI18n", () => {
  test("generates at build start, watches project inputs, and excludes output", async () => {
    const projectPath = await createFixtureProject(
      {
        plugin_message: "Plugin",
        docs_message: "Docs",
        notice_pack_offer: "A pack is available.",
      },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      excludeMessagePrefixes: ["docs_"],
      targetLocaleMessagePrefixes: ["notice_pack_"],
    });
    const configResult = await callConfig(plugin, {
      root,
      build: { watch: {} },
    });
    const watched: string[] = [];
    const warnings: string[] = [];

    await callConfigResolved(plugin, { root } as ResolvedConfig);
    await callBuildStart(plugin, {
      addWatchFile: (path: string) => watched.push(path),
      warn: (warning: string) => warnings.push(warning),
    });

    expect(configResult).toMatchObject({
      build: {
        watch: {
          exclude: [`${join(root, "generated")}/**`],
        },
      },
      define: undefined,
    });
    expect(watched).toEqual([
      join(root, "project.inlang", "settings.json"),
      join(root, "messages", "en.json"),
    ]);
    expect(warnings).toEqual([]);
    expect(
      await readFile(join(root, "generated", "messages.ts"), "utf8"),
    ).toContain('translateTarget("notice_pack_offer")');

    await writeCatalog(join(root, "messages", "en.json"), {
      plugin_message: "Updated",
      docs_message: "Docs",
      notice_pack_offer: "A pack is available.",
    });
    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: () => {},
    });
    const regenerated = JSON.parse(
      await readFile(join(root, "generated", "en.json"), "utf8"),
    );
    expect(regenerated.messages.plugin_message).toBe("Updated");
  });

  test("injects the dev-server define only when servePacks is configured", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const withServePacks = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port: 0 },
    });
    onTestFinished(() => callHook(withServePacks.closeWatcher));

    const configResult = await callConfig(withServePacks, { root });

    expect(devServerPort(configResult)).toBeGreaterThan(0);

    const withoutServePacks = obsidianI18n({
      project: "project.inlang",
      output: "generated",
    });

    expect(await callConfig(withoutServePacks, { root })).toBeUndefined();
  });

  test("builds the OS-assigned dev-server URL into application code", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port: 0 },
    });
    onTestFinished(() => callHook(plugin.closeWatcher));

    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        plugin,
        {
          name: "virtual-entry",
          resolveId: (id) => (id === "virtual:entry" ? id : undefined),
          load: (id) =>
            id === "virtual:entry"
              ? "globalThis.packServer = __LANGUAGE_PACK_DEV_SERVER__;"
              : undefined,
        },
      ],
      build: {
        write: false,
        rollupOptions: { input: "virtual:entry" },
      },
    });
    if ("on" in result) throw new Error("Expected a completed Vite build");
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap(({ output }) => output)
      .find((entry) => entry.type === "chunk")?.code;
    if (code === undefined)
      throw new Error("Expected an emitted JavaScript chunk");
    const application: { packServer?: string } = {};

    runInNewContext(code, application);

    expect(new URL(application.packServer!).port).not.toBe("0");
    await expect(
      fetch(`${application.packServer}/en.json`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      locale: "en",
      messages: { plugin_message: "Plugin" },
    });
  });

  test("serves generated packs over loopback only when activated", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port: 0 },
    });
    onTestFinished(() => callHook(plugin.closeWatcher));
    const configResult = await callConfig(plugin, { root });
    const config = { root, define: {} } as ResolvedConfig;
    await callConfigResolved(plugin, config);
    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: () => {},
    });
    const port = devServerPort(configResult);

    await expect(
      fetch(`http://127.0.0.1:${port}/en.json`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      locale: "en",
      messages: { plugin_message: "Plugin" },
    });
  });

  test("keeps the pack server up while the watcher idles between builds", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port: 0 },
    });
    onTestFinished(() => callHook(plugin.closeWatcher));
    const configResult = await callConfig(plugin, { root });
    const config = { root, define: {} } as ResolvedConfig;
    await callConfigResolved(plugin, config);
    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: () => {},
    });
    const port = devServerPort(configResult);

    // A build-watch run closes the bundle after every build, and the plugin
    // fetches its pack while the watcher idles — not mid-build.
    await callHook(plugin.closeBundle);

    await expect(
      fetch(`http://127.0.0.1:${port}/en.json`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ locale: "en" });

    await callHook(plugin.closeWatcher);
    await expect(fetch(`http://127.0.0.1:${port}/en.json`)).rejects.toThrow();
  });

  test("forwards compiler reports as Vite warnings", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    await addLocale(projectPath, "zh-CN", { docs_message: "文档" });
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
    });
    const warnings: string[] = [];
    await callConfigResolved(plugin, { root } as ResolvedConfig);

    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: (warning: string) => warnings.push(warning),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      "1 untranslated message(s) fall back to the base locale: plugin_message",
    );
  });
});

async function callConfig(
  plugin: Plugin,
  config: UserConfig,
): Promise<UserConfig | null | void> {
  if (typeof plugin.config !== "function") {
    throw new Error("Expected a config hook");
  }
  return await plugin.config.call({} as never, config, {
    command: "build",
    mode: "development",
    isPreview: false,
    isSsrBuild: false,
  });
}

async function callConfigResolved(
  plugin: Plugin,
  config: ResolvedConfig,
): Promise<void> {
  if (typeof plugin.configResolved !== "function") {
    throw new Error("Expected a configResolved hook");
  }
  await plugin.configResolved.call({} as never, config);
}

async function callBuildStart(
  plugin: Plugin,
  context: {
    addWatchFile(path: string): void;
    warn(warning: string): void;
  },
): Promise<void> {
  if (typeof plugin.buildStart !== "function") {
    throw new Error("Expected a buildStart hook");
  }
  await plugin.buildStart.call(context as never, {} as never);
}

/** Invokes a plugin hook when the plugin defines one, so absent hooks stay observable. */
async function callHook(hook: unknown): Promise<void> {
  if (typeof hook === "function") await hook.call({} as never);
}

function devServerPort(config: UserConfig | null | void): number {
  const defined = config?.define?.__LANGUAGE_PACK_DEV_SERVER__;
  if (typeof defined !== "string") {
    throw new Error("Expected the Language Pack dev-server define");
  }
  return Number(new URL(JSON.parse(defined)).port);
}
