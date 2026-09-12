import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, onTestFinished, test } from "vitest";

import { generateParaglide, paraglideVitePlugin } from "./index.js";

async function fixture(prefix = "paraglide-") {
  const scratch = resolve(import.meta.dirname, "../../../tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, prefix));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "project.inlang"));
  await copyFile(
    fileURLToPath(import.meta.resolve("@inlang/plugin-message-format")),
    join(root, "format.js"),
  );
  await writeFile(
    join(root, "project.inlang/settings.json"),
    JSON.stringify({
      baseLocale: "en",
      locales: ["en"],
      modules: ["./format.js"],
      "plugin.inlang.messageFormat": { pathPattern: "./{locale}.json" },
    }),
  );
  await writeFile(
    join(root, "en.json"),
    JSON.stringify({ greeting: "First greeting", stable: "Unchanged" }),
  );
  return root;
}

test("generates messages without starting Vite", async () => {
  const root = await fixture();
  const outdir = join(root, "generated");
  await generateParaglide({
    project: join(root, "project.inlang"),
    outdir,
    outputStructure: "message-modules",
    strategy: ["baseLocale"],
  });
  expect(
    await readFile(join(outdir, "messages/greeting.js"), "utf8"),
  ).toContain("First greeting");
});

test("generates before framework configuration and updates messages through Vite watching", async () => {
  const root = await fixture("cache-demo-");
  const file = join(root, "generated/messages/en.js");
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    plugins: [
      paraglideVitePlugin({
        project: join(root, "project.inlang"),
        outdir: join(root, "generated"),
        strategy: ["baseLocale"],
      }),
      {
        name: "framework-consumer",
        async configResolved() {
          // Framework plugins start dependency discovery during configuration.
          expect(await readFile(file, "utf8")).toContain("First greeting");
        },
      },
    ],
  });
  onTestFinished(() => server.close());
  await expect
    .poll(() => server.watcher.getWatched()[root])
    .toContain("en.json");
  const runtime = join(root, "generated/runtime.js");
  const timestamp = (await stat(runtime)).mtimeMs;
  await writeFile(
    join(root, "en.json"),
    JSON.stringify({ greeting: "Second greeting", stable: "Unchanged" }),
  );
  await expect
    .poll(async () => readFile(file, "utf8"), { timeout: 5000 })
    .toContain("Second greeting");
  expect((await stat(runtime)).mtimeMs).toBe(timestamp);
});

test("keeps compiler output caches separate for two plugin instances", async () => {
  const first = await fixture();
  const second = await fixture();
  await writeFile(
    join(second, "en.json"),
    JSON.stringify({ greeting: "Other application" }),
  );
  for (const root of [first, second]) {
    const server = await createServer({
      root,
      configFile: false,
      server: { middlewareMode: true },
      plugins: [
        paraglideVitePlugin({
          project: join(root, "project.inlang"),
          outdir: join(root, "generated"),
          strategy: ["baseLocale"],
        }),
      ],
    });
    onTestFinished(() => server.close());
  }
  expect(
    await readFile(join(first, "generated/messages/en.js"), "utf8"),
  ).toContain("First greeting");
  expect(
    await readFile(join(second, "generated/messages/en.js"), "utf8"),
  ).toContain("Other application");
});

test("preserves unchanged outputs across starts and repairs removed output files", async () => {
  const root = await fixture();
  async function start() {
    return createServer({
      root,
      configFile: false,
      server: { middlewareMode: true },
      plugins: [
        paraglideVitePlugin({
          project: join(root, "project.inlang"),
          outdir: join(root, "generated"),
          strategy: ["baseLocale"],
        }),
      ],
    });
  }
  const first = await start();
  await first.close();
  const runtime = join(root, "generated/runtime.js");
  const message = join(root, "generated/messages/en.js");
  const timestamp = (await stat(runtime)).mtimeMs;
  const second = await start();
  expect((await stat(runtime)).mtimeMs).toBe(timestamp);
  await second.close();
  await rm(message);
  const obsolete = join(root, "generated/obsolete.js");
  await writeFile(obsolete, "old generated output");
  const third = await start();
  onTestFinished(() => third.close());
  expect((await stat(runtime)).mtimeMs).toBe(timestamp);
  expect(await readFile(message, "utf8")).toContain("First greeting");
  await expect(stat(obsolete)).rejects.toMatchObject({ code: "ENOENT" });
});
