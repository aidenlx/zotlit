import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, test } from "vitest";

import type { LanguagePackRuntime } from "@zotlit/obsidian-i18n";
import { compile } from "@zotlit/obsidian-i18n/compiler";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

test("the ZotLit project compiles through the reusable package contract", async () => {
  await using generated = await compileRealProject();

  expect(generated.result.messageCount).toBeGreaterThan(400);
  expect(generated.basePack.messages).not.toHaveProperty("docs_index_title");
  expect(generated.messages.hello()).toBe("world");
  // Lifecycle copy renders in the target language from the bundled subset,
  // with no Language Pack installed and no network access.
  expect(generated.messages.settings_language_pack_name()).toBe(
    "Language pack",
  );
  generated.runtime.setTargetLocale("zh-CN");
  expect(generated.messages.settings_language_pack_name()).toBe("语言包");
  expect(
    generated.messages.settings_language_pack_desc({ language: "简体中文" }),
  ).toBe("以 简体中文 显示 ZotLit 界面。安装时将下载语言包。");
  // Everything outside the configured prefixes keeps the existing ladder.
  expect(generated.messages.hello()).toBe("world");
  expect(generated.messages.creator_summary({ count: 3, first: "Ada" })).toBe(
    "Ada et al.",
  );
  expect(await readdir(generated.result.outputDirectory)).toContain(
    "catalog.ts",
  );
});

type RealProjectMessages = {
  hello(): string;
  creator_summary(inputs: { count: number; first: string }): string;
  settings_language_pack_name(): string;
  settings_language_pack_desc(inputs: { language: string }): string;
};

async function compileRealProject(): Promise<{
  result: Awaited<ReturnType<typeof compile>>;
  basePack: { messages: Record<string, unknown> };
  runtime: LanguagePackRuntime;
  messages: RealProjectMessages;
  [Symbol.asyncDispose](): Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const output = await mkdtemp(join(tmpdir(), "zotlit-i18n-contract-"));
  resources.defer(() => rm(output, { recursive: true, force: true }));

  const result = await compile({
    root: workspaceRoot,
    project: "project.inlang",
    output,
    excludeMessagePrefixes: ["docs_"],
    targetLocaleMessagePrefixes: [
      "notice_language_pack_",
      "settings_language_pack_",
    ],
  });
  const basePack = JSON.parse(await readFile(join(output, "en.json"), "utf8"));
  const server = await createServer({
    root: output,
    logLevel: "silent",
    appType: "custom",
    resolve: {
      alias: {
        "@zotlit/obsidian-i18n": fileURLToPath(
          import.meta.resolve("@zotlit/obsidian-i18n"),
        ),
      },
    },
    server: { middlewareMode: true },
  });
  resources.defer(() => server.close());
  const { runtime } = (await server.ssrLoadModule("/runtime.ts")) as {
    runtime: LanguagePackRuntime;
  };
  const messages = (await server.ssrLoadModule(
    "/messages.ts",
  )) as RealProjectMessages;
  const disposal = resources.move();

  return {
    result,
    basePack,
    runtime,
    messages,
    [Symbol.asyncDispose]: () => disposal.disposeAsync(),
  };
}
