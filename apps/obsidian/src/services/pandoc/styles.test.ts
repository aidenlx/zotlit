import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  InstalledStyleCache,
  listInstalledStyles,
  resolveInstalledStyle,
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

function denied(): Error {
  return Object.assign(new Error("permission denied"), { code: "EACCES" });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const [path] = args;
      if (typeof path === "string" && deniedDirs.has(basename(path))) {
        throw denied();
      }
      return actual.readdir(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const [path] = args;
      if (
        allowedReads <= 0 ||
        (typeof path === "string" && deniedReads.has(basename(path)))
      ) {
        throw denied();
      }
      allowedReads -= 1;
      return actual.readFile(...args);
    },
  };
});

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
  it("lists visible styles by style ID, sorted by title", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", {
      id: "http://www.zotero.org/styles/apa",
      title: "APA Style 7th edition",
    });
    // Filename and style ID disagree: the ID is the identity that matters.
    await library.writeStyle("renamed.csl", {
      id: "http://www.zotero.org/styles/chicago-author-date",
      title: "Chicago Manual of Style 18th edition (author-date)",
    });
    await library.writeStyle("notes.txt", { id: "not-a-style" });

    await expect(listInstalledStyles(library.dataDir)).resolves.toEqual([
      {
        id: "http://www.zotero.org/styles/apa",
        title: "APA Style 7th edition",
      },
      {
        id: "http://www.zotero.org/styles/chicago-author-date",
        title: "Chicago Manual of Style 18th edition (author-date)",
      },
    ]);
  });

  it("omits hidden styles, which serve only as independent parents", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature.csl", {
      id: "http://www.zotero.org/styles/nature",
      title: "Nature",
      hidden: true,
    });
    await library.writeStyle("apa.csl", {
      id: "http://www.zotero.org/styles/apa",
      title: "APA",
    });

    await expect(listInstalledStyles(library.dataDir)).resolves.toEqual([
      { id: "http://www.zotero.org/styles/apa", title: "APA" },
    ]);
  });

  it("omits a dependent style whose independent parent is unavailable", async () => {
    await using library = await installStyles();
    await library.writeStyle("orphan.csl", {
      id: "http://www.zotero.org/styles/orphan",
      title: "Orphan",
      parentId: "http://www.zotero.org/styles/uninstalled",
    });

    await expect(listInstalledStyles(library.dataDir)).resolves.toEqual([]);
  });

  it("decodes entities in a title and falls back to the filename", async () => {
    await using library = await installStyles();
    await library.writeStyle("ampersand.csl", {
      id: "http://www.zotero.org/styles/ampersand",
      title: "Alcohol &amp; Drug Education",
    });
    await library.writeStyle("untitled.csl", {
      id: "http://www.zotero.org/styles/untitled",
    });

    await expect(listInstalledStyles(library.dataDir)).resolves.toEqual([
      {
        id: "http://www.zotero.org/styles/ampersand",
        title: "Alcohol & Drug Education",
      },
      { id: "http://www.zotero.org/styles/untitled", title: "untitled" },
    ]);
  });

  it("lists nothing when Zotero installed no styles", async () => {
    await using library = await installStyles();

    await expect(listInstalledStyles(library.dataDir)).resolves.toEqual([]);
  });
});

