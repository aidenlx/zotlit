import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, isRunnableDevEnvironment } from "vite";
import { expect, test } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { chinesePagesPlugin } from "./chinese-pages-plugin";

// Development seam: adding, renaming, or deleting a Chinese edition updates
// SSR locale metadata in the already-running Vite server.
test("refreshes locale metadata when native Chinese files are added, renamed, and removed", async () => {
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  await mkdir(join(workspaceRoot, ".scratch"), { recursive: true });
  await using resources = new AsyncDisposableStack();
  const root = resources.adopt(
    await mkdtemp(join(workspaceRoot, ".scratch/chinese-pages-")),
    (path) => rm(path, { recursive: true, force: true }),
  );
  for (const section of ["docs", "blog", "changelog"]) {
    await mkdir(join(root, "content", section), { recursive: true });
  }
  await writeFile(
    join(root, "entry.ts"),
    `export { getPageLocaleState } from ${JSON.stringify(join(import.meta.dirname, "locale-state.ts"))};`,
  );
  const restartConfigured = Promise.withResolvers<void>();
  const continueRestart = Promise.withResolvers<void>();
  let configurations = 0;
  const server = resources.adopt(
    await createServer({
      root,
      configFile: false,
      plugins: [
        chinesePagesPlugin(root),
        {
          name: "deferred-restart",
          async configResolved() {
            if (++configurations === 2) {
              restartConfigured.resolve();
              await continueRestart.promise;
            }
          },
        },
      ],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    }),
    (value) => value.close(),
  );
  resources.defer(() => continueRestart.resolve());
  async function state(path: string) {
    const ssr = server.environments.ssr;
    if (!ssr || !isRunnableDevEnvironment(ssr)) {
      throw new Error("The locale test requires Vite's SSR runner.");
    }
    const { getPageLocaleState } =
      await ssr.runner.import<typeof import("./locale-state")>("/entry.ts");
    return getPageLocaleState(path, "zh-CN");
  }
  const page = join(root, "content/docs/added.zh-CN.mdx");
  expect(await state("/docs/added")).toMatchObject({
    contentLocale: "en",
    isFallback: true,
    canonicalPath: "/docs/added",
  });
  await expect
    .poll(() => server.watcher.getWatched()[join(root, "content")])
    .toContain("docs");
  await writeFile(page, "---\ntitle: 新增中文页\n---\n中文正文\n");
  // Deliver the filesystem event explicitly, as the collection watcher test does.
  server.watcher.emit("add", page);
  await restartConfigured.promise;
  // Another translation can arrive while Vite is compiling the first restart.
  const latePage = join(root, "content/changelog/2.1.0.zh-CN.mdx");
  await writeFile(latePage, "---\nversion: 2.1.0\n---\n中文更新记录\n");
  server.watcher.emit("add", latePage);
  continueRestart.resolve();
  await expect
    .poll(() => state("/docs/added"), { timeout: 5000 })
    .toMatchObject({
      contentLocale: "zh-CN",
      isFallback: false,
      canonicalPath: "/zh-CN/docs/added",
    });

  await expect
    .poll(() => state("/changelog/2.1.0"), { timeout: 5000 })
    .toMatchObject({
      contentLocale: "zh-CN",
      isFallback: false,
      canonicalPath: "/zh-CN/changelog/2.1.0",
    });

  const renamed = join(root, "content/blog/renamed.zh-CN.md");
  await rename(page, renamed);
  server.watcher.emit("unlink", page);
  server.watcher.emit("add", renamed);
  await expect
    .poll(
      async () => [await state("/docs/added"), await state("/blog/renamed")],
      {
        timeout: 5000,
      },
    )
    .toMatchObject([
      { contentLocale: "en", isFallback: true, canonicalPath: "/docs/added" },
      {
        contentLocale: "zh-CN",
        isFallback: false,
        canonicalPath: "/zh-CN/blog/renamed",
      },
    ]);

  await rm(renamed);
  server.watcher.emit("unlink", renamed);
  await expect
    .poll(() => state("/blog/renamed"), { timeout: 5000 })
    .toMatchObject({
      contentLocale: "en",
      isFallback: true,
      canonicalPath: "/blog/renamed",
    });
}, 20_000);
