import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";
import { describe, expect, test } from "vitest";

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
    const port = await reservePort();
    const withServePacks = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port },
    });

    const configResult = await callConfig(withServePacks, { root });

    expect(configResult).toMatchObject({
      define: {
        __LANGUAGE_PACK_DEV_SERVER__: JSON.stringify(
          `http://127.0.0.1:${port}`,
        ),
      },
    });

    const withoutServePacks = obsidianI18n({
      project: "project.inlang",
      output: "generated",
    });

    expect(await callConfig(withoutServePacks, { root })).toBeUndefined();
  });

  test("serves generated packs over loopback only when activated", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const port = await reservePort();
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port },
    });
    await callConfigResolved(plugin, { root } as ResolvedConfig);
    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: () => {},
    });

    await expect(
      fetch(`http://127.0.0.1:${port}/en.json`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      locale: "en",
      messages: { plugin_message: "Plugin" },
    });

    await callHook(plugin.closeWatcher);
  });

  test("keeps the pack server up while the watcher idles between builds", async () => {
    const projectPath = await createFixtureProject(
      { plugin_message: "Plugin", docs_message: "Docs" },
      { prefix: "obsidian-i18n-vite-" },
    );
    const root = dirname(projectPath);
    const port = await reservePort();
    const plugin = obsidianI18n({
      project: "project.inlang",
      output: "generated",
      servePacks: { port },
    });
    await callConfigResolved(plugin, { root } as ResolvedConfig);
    await callBuildStart(plugin, {
      addWatchFile: () => {},
      warn: () => {},
    });

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
): Promise<unknown> {
  if (typeof plugin.config !== "function") {
    throw new Error("Expected a config hook");
  }
  return plugin.config.call({} as never, config, {
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

async function reservePort(): Promise<number> {
  await using server = createServer();
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return address.port;
}
