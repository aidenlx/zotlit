// Shared Inlang project fixtures for compiler/cli/vite tests. Not a tsdown
// entry and not a `*.test.ts` file, so it never lands in dist or gets run by
// vitest as a test suite itself.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";

/**
 * A fresh `<os-tmpdir>/<prefix>*` directory, removed automatically when the
 * test finishes. Fixtures stay out of the repository tree so an interrupted
 * run leaves no artifacts in the workspace.
 */
export async function createTemporaryDirectory(
  prefix = "zotlit-language-packs-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
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
        // No `modules`: the compiler supplies the message-format and
        // m-function-matcher plugins directly (see `INLANG_PLUGINS` in
        // compiler.ts), so fixtures never trigger a network fetch.
        $schema: "https://inlang.com/schema/project-settings",
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
