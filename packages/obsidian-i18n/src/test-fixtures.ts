// Shared Inlang project fixtures for compiler/cli/vite tests. Not a tsdown
// entry and not a `*.test.ts` file, so it never lands in dist or gets run by
// vitest as a test suite itself.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { onTestFinished } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

/** A fresh `tmp/<prefix>*` directory, removed automatically when the test finishes. */
export async function createTemporaryDirectory(
  prefix = "zotlit-language-packs-",
): Promise<string> {
  const temporaryRoot = join(repoRoot, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, prefix));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Writes an Inlang message-format catalog, prefixing the `$schema` field. */
export async function writeCatalog(
  path: string,
  messages: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        $schema: "https://inlang.com/schema/inlang-message-format",
        ...messages,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/**
 * A minimal Inlang project under a fresh temporary directory, with its base
 * locale (`en`) catalog seeded from `messages`. Returns the project's path.
 */
export async function createFixtureProject(
  messages: Record<string, unknown>,
  { prefix }: { prefix?: string } = {},
): Promise<string> {
  const fixtureRoot = await createTemporaryDirectory(prefix);
  const projectPath = join(fixtureRoot, "project.inlang");
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, "settings.json"),
    `${JSON.stringify(
      {
        $schema: "https://inlang.com/schema/project-settings",
        modules: [
          "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.0.0/dist/index.js",
          "https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2.2.9/dist/index.js",
        ],
        baseLocale: "en",
        locales: ["en"],
        "plugin.inlang.messageFormat": {
          pathPattern: "./messages/{locale}.json",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeCatalog(join(fixtureRoot, "messages", "en.json"), messages);
  return projectPath;
}

/** Adds a locale to a fixture project's settings and writes its catalog. */
export async function addLocale(
  projectPath: string,
  locale: string,
  messages: Record<string, unknown>,
): Promise<void> {
  const settingsPath = join(projectPath, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings.locales = [...settings.locales, locale];
  await writeFile(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
  await writeCatalog(
    join(dirname(projectPath), "messages", `${locale}.json`),
    messages,
  );
}

/** Adds a second `pathPattern` entry so a locale's messages merge from two catalogs. */
export async function addSourcePattern(
  projectPath: string,
  directoryName: string,
  {
    messages,
    locale = "en",
  }: { messages: Record<string, unknown>; locale?: string },
): Promise<string> {
  const settingsPath = join(projectPath, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings["plugin.inlang.messageFormat"].pathPattern = [
    "./messages/{locale}.json",
    `./${directoryName}/{locale}.json`,
  ];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  const sourcePath = join(
    dirname(projectPath),
    directoryName,
    `${locale}.json`,
  );
  await writeCatalog(sourcePath, messages);
  return sourcePath;
}
