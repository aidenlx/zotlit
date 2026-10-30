import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, PlatformError } from "effect";
import { TestClock } from "effect/testing";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import "@mock/dom-parser";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { describe, expect } from "vitest";

import { CONTRACT_VERSION } from "./contract";
import {
  CSL_COMMAND,
  materializeCslStyle,
  resolveCslStyle as resolveStyleEffect,
} from "./csl";
import type { CslResponse } from "./csl";
import { resolveInstalledStyle } from "./styles";

/** Filenames the filesystem refuses outright, as a file without read access is. */
const deniedReads = new Set<string>();

const deniedFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) =>
    FileSystem.make({
      ...fs,
      readFile: (path) =>
        deniedReads.has(basename(path))
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "readFile",
                pathOrDescriptor: path,
              }),
            )
          : fs.readFile(path),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));
const resolveCslStyle = (...args: Parameters<typeof resolveStyleEffect>) =>
  resolveStyleEffect(...args).pipe(Effect.provide(deniedFileSystem));

const PARENT = "http://www.zotero.org/styles/journal";
const DEPENDENT = "http://www.zotero.org/styles/journal-german";
const BROKEN_DEPENDENT = "http://www.zotero.org/styles/journal-broken";
const MISSING = "http://www.zotero.org/styles/uninstalled";

describe("zotlit:csl", () => {
  effectIt.live("answers a materialized file for an independent style", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );

      const response = yield* zotero.csl(PARENT);

      expect(response).toEqual({
        contractVersion: CONTRACT_VERSION,
        command: CSL_COMMAND,
        styleId: PARENT,
        path: expect.stringMatching(/\.csl$/),
        title: PARENT,
      });
      expect(
        yield* Effect.promise(() => readFile(pathOf(response), "utf8")),
      ).toContain(`<id>${PARENT}</id>`);
    }),
  );

  effectIt.live(
    "names the independent parent a dependent style resolved through",
    () =>
      Effect.gen(function* () {
        const zotero = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        const response = yield* zotero.csl(DEPENDENT);

        expect(response).toMatchObject({
          styleId: DEPENDENT,
          parentId: PARENT,
        });
        // The parent's formatting under the dependent style's own default locale.
        const xml = yield* Effect.promise(() =>
          readFile(pathOf(response), "utf8"),
        );
        expect(xml).toContain(`<id>${PARENT}</id>`);
        expect(xml).toContain('default-locale="de-DE"');
      }),
  );

  effectIt.live(
    "answers one path for identical content and another for changed content",
    () =>
      Effect.gen(function* () {
        const zotero = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        const first = pathOf(yield* zotero.csl(PARENT));
        expect(pathOf(yield* zotero.csl(PARENT))).toBe(first);

        yield* Effect.promise(() =>
          zotero.writeStyle("journal.csl", {
            id: PARENT,
            body: '<bibliography><layout><text value="revised"/></layout></bibliography>',
            hidden: true,
          }),
        );

        expect(pathOf(yield* zotero.csl(PARENT))).not.toBe(first);
      }),
  );

  effectIt.effect(
    "restamps a materialized style with TestClock time (#1793)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const path = yield* materializeCslStyle("<style/>", directory);
        yield* fs.utimes(path, 0, 0);
        yield* TestClock.setTime(1_800_000_000_000);
        expect(yield* materializeCslStyle("<style/>", directory)).toBe(path);
        expect(Option.getOrThrow((yield* fs.stat(path)).mtime).getTime()).toBe(
          1_800_000_000_000,
        );
        expect(yield* fs.readDirectory(directory)).toEqual([basename(path)]);
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  effectIt.live("never exposes a partial file to a concurrent run", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );

      const responses = yield* Effect.all(
        Array.from({ length: 8 }, () => zotero.csl(DEPENDENT)),
        { concurrency: "unbounded" },
      );

      const paths = new Set(responses.map(pathOf));
      expect(paths.size).toBe(1);
      const [path] = paths;
      expect(yield* Effect.promise(() => readFile(path!, "utf8"))).toContain(
        "</style>",
      );
      // The staged writes leave nothing of their own behind.
      expect(yield* Effect.promise(() => readdir(dirname(path!)))).toEqual([
        basename(path!),
      ]);
    }),
  );

  effectIt.live("reports an uninstalled requested style", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );

      expect(yield* zotero.csl(MISSING)).toEqual({
        contractVersion: CONTRACT_VERSION,
        command: CSL_COMMAND,
        errors: [
          {
            code: "style-missing",
            styleId: MISSING,
            message: expect.stringContaining(MISSING),
          },
        ],
      });
    }),
  );

  effectIt.live("reports an uninstalled independent parent", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        zotero.writeStyle("orphan.csl", {
          id: "http://www.zotero.org/styles/orphan",
          parentId: MISSING,
        }),
      );

      expect(
        yield* zotero.csl("http://www.zotero.org/styles/orphan"),
      ).toMatchObject({
        errors: [{ code: "parent-missing", parentId: MISSING }],
      });
    }),
  );

  effectIt.live("reports a CSL file that refuses to be read", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      deniedReads.add("journal.csl");

      expect(yield* zotero.csl(DEPENDENT)).toMatchObject({
        errors: [{ code: "style-unreadable", styleId: DEPENDENT }],
      });
    }),
  );

  effectIt.live("reports content that is no standalone CSL style", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        zotero.writeCsl(
          "broken.csl",
          `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><id>${MISSING}</id></info><bibliography><layout><text value="x"/></bibliography></style>`,
        ),
      );

      expect(yield* zotero.csl(MISSING)).toMatchObject({
        errors: [{ code: "style-invalid", styleId: MISSING }],
      });
    }),
  );

  effectIt.live(
    "reports a dependent style whose own file is no CSL style",
    () =>
      Effect.gen(function* () {
        const zotero = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        // The file names the installed parent, and closes an element it never
        // opened. The parent's formatting stands in for the formatting a dependent
        // style leaves out, never for markup it holds broken.
        yield* Effect.promise(() =>
          zotero.writeCsl(
            "journal-broken.csl",
            `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><id>${BROKEN_DEPENDENT}</id><link href="${PARENT}" rel="independent-parent"/></info><layout/></citation></style>`,
          ),
        );

        expect(yield* zotero.csl(BROKEN_DEPENDENT)).toMatchObject({
          errors: [
            {
              code: "style-invalid",
              styleId: BROKEN_DEPENDENT,
              parentId: PARENT,
            },
          ],
        });
      }),
  );

  effectIt.live("reports a materialization that fails", () =>
    Effect.gen(function* () {
      const zotero = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );

      expect(
        yield* Effect.flip(
          resolveCslStyle(PARENT, {
            resolve: (styleId) =>
              resolveInstalledStyle(zotero.dataDir, { styleId }),
            materialize: () =>
              Effect.fail(
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "FileSystem",
                  method: "writeFileString",
                  description: "no space left on device",
                }),
              ),
          }),
        ),
      ).toMatchObject({
        _tag: "CslWriteError",
        styleId: PARENT,
        cause: {
          _tag: "PlatformError",
          reason: { description: "no space left on device" },
        },
      });
    }),
  );
});

