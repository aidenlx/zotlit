import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import "@mock/dom-parser";
import { it as effectIt } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  listInstalledStyles,
  listInstalledStylesOrNone,
} from "./installed-styles";
import {
  InstalledStyleCache as EffectStyleCache,
  resolveInstalledStyle as resolveStyleEffect,
  styleHasEntryMarkers,
} from "./styles";
import type { ResolvedCslStyle } from "./styles";

/**
 * Content reads left before the filesystem refuses, which puts a resolution in
 * front of a file that stopped being readable partway through.
 */
let allowedReads = Number.POSITIVE_INFINITY;

/** Filenames the filesystem refuses outright, as a file without read access is. */
const deniedReads = new Set<string>();

/** Directory names the filesystem refuses to list, as one without access is. */
const deniedDirs = new Set<string>();

/** A refusal shaped as the Node file system reports one. */
const refused = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

/** The Node file system, refusing the folders and files a case denies. */
const deniedFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) =>
    FileSystem.make({
      ...fs,
      readDirectory: (path, options) =>
        deniedDirs.has(basename(path))
          ? Effect.fail(refused("readDirectory", path))
          : fs.readDirectory(path, options),
      readFile: (path) =>
        allowedReads-- <= 0 || deniedReads.has(basename(path))
          ? Effect.fail(refused("readFile", path))
          : fs.readFile(path),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const resolveInstalledStyle = (
  dataDir: string,
  request: Parameters<typeof resolveStyleEffect>[1],
) =>
  resolveStyleEffect(dataDir, request).pipe(Effect.provide(deniedFileSystem));
class InstalledStyleCache {
  readonly cache = new EffectStyleCache();
  resolve(dataDir: string, request: Parameters<typeof resolveStyleEffect>[1]) {
    return this.cache
      .resolve(dataDir, request)
      .pipe(Effect.provide(deniedFileSystem));
  }
}
/** The installed-style list over the Node file system. */
const listed = (dataDir: string) =>
  listInstalledStyles(dataDir).pipe(Effect.provide(deniedFileSystem));

interface StyleFixture {
  id: string;
  title?: string;
  parentId?: string;
  defaultLocale?: string;
  hidden?: boolean;
}

/** One Zotero data directory, holding the styles a test installs into it. */
interface StyleLibrary extends AsyncDisposable {
  /** The Zotero data directory the resolver reads. */
  dataDir: string;
  /** Write a CSL file shaped like the ones Zotero installs. */
  writeStyle: (filename: string, fixture: StyleFixture) => Promise<void>;
  /** Write a `.csl` file verbatim, as content no installed style describes. */
  writeCsl: (
    filename: string,
    xml: string,
    options?: { hidden?: boolean },
  ) => Promise<void>;
  /** Where an installed file sits, for the timestamp a test pins on it. */
  pathOf: (filename: string, options?: { hidden?: boolean }) => string;
}

/** A Zotero install of its own, and a filesystem that refuses nothing yet. */
async function installStyles(): Promise<StyleLibrary> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-csl-styles-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  allowedReads = Number.POSITIVE_INFINITY;
  deniedReads.clear();
  deniedDirs.clear();

  const pathOf = (filename: string, { hidden = false } = {}): string =>
    join(dataDir, "styles", ...(hidden ? ["hidden"] : []), filename);
  const writeCsl = async (
    filename: string,
    xml: string,
    options: { hidden?: boolean } = {},
  ): Promise<void> => {
    const path = pathOf(filename, options);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, xml);
  };

  const held = stack.move();
  return {
    dataDir,
    pathOf,
    writeCsl,
    writeStyle: (filename, fixture) =>
      writeCsl(filename, styleXml(fixture), fixture),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** A CSL file shaped like the ones Zotero installs. */
function styleXml({
  id,
  title,
  parentId,
  defaultLocale,
}: StyleFixture): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"${
      defaultLocale === undefined ? "" : ` default-locale="${defaultLocale}"`
    }>`,
    "  <info>",
    ...(title === undefined ? [] : [`    <title>${title}</title>`]),
    `    <id>${id}</id>`,
    `    <link href="${id}" rel="self"/>`,
    ...(parentId === undefined
      ? []
      : [`    <link href="${parentId}" rel="independent-parent"/>`]),
    "  </info>",
    `  <bibliography><layout><text value="${id}"/></layout></bibliography>`,
    "</style>",
  ].join("\n");
}

/** The resolved CSL, with the assertion that there is any. */
function installedXml(style: ResolvedCslStyle): string {
  expect(style.kind).toBe("installed");
  return style.kind === "installed" ? style.xml : "";
}

describe("listInstalledStyles", () => {
  effectIt.effect(
    "keeps readable picker choices when the hidden directory refuses a read (#1793)",
    () =>
      Effect.gen(function* () {
        const APA = "http://www.zotero.org/styles/apa";
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, title: "APA" }),
        );
        deniedDirs.add("hidden");
        expect(
          yield* listInstalledStylesOrNone(library.dataDir).pipe(
            Effect.provide(deniedFileSystem),
          ),
        ).toEqual([{ id: APA, title: "APA" }]);
      }),
  );

  effectIt.live("lists visible styles by style ID, sorted by title", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", {
          id: "http://www.zotero.org/styles/apa",
          title: "APA Style 7th edition",
        }),
      );
      // Filename and style ID disagree: the ID is the identity that matters.
      yield* Effect.promise(() =>
        library.writeStyle("renamed.csl", {
          id: "http://www.zotero.org/styles/chicago-author-date",
          title: "Chicago Manual of Style 18th edition (author-date)",
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("notes.txt", { id: "not-a-style" }),
      );

      expect(yield* listed(library.dataDir)).toEqual([
        {
          id: "http://www.zotero.org/styles/apa",
          title: "APA Style 7th edition",
        },
        {
          id: "http://www.zotero.org/styles/chicago-author-date",
          title: "Chicago Manual of Style 18th edition (author-date)",
        },
      ]);
    }),
  );

  effectIt.live(
    "omits hidden styles, which serve only as independent parents",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", {
            id: "http://www.zotero.org/styles/nature",
            title: "Nature",
            hidden: true,
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", {
            id: "http://www.zotero.org/styles/apa",
            title: "APA",
          }),
        );

        expect(yield* listed(library.dataDir)).toEqual([
          { id: "http://www.zotero.org/styles/apa", title: "APA" },
        ]);
      }),
  );

  effectIt.live(
    "omits a dependent style whose independent parent is unavailable",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("orphan.csl", {
            id: "http://www.zotero.org/styles/orphan",
            title: "Orphan",
            parentId: "http://www.zotero.org/styles/uninstalled",
          }),
        );

        expect(yield* listed(library.dataDir)).toEqual([]);
      }),
  );

  effectIt.live(
    "decodes entities in a title and falls back to the style ID",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("ampersand.csl", {
            id: "http://www.zotero.org/styles/ampersand",
            title: "Alcohol &amp; Drug Education",
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("my-private-draft.csl", {
            id: "http://www.zotero.org/styles/untitled",
          }),
        );

        expect(yield* listed(library.dataDir)).toEqual([
          {
            id: "http://www.zotero.org/styles/ampersand",
            title: "Alcohol & Drug Education",
          },
          {
            id: "http://www.zotero.org/styles/untitled",
            title: "http://www.zotero.org/styles/untitled",
          },
        ]);
      }),
  );

  effectIt.live("lists nothing when Zotero installed no styles", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );

      expect(yield* listed(library.dataDir)).toEqual([]);
    }),
  );

  effectIt.live("lists nothing when the styles folder is empty", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        mkdir(join(library.dataDir, "styles"), { recursive: true }),
      );

      expect(yield* listed(library.dataDir)).toEqual([]);
    }),
  );

  effectIt.live("skips a CSL file it cannot read", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", {
          id: "http://www.zotero.org/styles/apa",
          title: "APA",
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", {
          id: "http://www.zotero.org/styles/nature",
          title: "Nature",
        }),
      );
      deniedReads.add("nature.csl");

      expect(yield* listed(library.dataDir)).toEqual([
        { id: "http://www.zotero.org/styles/apa", title: "APA" },
      ]);
    }),
  );

  effectIt.live("fails when the styles folder cannot be read", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", {
          id: "http://www.zotero.org/styles/apa",
          title: "APA",
        }),
      );
      deniedDirs.add("styles");

      expect(yield* Effect.flip(listed(library.dataDir))).toMatchObject({
        _tag: "PlatformError",
        reason: { _tag: "PermissionDenied" },
      });
    }),
  );

  effectIt.live("fails when the hidden styles folder cannot be read", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", {
          id: "http://www.zotero.org/styles/apa",
          title: "APA",
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature-neuroscience.csl", {
          id: "http://www.zotero.org/styles/nature-neuroscience",
          title: "Nature Neuroscience",
          parentId: "http://www.zotero.org/styles/nature",
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", {
          id: "http://www.zotero.org/styles/nature",
          title: "Nature",
          hidden: true,
        }),
      );
      deniedDirs.add("hidden");

      expect(yield* Effect.flip(listed(library.dataDir))).toMatchObject({
        _tag: "PlatformError",
        reason: { _tag: "PermissionDenied" },
      });
    }),
  );
});

describe("resolveInstalledStyle", () => {
  const APA = "http://www.zotero.org/styles/apa";
  const IEEE = "http://www.zotero.org/styles/ieee";
  const NATURE = "http://www.zotero.org/styles/nature";
  const NATURE_NEUROSCIENCE =
    "http://www.zotero.org/styles/nature-neuroscience";

  effectIt.live("resolves an independent style to its own content", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", { id: APA, title: "APA" }),
      );

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toMatchObject({
        kind: "installed",
        styleId: APA,
        parentId: undefined,
        xml: expect.stringContaining(`<id>${APA}</id>`),
      });
    }),
  );

  effectIt.live(
    "keeps a dependent style's identity, provenance, and default locale",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature-neuroscience.csl", {
            id: NATURE_NEUROSCIENCE,
            title: "Nature Neuroscience",
            parentId: NATURE,
            defaultLocale: "de-DE",
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", {
            id: NATURE,
            title: "Nature",
            hidden: true,
          }),
        );

        const style = yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        });

        expect(style).toMatchObject({
          kind: "installed",
          styleId: NATURE_NEUROSCIENCE,
          parentId: NATURE,
        });
        // The parent's formatting, under the dependent style's own locale.
        expect(installedXml(style)).toContain(`<id>${NATURE}</id>`);
        expect(installedXml(style)).toContain('default-locale="de-DE"');
      }),
  );

  effectIt.live(
    "leaves a dependent style that declares no locale to its parent's",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature-neuroscience.csl", {
            id: NATURE_NEUROSCIENCE,
            title: "Nature Neuroscience",
            parentId: NATURE,
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", {
            id: NATURE,
            title: "Nature",
            defaultLocale: "en-GB",
            hidden: true,
          }),
        );

        expect(
          yield* resolveInstalledStyle(library.dataDir, {
            styleId: NATURE_NEUROSCIENCE,
          }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining('default-locale="en-GB"'),
        });
      }),
  );

  effectIt.live(
    "reads a dependent style whichever way its XML writes attributes",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        // Single-quoted values and spaces around `=`: XML a parser reads exactly as
        // it reads the double-quoted, tightly written form Zotero usually installs.
        yield* Effect.promise(() =>
          library.writeCsl(
            "nature-neuroscience.csl",
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              "<style xmlns='http://purl.org/net/xbiblio/csl' version='1.0' default-locale = 'de-DE'>",
              "  <info>",
              "    <title>Nature Neuroscience</title>",
              `    <id>${NATURE_NEUROSCIENCE}</id>`,
              `    <link href = '${NATURE_NEUROSCIENCE}' rel = 'self'/>`,
              `    <link href = '${NATURE}' rel = 'independent-parent'/>`,
              "  </info>",
              "</style>",
            ].join("\n"),
          ),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", {
            id: NATURE,
            title: "Nature",
            hidden: true,
          }),
        );

        const style = yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        });

        expect(style).toMatchObject({
          kind: "installed",
          styleId: NATURE_NEUROSCIENCE,
          parentId: NATURE,
        });
        expect(installedXml(style)).toContain(`<id>${NATURE}</id>`);
        expect(installedXml(style)).toContain('default-locale="de-DE"');
      }),
  );

  effectIt.live(
    "reads a dependent style written under a namespace prefix",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        // The CSL namespace bound to a prefix, which says what the unprefixed
        // spelling says — a parser reads the two documents alike.
        yield* Effect.promise(() =>
          library.writeCsl(
            "nature-neuroscience.csl",
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<cs:style xmlns:cs="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="de-DE">',
              "  <cs:info>",
              "    <cs:title>Nature Neuroscience</cs:title>",
              `    <cs:id>${NATURE_NEUROSCIENCE}</cs:id>`,
              `    <cs:link href="${NATURE_NEUROSCIENCE}" rel="self"/>`,
              `    <cs:link href="${NATURE}" rel="independent-parent"/>`,
              "  </cs:info>",
              "</cs:style>",
            ].join("\n"),
          ),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", {
            id: NATURE,
            title: "Nature",
            hidden: true,
          }),
        );

        expect(yield* listed(library.dataDir)).toEqual([
          { id: NATURE_NEUROSCIENCE, title: "Nature Neuroscience" },
        ]);
        const style = yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        });

        expect(style).toMatchObject({
          kind: "installed",
          styleId: NATURE_NEUROSCIENCE,
          parentId: NATURE,
        });
        expect(installedXml(style)).toContain(`<id>${NATURE}</id>`);
        expect(installedXml(style)).toContain('default-locale="de-DE"');
      }),
  );

  effectIt.live(
    "renders a Citation Locale into a style written under a namespace prefix",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeCsl(
            "apa.csl",
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<cs:style xmlns:cs="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="en-US">',
              `  <cs:info><cs:title>APA</cs:title><cs:id>${APA}</cs:id></cs:info>`,
              '  <cs:bibliography><cs:layout><cs:text value="apa"/></cs:layout></cs:bibliography>',
              "</cs:style>",
            ].join("\n"),
          ),
        );

        const style = yield* resolveInstalledStyle(library.dataDir, {
          styleId: APA,
          locale: "zh-CN",
        });

        expect(installedXml(style)).toContain("<cs:style xmlns:cs=");
        expect(installedXml(style)).toContain('default-locale="zh-CN"');
        expect(installedXml(style)).not.toContain('default-locale="en-US"');
      }),
  );

  effectIt.live("names a style by the identity its encoded ID stands for", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      const ID = "http://example.com/styles?a=1&b=2";
      yield* Effect.promise(() =>
        library.writeCsl(
          "encoded.csl",
          [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
            "  <info>",
            "    <title>Encoded</title>",
            "    <id>http://example.com/styles?a=1&amp;b=2</id>",
            "  </info>",
            '  <bibliography><layout><text value="encoded"/></layout></bibliography>',
            "</style>",
          ].join("\n"),
        ),
      );

      expect(yield* listed(library.dataDir)).toEqual([
        { id: ID, title: "Encoded" },
      ]);
      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: ID }),
      ).toMatchObject({ kind: "installed", styleId: ID });
    }),
  );

  effectIt.live(
    "renders an explicit Citation Locale over every style's own",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature-neuroscience.csl", {
            id: NATURE_NEUROSCIENCE,
            parentId: NATURE,
            defaultLocale: "de-DE",
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, defaultLocale: "en-US" }),
        );

        const dependent = installedXml(
          yield* resolveInstalledStyle(library.dataDir, {
            styleId: NATURE_NEUROSCIENCE,
            locale: "fr-FR",
          }),
        );
        expect(dependent).toContain('default-locale="fr-FR"');
        expect(dependent).not.toContain("de-DE");

        const independent = installedXml(
          yield* resolveInstalledStyle(library.dataDir, {
            styleId: APA,
            locale: "fr-FR",
          }),
        );
        expect(independent).toContain('default-locale="fr-FR"');
        expect(independent).not.toContain("en-US");
      }),
  );

  effectIt.live("keeps Default and every unusable selection distinct", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("orphan.csl", {
          id: "http://www.zotero.org/styles/orphan",
          title: "Orphan",
          parentId: "http://www.zotero.org/styles/uninstalled",
        }),
      );
      // A parent that depends on a style of its own is one level too deep.
      yield* Effect.promise(() =>
        library.writeStyle("grandchild.csl", {
          id: "http://www.zotero.org/styles/grandchild",
          parentId: "http://www.zotero.org/styles/orphan",
        }),
      );

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: null }),
      ).toEqual({ kind: "default" });
      // Default renders in the Citation Locale a request names of its own.
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: null,
          locale: "de-DE",
        }),
      ).toEqual({ kind: "default", locale: "de-DE" });
      // Style file removed or renamed since it was selected.
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: "http://www.zotero.org/styles/removed",
        }),
      ).toEqual({
        kind: "failed",
        styleId: "http://www.zotero.org/styles/removed",
        reason: "style-missing",
      });
      // A missing parent keeps the provenance a diagnostic reports.
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: "http://www.zotero.org/styles/orphan",
        }),
      ).toEqual({
        kind: "failed",
        styleId: "http://www.zotero.org/styles/orphan",
        parentId: "http://www.zotero.org/styles/uninstalled",
        reason: "parent-missing",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: "http://www.zotero.org/styles/grandchild",
        }),
      ).toEqual({
        kind: "failed",
        styleId: "http://www.zotero.org/styles/grandchild",
        parentId: "http://www.zotero.org/styles/orphan",
        reason: "invalid",
      });
    }),
  );

  effectIt.live("reports a style whose file stops being readable", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", { id: APA, title: "APA" }),
      );
      // Discovery reads the file; the content read then finds it out of reach.
      allowedReads = 1;

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "unreadable",
      });
    }),
  );

  effectIt.live("reports a style whose file stays out of reach", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", { id: APA, title: "APA" }),
      );
      deniedReads.add("apa.csl");

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "unreadable",
      });
    }),
  );

  effectIt.live("reports an independent parent that stays out of reach", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature-neuroscience.csl", {
          id: NATURE_NEUROSCIENCE,
          parentId: NATURE,
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
      );
      deniedReads.add("nature.csl");

      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        }),
      ).toEqual({
        kind: "failed",
        styleId: NATURE_NEUROSCIENCE,
        parentId: NATURE,
        reason: "unreadable",
      });
    }),
  );

  effectIt.live("reports a styles directory that refuses to be listed", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", { id: APA, title: "APA" }),
      );
      // A directory that lists nothing hides every style installed in it, which
      // is a file to repair rather than a style to install.
      deniedDirs.add("styles");

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "unreadable",
      });
    }),
  );

  effectIt.live("reports a hidden directory that refuses to be listed", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature-neuroscience.csl", {
          id: NATURE_NEUROSCIENCE,
          parentId: NATURE,
        }),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
      );
      deniedDirs.add("hidden");

      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        }),
      ).toEqual({
        kind: "failed",
        styleId: NATURE_NEUROSCIENCE,
        parentId: NATURE,
        reason: "unreadable",
      });
    }),
  );

  effectIt.live("reports content that is no CSL style", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeCsl("apa.csl", `<info><id>${APA}</id></info>`),
      );
      // A dependent style is a style element of its own, whatever its parent says.
      yield* Effect.promise(() =>
        library.writeCsl(
          "dependent.csl",
          `<info><id>${NATURE_NEUROSCIENCE}</id><link href="${NATURE}" rel="independent-parent"/></info>`,
        ),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
      );
      // A style element that renders nothing is no style to format with.
      yield* Effect.promise(() =>
        library.writeCsl(
          "ieee.csl",
          `<style version="1.0"><info><id>${IEEE}</id></info></style>`,
        ),
      );

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "invalid",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        }),
      ).toEqual({
        kind: "failed",
        styleId: NATURE_NEUROSCIENCE,
        parentId: NATURE,
        reason: "invalid",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: IEEE }),
      ).toEqual({
        kind: "failed",
        styleId: IEEE,
        reason: "invalid",
      });
    }),
  );

  effectIt.live("reports a rendering element that formats nothing", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      // Well-formed XML rooted in a style element, carrying the bibliography and
      // the citation that CSL requires a layout in. Such a style formats nothing
      // at all, so it is a file to repair rather than content citeproc is handed.
      yield* Effect.promise(() =>
        library.writeCsl(
          "apa.csl",
          `<style version="1.0"><info><id>${APA}</id></info><bibliography/></style>`,
        ),
      );
      yield* Effect.promise(() =>
        library.writeCsl(
          "nature.csl",
          `<style version="1.0"><info><id>${NATURE}</id></info><citation><sort><key variable="author"/></sort></citation></style>`,
        ),
      );

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "invalid",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: NATURE }),
      ).toEqual({
        kind: "failed",
        styleId: NATURE,
        reason: "invalid",
      });
    }),
  );

  effectIt.live("reports CSL a processor cannot read", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      // The citation element is left open. Such a style would otherwise reach
      // citeproc and fail the render, instead of naming the file to repair.
      yield* Effect.promise(() =>
        library.writeCsl(
          "apa.csl",
          `<style version="1.0"><info><id>${APA}</id></info><citation><layout/></style>`,
        ),
      );
      // The bibliography closes as an element it never opened.
      yield* Effect.promise(() =>
        library.writeCsl(
          "ieee.csl",
          `<style version="1.0"><info><id>${IEEE}</id></info><bibliography><layout/></citation></style>`,
        ),
      );
      // A dependent style answers for its own markup: its parent stands in for
      // the formatting it leaves out, never for markup it holds broken.
      yield* Effect.promise(() =>
        library.writeCsl(
          "nature-neuroscience.csl",
          `<style version="1.0"><info><id>${NATURE_NEUROSCIENCE}</id><link href="${NATURE}" rel="independent-parent"/></info><layout/></citation></style>`,
        ),
      );
      yield* Effect.promise(() =>
        library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
      );

      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: APA }),
      ).toEqual({
        kind: "failed",
        styleId: APA,
        reason: "invalid",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, { styleId: IEEE }),
      ).toEqual({
        kind: "failed",
        styleId: IEEE,
        reason: "invalid",
      });
      expect(
        yield* resolveInstalledStyle(library.dataDir, {
          styleId: NATURE_NEUROSCIENCE,
        }),
      ).toEqual({
        kind: "failed",
        styleId: NATURE_NEUROSCIENCE,
        parentId: NATURE,
        reason: "invalid",
      });
    }),
  );
});

describe("styleHasEntryMarkers", () => {
  it("finds a bibliography that separates its second field", () => {
    expect(
      styleHasEntryMarkers(`
        <style>
          <bibliography hanging-indent="true" second-field-align="flush">
            <layout />
          </bibliography>
        </style>
      `),
    ).toBe(true);
  });

  it("finds no Entry Markers in an inline bibliography or default style", () => {
    expect(
      styleHasEntryMarkers(
        "<style><bibliography><layout /></bibliography></style>",
      ),
    ).toBe(false);
    expect(styleHasEntryMarkers(undefined)).toBe(false);
  });
});

describe("InstalledStyleCache", () => {
  const APA = "http://www.zotero.org/styles/apa";
  const IEEE = "http://www.zotero.org/styles/ieee";

  /** A whole-second timestamp, which every filesystem stores exactly. */
  const PINNED = 1_700_000_000;

  effectIt.live(
    "answers for changed content whatever timestamp the edit left",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        const path = library.pathOf("apa.csl");
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, title: "APA" }),
        );
        yield* Effect.promise(() => utimes(path, PINNED, PINNED));

        const styles = new InstalledStyleCache();
        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining("<title>APA</title>"),
        });

        // A style edited in place under the timestamp the read already ran
        // against is still the style the next resolution answers with.
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, title: "APA Revised" }),
        );
        yield* Effect.promise(() => utimes(path, PINNED, PINNED));
        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining("<title>APA Revised</title>"),
        });
      }),
  );

  effectIt.live(
    "re-reads when the dependent style behind a held parent changes",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        const NATURE = "http://www.zotero.org/styles/nature";
        const DEPENDENT = "http://www.zotero.org/styles/nature-neuroscience";
        const dependentPath = library.pathOf("nature-neuroscience.csl");
        const parentPath = library.pathOf("nature.csl", { hidden: true });
        yield* Effect.promise(() =>
          library.writeStyle("nature-neuroscience.csl", {
            id: DEPENDENT,
            parentId: NATURE,
            defaultLocale: "de-DE",
          }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("nature.csl", { id: NATURE, hidden: true }),
        );
        yield* Effect.promise(() => utimes(dependentPath, PINNED, PINNED));
        yield* Effect.promise(() => utimes(parentPath, PINNED, PINNED));

        const styles = new InstalledStyleCache();
        expect(
          yield* styles.resolve(library.dataDir, { styleId: DEPENDENT }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining('default-locale="de-DE"'),
        });

        yield* Effect.promise(() =>
          library.writeStyle("nature-neuroscience.csl", {
            id: DEPENDENT,
            parentId: NATURE,
            defaultLocale: "fr-FR",
          }),
        );
        yield* Effect.promise(() =>
          utimes(dependentPath, PINNED + 1, PINNED + 1),
        );
        expect(
          yield* styles.resolve(library.dataDir, { styleId: DEPENDENT }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining('default-locale="fr-FR"'),
        });
      }),
  );

  effectIt.live("applies a Citation Locale to the style it already holds", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireDisposable(
        Effect.promise(() => installStyles()),
      );
      yield* Effect.promise(() =>
        library.writeStyle("apa.csl", { id: APA, title: "APA" }),
      );
      const styles = new InstalledStyleCache();

      yield* styles.resolve(library.dataDir, { styleId: APA });
      expect(
        yield* styles.resolve(library.dataDir, {
          styleId: APA,
          locale: "zh-CN",
        }),
      ).toMatchObject({
        kind: "installed",
        xml: expect.stringContaining('default-locale="zh-CN"'),
      });
    }),
  );

  effectIt.live(
    "reads the style the setting names, and re-reads on a change of style",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, title: "APA" }),
        );
        yield* Effect.promise(() =>
          library.writeStyle("ieee.csl", { id: IEEE, title: "IEEE" }),
        );
        const styles = new InstalledStyleCache();

        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining(`<id>${APA}</id>`),
        });
        expect(
          yield* styles.resolve(library.dataDir, { styleId: IEEE }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining(`<id>${IEEE}</id>`),
        });
        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining(`<id>${APA}</id>`),
        });
      }),
  );

  effectIt.live(
    "keeps Default and an unavailable style distinct without holding either",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );
        const styles = new InstalledStyleCache();

        expect(
          yield* styles.resolve(library.dataDir, { styleId: null }),
        ).toEqual({ kind: "default" });
        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toEqual({
          kind: "failed",
          styleId: APA,
          reason: "style-missing",
        });

        // A style installed after the miss is still found.
        yield* Effect.promise(() =>
          library.writeStyle("apa.csl", { id: APA, title: "APA" }),
        );
        expect(
          yield* styles.resolve(library.dataDir, { styleId: APA }),
        ).toMatchObject({
          kind: "installed",
          xml: expect.stringContaining(`<id>${APA}</id>`),
        });
      }),
  );
});