describe("resolveInstalledStyle", () => {
  const APA = "http://www.zotero.org/styles/apa";
  const IEEE = "http://www.zotero.org/styles/ieee";
  const NATURE = "http://www.zotero.org/styles/nature";
  const NATURE_NEUROSCIENCE =
    "http://www.zotero.org/styles/nature-neuroscience";

  it("resolves an independent style to its own content", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      styleId: APA,
      parentId: undefined,
      xml: expect.stringContaining(`<id>${APA}</id>`),
    });
  });

  it("keeps a dependent style's identity, provenance, and default locale", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature-neuroscience.csl", {
      id: NATURE_NEUROSCIENCE,
      title: "Nature Neuroscience",
      parentId: NATURE,
      defaultLocale: "de-DE",
    });
    await library.writeStyle("nature.csl", {
      id: NATURE,
      title: "Nature",
      hidden: true,
    });

    const style = await resolveInstalledStyle(library.dataDir, {
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
  });

  it("leaves a dependent style that declares no locale to its parent's", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature-neuroscience.csl", {
      id: NATURE_NEUROSCIENCE,
      title: "Nature Neuroscience",
      parentId: NATURE,
    });
    await library.writeStyle("nature.csl", {
      id: NATURE,
      title: "Nature",
      defaultLocale: "en-GB",
      hidden: true,
    });

    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: NATURE_NEUROSCIENCE,
      }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining('default-locale="en-GB"'),
    });
  });

  it("renders an explicit Citation Locale over every style's own", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature-neuroscience.csl", {
      id: NATURE_NEUROSCIENCE,
      parentId: NATURE,
      defaultLocale: "de-DE",
    });
    await library.writeStyle("nature.csl", { id: NATURE, hidden: true });
    await library.writeStyle("apa.csl", { id: APA, defaultLocale: "en-US" });

    const dependent = installedXml(
      await resolveInstalledStyle(library.dataDir, {
        styleId: NATURE_NEUROSCIENCE,
        locale: "fr-FR",
      }),
    );
    expect(dependent).toContain('default-locale="fr-FR"');
    expect(dependent).not.toContain("de-DE");

    const independent = installedXml(
      await resolveInstalledStyle(library.dataDir, {
        styleId: APA,
        locale: "fr-FR",
      }),
    );
    expect(independent).toContain('default-locale="fr-FR"');
    expect(independent).not.toContain("en-US");
  });

  it("keeps Default and every unusable selection distinct", async () => {
    await using library = await installStyles();
    await library.writeStyle("orphan.csl", {
      id: "http://www.zotero.org/styles/orphan",
      title: "Orphan",
      parentId: "http://www.zotero.org/styles/uninstalled",
    });
    // A parent that depends on a style of its own is one level too deep.
    await library.writeStyle("grandchild.csl", {
      id: "http://www.zotero.org/styles/grandchild",
      parentId: "http://www.zotero.org/styles/orphan",
    });

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: null }),
    ).resolves.toEqual({ kind: "default" });
    // Default renders in the Citation Locale a request names of its own.
    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: null,
        locale: "de-DE",
      }),
    ).resolves.toEqual({ kind: "default", locale: "de-DE" });
    // Style file removed or renamed since it was selected.
    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: "http://www.zotero.org/styles/removed",
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: "http://www.zotero.org/styles/removed",
      reason: "style-missing",
    });
    // A missing parent keeps the provenance a diagnostic reports.
    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: "http://www.zotero.org/styles/orphan",
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: "http://www.zotero.org/styles/orphan",
      parentId: "http://www.zotero.org/styles/uninstalled",
      reason: "parent-missing",
    });
    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: "http://www.zotero.org/styles/grandchild",
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: "http://www.zotero.org/styles/grandchild",
      parentId: "http://www.zotero.org/styles/orphan",
      reason: "invalid",
    });
  });

  it("reports a style whose file stops being readable", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    // Discovery reads the file; the content read then finds it out of reach.
    allowedReads = 1;

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "unreadable",
    });
  });

  it("reports a style whose file stays out of reach", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    deniedReads.add("apa.csl");

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "unreadable",
    });
  });

  it("reports an independent parent that stays out of reach", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature-neuroscience.csl", {
      id: NATURE_NEUROSCIENCE,
      parentId: NATURE,
    });
    await library.writeStyle("nature.csl", { id: NATURE, hidden: true });
    deniedReads.add("nature.csl");

    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: NATURE_NEUROSCIENCE,
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: NATURE_NEUROSCIENCE,
      parentId: NATURE,
      reason: "unreadable",
    });
  });

  it("reports a styles directory that refuses to be listed", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    // A directory that lists nothing hides every style installed in it, which
    // is a file to repair rather than a style to install.
    deniedDirs.add("styles");

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "unreadable",
    });
  });

  it("reports a hidden directory that refuses to be listed", async () => {
    await using library = await installStyles();
    await library.writeStyle("nature-neuroscience.csl", {
      id: NATURE_NEUROSCIENCE,
      parentId: NATURE,
    });
    await library.writeStyle("nature.csl", { id: NATURE, hidden: true });
    deniedDirs.add("hidden");

    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: NATURE_NEUROSCIENCE,
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: NATURE_NEUROSCIENCE,
      parentId: NATURE,
      reason: "unreadable",
    });
  });

  it("reports content that is no CSL style", async () => {
    await using library = await installStyles();
    await library.writeCsl("apa.csl", `<info><id>${APA}</id></info>`);
    // A dependent style is a style element of its own, whatever its parent says.
    await library.writeCsl(
      "dependent.csl",
      `<info><id>${NATURE_NEUROSCIENCE}</id><link href="${NATURE}" rel="independent-parent"/></info>`,
    );
    await library.writeStyle("nature.csl", { id: NATURE, hidden: true });
    // A style element that renders nothing is no style to format with.
    await library.writeCsl(
      "ieee.csl",
      `<style version="1.0"><info><id>${IEEE}</id></info></style>`,
    );

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "invalid",
    });
    await expect(
      resolveInstalledStyle(library.dataDir, {
        styleId: NATURE_NEUROSCIENCE,
      }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: NATURE_NEUROSCIENCE,
      parentId: NATURE,
      reason: "invalid",
    });
    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: IEEE }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: IEEE,
      reason: "invalid",
    });
  });

  it("reports CSL a processor cannot read", async () => {
    await using library = await installStyles();
    // The citation element is left open. Such a style would otherwise reach
    // citeproc and fail the render, instead of naming the file to repair.
    await library.writeCsl(
      "apa.csl",
      `<style version="1.0"><info><id>${APA}</id></info><citation><layout/></style>`,
    );
    // The bibliography closes as an element it never opened.
    await library.writeCsl(
      "ieee.csl",
      `<style version="1.0"><info><id>${IEEE}</id></info><bibliography><layout/></citation></style>`,
    );

    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "invalid",
    });
    await expect(
      resolveInstalledStyle(library.dataDir, { styleId: IEEE }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: IEEE,
      reason: "invalid",
    });
  });
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

  it("re-reads a style file only when its timestamp moves", async () => {
    await using library = await installStyles();
    const path = library.pathOf("apa.csl");
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    await utimes(path, PINNED, PINNED);

    const styles = new InstalledStyleCache();
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining("<title>APA</title>"),
    });

    // A body written under the timestamp the read already ran against is a
    // body no read looks at.
    await library.writeStyle("apa.csl", { id: APA, title: "APA Revised" });
    await utimes(path, PINNED, PINNED);
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining("<title>APA</title>"),
    });

    await utimes(path, PINNED + 1, PINNED + 1);
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining("<title>APA Revised</title>"),
    });
  });

  it("re-reads when the dependent style behind a held parent changes", async () => {
    await using library = await installStyles();
    const NATURE = "http://www.zotero.org/styles/nature";
    const DEPENDENT = "http://www.zotero.org/styles/nature-neuroscience";
    const dependentPath = library.pathOf("nature-neuroscience.csl");
    const parentPath = library.pathOf("nature.csl", { hidden: true });
    await library.writeStyle("nature-neuroscience.csl", {
      id: DEPENDENT,
      parentId: NATURE,
      defaultLocale: "de-DE",
    });
    await library.writeStyle("nature.csl", { id: NATURE, hidden: true });
    await utimes(dependentPath, PINNED, PINNED);
    await utimes(parentPath, PINNED, PINNED);

    const styles = new InstalledStyleCache();
    await expect(
      styles.resolve(library.dataDir, { styleId: DEPENDENT }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining('default-locale="de-DE"'),
    });

    await library.writeStyle("nature-neuroscience.csl", {
      id: DEPENDENT,
      parentId: NATURE,
      defaultLocale: "fr-FR",
    });
    await utimes(dependentPath, PINNED + 1, PINNED + 1);
    await expect(
      styles.resolve(library.dataDir, { styleId: DEPENDENT }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining('default-locale="fr-FR"'),
    });
  });

  it("applies a Citation Locale to the style it already holds", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    const styles = new InstalledStyleCache();

    await styles.resolve(library.dataDir, { styleId: APA });
    await expect(
      styles.resolve(library.dataDir, { styleId: APA, locale: "zh-CN" }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining('default-locale="zh-CN"'),
    });
  });

  it("reads the style the setting names, and re-reads on a change of style", async () => {
    await using library = await installStyles();
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    await library.writeStyle("ieee.csl", { id: IEEE, title: "IEEE" });
    const styles = new InstalledStyleCache();

    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining(`<id>${APA}</id>`),
    });
    await expect(
      styles.resolve(library.dataDir, { styleId: IEEE }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining(`<id>${IEEE}</id>`),
    });
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining(`<id>${APA}</id>`),
    });
  });

  it("keeps Default and an unavailable style distinct without holding either", async () => {
    await using library = await installStyles();
    const styles = new InstalledStyleCache();

    await expect(
      styles.resolve(library.dataDir, { styleId: null }),
    ).resolves.toEqual({ kind: "default" });
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toEqual({
      kind: "failed",
      styleId: APA,
      reason: "style-missing",
    });

    // A style installed after the miss is still found.
    await library.writeStyle("apa.csl", { id: APA, title: "APA" });
    await expect(
      styles.resolve(library.dataDir, { styleId: APA }),
    ).resolves.toMatchObject({
      kind: "installed",
      xml: expect.stringContaining(`<id>${APA}</id>`),
    });
  });
});