/**
 * The path a successful response carries, asserting there is one and that it is
 * absolute — citeproc opens it from whatever working directory Pandoc runs in.
 */
function pathOf(response: CslResponse): string {
  expect(response).not.toHaveProperty("errors");
  const path = "path" in response ? response.path : "";
  expect(isAbsolute(path)).toBe(true);
  return path;
}

interface StyleFixture {
  id: string;
  parentId?: string;
  defaultLocale?: string;
  /** The elements a processor formats with, absent for a dependent style. */
  body?: string;
  hidden?: boolean;
}

/** One Zotero install, and the materialization store its resolutions land in. */
interface ZoteroStyles extends AsyncDisposable {
  dataDir: string;
  /** One `zotlit:csl` call against this install. */
  csl: (styleId: string) => ReturnType<typeof resolveCslStyle>;
  writeStyle: (filename: string, fixture: StyleFixture) => Promise<void>;
  writeCsl: (filename: string, xml: string) => Promise<void>;
}

async function installStyles(): Promise<ZoteroStyles> {
  await using stack = new AsyncDisposableStack();
  const root = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-csl-command-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  deniedReads.clear();

  const dataDir = join(root, "zotero");
  const store = join(root, "store");
  const writeCsl = async (
    filename: string,
    xml: string,
    { hidden = false } = {},
  ): Promise<void> => {
    const dir = join(dataDir, "styles", ...(hidden ? ["hidden"] : []));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), xml);
  };
  await writeCsl("journal.csl", styleXml({ id: PARENT }), { hidden: true });
  await writeCsl(
    "journal-german.csl",
    styleXml({ id: DEPENDENT, parentId: PARENT, defaultLocale: "de-DE" }),
  );

  const held = stack.move();
  return {
    dataDir,
    csl: (styleId) =>
      resolveCslStyle(styleId, {
        resolve: (requested) =>
          resolveInstalledStyle(dataDir, { styleId: requested }),
        materialize: (xml) => materializeCslStyle(xml, store),
      }),
    writeStyle: (filename, fixture) =>
      writeCsl(filename, styleXml(fixture), fixture),
    writeCsl: (filename, xml) => writeCsl(filename, xml),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** A CSL file shaped like the ones Zotero installs. */
function styleXml({ id, parentId, defaultLocale, body }: StyleFixture): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"${
      defaultLocale === undefined ? "" : ` default-locale="${defaultLocale}"`
    }>`,
    "  <info>",
    `    <id>${id}</id>`,
    ...(parentId === undefined
      ? []
      : [`    <link href="${parentId}" rel="independent-parent"/>`]),
    "  </info>",
    ...(parentId === undefined
      ? [
          body ??
            `  <bibliography><layout><text value="${id}"/></layout></bibliography>`,
        ]
      : []),
    "</style>",
  ].join("\n");
}
