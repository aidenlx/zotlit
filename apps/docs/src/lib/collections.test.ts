import { fumadocsMdx } from "fumadocs-mdx/vite";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";
import { expect, test } from "vitest";

import {
  getPackageRoot,
  getWorkspaceRoot,
} from "@zotlit/scripts/package-roots";

test("native collections load and watch content without generated entry files", async () => {
  const packageRoot = getPackageRoot(import.meta.filename);
  const workspaceRoot = await getWorkspaceRoot(packageRoot);
  await mkdir(join(workspaceRoot, "tmp"), { recursive: true });
  await using resources = new AsyncDisposableStack();
  const root = resources.adopt(
    await mkdtemp(join(workspaceRoot, "tmp/native-collections-")),
    (path) => rm(path, { recursive: true, force: true }),
  );
  await symlink(
    join(packageRoot, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
  for (const directory of ["docs", "blog", "changelog"]) {
    await mkdir(join(root, "content", directory), { recursive: true });
  }
  const optionsPath = join(root, "options.ts");
  const options = `import * as v from "valibot";
import { docsSchema } from ${JSON.stringify(join(packageRoot, "content.config.ts"))};
export * from ${JSON.stringify(join(packageRoot, "content.config.ts"))};
export const fixtureSchema = v.object({ ...docsSchema.entries, description: v.optional(v.string(), "Original description") });
`;
  await writeFile(optionsPath, options);
  const modulePath = join(root, "collections.ts");
  const declarations = (
    await readFile(join(import.meta.dirname, "collections.ts"), "utf8")
  )
    .replaceAll("../../content.config", optionsPath)
    .replace(".docsSchema", ".fixtureSchema");
  await writeFile(modulePath, declarations);
  await writeFile(join(root, "source.config.ts"), "export default {};\n");
  const pagePath = join(root, "content/docs/index.mdx");
  await writeFile(
    pagePath,
    "---\ntitle: Fixture\nintroduced: 2.1.0\n---\n# Overview\n\nFirst body\n",
  );
  await writeFile(
    join(root, "content/docs/_partial.mdx"),
    "---\ntitle: Partial\n---\nShared text\n",
  );
  await writeFile(
    join(root, "content/docs/meta.json"),
    '{"title":"Fixture sidebar"}',
  );
  await writeFile(
    join(root, "content/blog/post.mdx"),
    "---\ntitle: Post\ndate: 2026-01-02\n---\nPost body\n",
  );
  await writeFile(
    join(root, "content/changelog/2.1.0.mdx"),
    "---\nversion: 2.1.0\ndate: 2026-01-03\n---\nRelease body\n",
  );
  const server = resources.adopt(
    await createServer({
      root,
      configFile: false,
      plugins: [fumadocsMdx({ index: false })],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
    }),
    (value) => value.close(),
  );
  const ssr = server.environments.ssr;
  if (!ssr || !isRunnableDevEnvironment(ssr)) {
    throw new Error("The collection test requires Vite's SSR runner.");
  }
  const load = () =>
    ssr.runner.import<typeof import("./collections")>("/collections.ts");
  const collections = await load();
  expect(collections.docs.docs.map((page) => page.title)).toEqual(["Fixture"]);
  expect(collections.docs.getMeta("meta.json")?.title).toBe("Fixture sidebar");
  expect(collections.blogs.get("post.mdx")).toMatchObject({
    author: "aidenlx",
    date: "2026-01-02",
  });
  expect(collections.changelogs.get("2.1.0.mdx")?.date).toBe("2026-01-03");
  const page = collections.docs.getPage("index.mdx")!;
  expect(page.description).toBe("Original description");
  await page.preload();
  const content = await page.load();
  expect(content.toc[0]).toMatchObject({ url: "#overview", depth: 1 });
  expect(content._exports._markdown).toBeTypeOf("function");
  expect(page.body).toBeTypeOf("function");
  expect(
    (await server.transformRequest("/collections.ts"))?.code,
  ).not.toContain("content.config");
  await expect(readFile(join(root, ".source/server.ts"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );

  await expect
    .poll(() => server.watcher.getWatched()[join(root, "content/docs")])
    .toContain("index.mdx");
  await writeFile(
    pagePath,
    "---\ntitle: Updated\n---\n# Changed\n\nSecond body\n",
  );
  await expect
    .poll(async () => (await load()).docs.getPage("index.mdx")?.title, {
      timeout: 5000,
    })
    .toBe("Updated");
  const added = join(root, "content/docs/added.mdx");
  await writeFile(added, "---\ntitle: Added\n---\nAdded body\n");
  await expect
    .poll(async () => (await load()).docs.getPage("added.mdx")?.title, {
      timeout: 5000,
    })
    .toBe("Added");
  await rm(added);
  await expect
    .poll(async () => (await load()).docs.getPage("added.mdx"), {
      timeout: 5000,
    })
    .toBeUndefined();
  await writeFile(modulePath, declarations.replace("**/[^_]*.mdx", "**/*.mdx"));
  await expect
    .poll(async () => (await load()).docs.getPage("_partial.mdx")?.title, {
      timeout: 5000,
    })
    .toBe("Partial");
  await writeFile(
    optionsPath,
    options.replace("Original description", "Updated description"),
  );
  await expect
    .poll(async () => (await load()).docs.getPage("index.mdx")?.description, {
      timeout: 5000,
    })
    .toBe("Updated description");
  await writeFile(
    join(root, "source.config.ts"),
    `export default {
    mdxOptions: { remarkPlugins: [() => (tree) => {
      tree.children.push({ type: "paragraph", children: [{ type: "text", value: "Configured suffix" }] });
    }] }
  };`,
  );
  await expect
    .poll(
      async () => {
        const page = (await load()).docs.getPage("index.mdx")!;
        await page.preload();
        return renderToStaticMarkup(createElement(page.body));
      },
      { timeout: 5000 },
    )
    .toContain("Configured suffix");
});
