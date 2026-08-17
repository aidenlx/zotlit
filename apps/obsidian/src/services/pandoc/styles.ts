// Discovery of the CSL styles Zotero installed, and the Resolved CSL Style each selection renders with.

import { regex } from "arkregex";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";

const logger = getLogger(["pandoc", "styles"]);

/**
 * Zotero installs styles in `styles/`, and keeps the independent parents that
 * only dependent styles need in `styles/hidden/`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/style.js#L94-L155
 */
const STYLES_DIR = "styles";
const HIDDEN_DIR = "hidden";
const CSL_EXT = ".csl";

/** One installed style, as the Citation and References Style picker lists it. */
export interface InstalledCslStyle {
  /** `<info><id>` — the identity the Citation and References Style setting stores. */
  id: string;
  /** `<info><title>`, or the filename stem when the style declares none. */
  title: string;
}

interface StyleFile extends InstalledCslStyle {
  path: string;
  /** Style ID of the independent parent, when this is a dependent style. */
  parentId: string | undefined;
  /**
   * The `default-locale` this style declares. A dependent style carries its own,
   * which is the one thing it may say that its independent parent does not.
   */
  defaultLocale: string | undefined;
  /** The content encloses one `cs:style` element, which every CSL style is. */
  isStyleElement: boolean;
}

/** The style and Citation Locale one render asks the resolver for. */
export interface CslStyleRequest {
  /**
   * Installed CSL ID to render with, or `null` for the engine's embedded
   * default style.
   */
  styleId: string | null;
  /**
   * Citation Locale to render in. It overrides the resolved style's own default
   * locale; `null` or omitted leaves the style's locale in charge.
   */
  locale?: string | null;
}

/**
 * Why one requested style produced no Resolved CSL Style. Each arm names a
 * different repair: install the style, install its parent, restore access to
 * the file, or replace its content.
 */
export type CslStyleFailure =
  /** Zotero has no installed style carrying the requested CSL ID. */
  | "style-missing"
  /** The requested style is dependent, and its independent parent is not installed. */
  | "parent-missing"
  /** A CSL file the requested style is read from refuses to be read. */
  | "unreadable"
  /** The content behind the requested style is not a standalone CSL style. */
  | "invalid";

/**
 * The Resolved CSL Style of one request, keeping Default, an installed style,
 * and each way a selection fails distinct.
 */
export type ResolvedCslStyle =
  | {
      kind: "default";
      /**
       * Citation Locale the request named, which the embedded default style
       * renders in; `undefined` leaves that style's own locale in charge.
       */
      locale: string | undefined;
    }
  | {
      kind: "installed";
      /** The CSL ID that was requested, whichever file the content came from. */
      styleId: string;
      /** CSL ID of the independent parent, when the requested style is dependent. */
      parentId: string | undefined;
      /**
       * Standalone CSL: the independent style's formatting under the effective
       * Citation Locale.
       */
      xml: string;
    }
  | {
      kind: "failed";
      /** The CSL ID that was requested. */
      styleId: string;
      /**
       * CSL ID of the independent parent the requested style names, as far as
       * the failure knows it. It keeps the provenance a diagnostic reports.
       */
      parentId: string | undefined;
      reason: CslStyleFailure;
    };

/**
 * The styles a user can select, sorted by title. Zotero owns installation, so
 * an install ZotLit cannot read simply offers nothing to select.
 *
 * Hidden styles stay out of the list: Zotero keeps them as independent parents
 * of dependent styles, not as choices of their own.
 */
export async function listInstalledStyles(
  dataDir: string,
): Promise<InstalledCslStyle[]> {
  const root = join(dataDir, STYLES_DIR);
  const visible = indexById((await readStyleDir(root)).files);
  const all = indexById([
    ...visible.values(),
    ...(await readStyleDir(join(root, HIDDEN_DIR))).files,
  ]);
  return [...visible.values()]
    .filter(({ parentId }) => parentId === undefined || all.has(parentId))
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The Resolved CSL Style of one request, with nothing held between calls. The
 * app's own resolver is {@link InstalledStyleCache}, which answers the same way
 * from the style it already read.
 */
export function resolveInstalledStyle(
  dataDir: string,
  request: CslStyleRequest,
): Promise<ResolvedCslStyle> {
  return new InstalledStyleCache().resolve(dataDir, request);
}

/**
 * CSL processors create a left-margin field when `second-field-align` is set;
 * the citation engine exposes that field as the Entry Marker.
 */
export function styleHasEntryMarkers(styleXml: string | undefined): boolean {
  return (
    styleXml !== undefined && BIBLIOGRAPHY_WITH_ENTRY_MARKERS.test(styleXml)
  );
}

/** One resolution's identity and content, before a Citation Locale applies. */
interface StyleContent {
  styleId: string;
  parentId: string | undefined;
  /** `default-locale` of the requested style, which outlives its parent's. */
  defaultLocale: string | undefined;
  /** The independent style's content, as installed. */
  xml: string;
}

/** A resolved style held in memory, and what a later resolution checks it against. */
interface HeldStyle extends StyleContent {
  dataDir: string;
  /** Files the content was read from, and the mtimes it was read at. */
  stamps: readonly FileStamp[];
}

interface FileStamp {
  path: string;
  /** mtime the read ran against, in epoch milliseconds. */
  mtime: number;
}

/**
 * The one installed-style resolver: in-app rendering and the built-in export
 * both read a Resolved CSL Style through it, so a dependent style cannot render
 * one way in Obsidian and another in an export.
 *
 * Resolving a style ID reads every installed `.csl` file, which is far more
 * than a render that only needs the content should pay for. The held copy
 * stands for as long as its files carry the mtimes they were read at, so a
 * repeat resolution costs one `stat` per file and a style edited in place is
 * still picked up.
 */
export class InstalledStyleCache {
  #held: HeldStyle | undefined;

  /** @returns the Resolved CSL Style, from the held copy where it stands. */
  async resolve(
    dataDir: string,
    { styleId, locale }: CslStyleRequest,
  ): Promise<ResolvedCslStyle> {
    if (!styleId) return { kind: "default", locale: locale ?? undefined };

    const held = this.#held;
    if (held && held.dataDir === dataDir && held.styleId === styleId) {
      if (await stampsStand(held.stamps)) {
        logger.trace("CSL style cache hit", { styleId });
        return resolved(held, locale);
      }
    }
    this.#held = undefined;

    const located = await locateStyle(dataDir, styleId);
    if ("reason" in located) {
      return {
        kind: "failed",
        styleId,
        parentId: located.parentId,
        reason: located.reason,
      };
    }
    const { requested, independent } = located;
    const failed = (reason: CslStyleFailure): ResolvedCslStyle => ({
      kind: "failed",
      styleId,
      parentId: requested.parentId,
      reason,
    });

    // Every CSL file encloses one `cs:style` element, a dependent style as much
    // as the independent style it points at, so the requested file answers for
    // its own content before a parent's formatting stands in for it.
    if (!requested.isStyleElement) {
      logger.warn("The installed CSL style encloses no style element", {
        styleId,
        path: requested.path,
      });
      return failed("invalid");
    }

    // Read the mtimes first: a file written between the read and its stat would
    // otherwise be held under an mtime it no longer has, and never re-read.
    const stamps = await stampFiles([requested.path, independent.path]);
    const xml = await readStyleXml(independent.path);
    if (xml === undefined) return failed("unreadable");
    if (!isStandaloneCslStyle(xml)) {
      logger.warn("The installed CSL style renders nothing on its own", {
        styleId,
        path: independent.path,
      });
      return failed("invalid");
    }

    const content: StyleContent = {
      styleId,
      parentId: requested.parentId,
      defaultLocale: requested.defaultLocale,
      xml,
    };
    if (stamps) this.#held = { ...content, dataDir, stamps };
    logger.debug("CSL style resolved", {
      styleId,
      parentId: requested.parentId,
      path: independent.path,
    });
    return resolved(content, locale);
  }
}

/**
 * The requested style's own Citation Locale survives resolution to its parent:
 * that override is the only thing a dependent style adds to the style it
 * depends on.
 */
function resolved(
  content: StyleContent,
  locale: string | null | undefined,
): ResolvedCslStyle {
  return {
    kind: "installed",
    styleId: content.styleId,
    parentId: content.parentId,
    xml: withDefaultLocale(content.xml, locale ?? content.defaultLocale),
  };
}

/** The requested style and the independent style whose formatting it renders with. */
interface StyleSources {
  requested: StyleFile;
  independent: StyleFile;
}

/** Why a lookup found no style to render with, with the provenance it knows. */
interface StyleLookupFailure {
  reason: CslStyleFailure;
  /** CSL ID of the independent parent the requested style names, when it names one. */
  parentId?: string | undefined;
}

async function locateStyle(
  dataDir: string,
  styleId: string,
): Promise<StyleSources | StyleLookupFailure> {
  const root = join(dataDir, STYLES_DIR);
  const [visible, hidden] = await Promise.all([
    readStyleDir(root),
    readStyleDir(join(root, HIDDEN_DIR)),
  ]);
  const styles = indexById([...visible.files, ...hidden.files]);
  // A file discovery could not read may be the very style the lookup wants, so
  // it stands in front of every answer that the install is short a style.
  const unreadable = visible.unreadable || hidden.unreadable;

  const requested = styles.get(styleId);
  if (!requested) {
    if (unreadable) {
      logger.warn("A CSL style file the request may name refuses to be read", {
        styleId,
        dataDir,
      });
      return { reason: "unreadable" };
    }
    logger.debug("The requested CSL style is not installed", {
      styleId,
      dataDir,
    });
    return { reason: "style-missing" };
  }
  if (requested.parentId === undefined) {
    return { requested, independent: requested };
  }

  const { parentId } = requested;
  const independent = styles.get(parentId);
  if (!independent) {
    if (unreadable) {
      logger.warn("The independent parent of a CSL style refuses to be read", {
        styleId,
        parentId,
      });
      return { reason: "unreadable", parentId };
    }
    logger.debug("The independent parent of a CSL style is not installed", {
      styleId,
      parentId,
    });
    return { reason: "parent-missing", parentId };
  }
  // CSL allows one level of dependency, so a parent that depends on a style of
  // its own leaves nothing to render with.
  if (independent.parentId !== undefined) {
    logger.warn("The independent parent of a CSL style is itself dependent", {
      styleId,
      parentId,
    });
    return { reason: "invalid", parentId };
  }
  return { requested, independent };
}

/** `undefined` when any file cannot be stat'd, which holds nothing. */
async function stampFiles(
  paths: readonly string[],
): Promise<FileStamp[] | undefined> {
  const stamps = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const mtime = await mtimeOf(path);
      return mtime === undefined ? undefined : { path, mtime };
    }),
  );
  return stamps.every((stamp) => stamp !== undefined) ? stamps : undefined;
}

async function stampsStand(stamps: readonly FileStamp[]): Promise<boolean> {
  const current = await Promise.all(stamps.map(({ path }) => mtimeOf(path)));
  return stamps.every((stamp, index) => stamp.mtime === current[index]);
}

async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    logger.warn("Cannot read the timestamp of a CSL style file", {
      path,
      error,
    });
    return undefined;
  }
}

/** First file wins, so a visible style shadows a hidden one with the same ID. */
function indexById(files: readonly StyleFile[]): Map<string, StyleFile> {
  const styles = new Map<string, StyleFile>();
  for (const file of files) {
    if (!styles.has(file.id)) styles.set(file.id, file);
  }
  return styles;
}

/** What one styles directory holds, and whether any of it stayed out of reach. */
interface StyleDirectory {
  files: StyleFile[];
  /**
   * Whether content the lookup may need refused to be read — a `.csl` file, or
   * the directory listing every `.csl` file behind it. Either may hold any
   * style, so a lookup that misses reports a file to repair rather than a
   * missing install.
   */
  unreadable: boolean;
}

async function readStyleDir(dir: string): Promise<StyleDirectory> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    // A directory that is absent holds no style at all; one that refuses to be
    // read may hold every style the lookup is short of.
    if (isErrno(error, "ENOENT")) return { files: [], unreadable: false };
    logger.warn("Cannot read the Zotero styles directory", { dir, error });
    return { files: [], unreadable: true };
  }
  const contents = await Promise.all(
    names
      .filter((name) => name.endsWith(CSL_EXT))
      .map(async (name) => {
        const path = join(dir, name);
        return { path, xml: await readStyleXml(path) };
      }),
  );
  const files: StyleFile[] = [];
  let unreadable = false;
  for (const { path, xml } of contents) {
    if (xml === undefined) {
      unreadable = true;
      continue;
    }
    const file = styleFileOf(path, xml);
    if (file) files.push(file);
  }
  return { files, unreadable };
}

function styleFileOf(path: string, xml: string): StyleFile | undefined {
  const info = INFO_BLOCK.exec(xml)?.groups.info;
  const id = info && ID.exec(info)?.groups.id.trim();
  if (!info || !id) {
    logger.warn("Skipped a CSL file that declares no style ID", { path });
    return undefined;
  }
  const title = TITLE.exec(info)?.groups.title.trim();
  return {
    id,
    title: title ? decodeXmlText(title) : basename(path, CSL_EXT),
    path,
    parentId: parentIdOf(info),
    defaultLocale: defaultLocaleOf(xml),
    isStyleElement: isStyleElement(xml),
  };
}

async function readStyleXml(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    logger.warn("Cannot read a CSL style file", { path, error });
    return undefined;
  }
}

const INFO_BLOCK = regex("<info>(?<info>[\\s\\S]*?)</info>");
const ID = regex("<id>(?<id>[^<]*)</id>");
const TITLE = regex("<title>(?<title>[^<]*)</title>");
const BIBLIOGRAPHY_WITH_ENTRY_MARKERS =
  /<bibliography\b[^>]*\bsecond-field-align\s*=/;
const LINK_TAG = /<link\b[^>]*>/g;
const HREF = regex('href="(?<href>[^"]*)"');
const REL = regex('rel="(?<rel>[^"]*)"');
/**
 * The root element every standalone CSL style opens with. The lookahead keeps
 * `<style-options>`, which a locale block carries, out of the match.
 */
const STYLE_ROOT = /<style(?=[\s/>])[^>]*>/;
const STYLE_CLOSE = "</style>";
/** The root element name of every CSL style, whichever prefix it carries. */
const STYLE_ELEMENT = "style";
/** The elements a processor formats with; a standalone style declares one. */
const RENDERING_ELEMENTS = new Set(["citation", "bibliography"]);
/** How an XML parser reports content it cannot read: as an element of its own. */
const PARSER_ERROR = "parsererror";
const DEFAULT_LOCALE = regex('default-locale="(?<locale>[^"]*)"');
const DEFAULT_LOCALE_ATTR = /\s*default-locale="[^"]*"/;

/**
 * Content that encloses one `cs:style` element, which every CSL file is —
 * a dependent style as much as the independent style it points at.
 *
 * Discovery runs this over every installed `.csl` file, so it stays a scan of
 * the text. The one file a render formats with is read as XML instead, by
 * {@link isStandaloneCslStyle}.
 */
function isStyleElement(xml: string): boolean {
  const root = STYLE_ROOT.exec(xml);
  return (
    root !== null && xml.includes(STYLE_CLOSE, root.index + root[0].length)
  );
}

/**
 * Content a processor renders with on its own: well-formed XML rooted in a
 * `cs:style` element that holds the citation or bibliography it formats. A
 * dependent style declares neither of those, which is why it renders through
 * its independent parent.
 *
 * The whole document is read, so markup a processor would choke on — an
 * element left open, one closed as another — is answered here as a file to
 * repair, rather than reaching citeproc and failing the render.
 */
function isStandaloneCslStyle(xml: string): boolean {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  // A parser that cannot read the content reports the failure inside the
  // document it hands back, as its root or beside the part it did read.
  if (parsed.getElementsByTagName(PARSER_ERROR).length > 0) return false;
  const root = parsed.documentElement;
  if (root.localName !== STYLE_ELEMENT) return false;
  return [...root.children].some((child) =>
    RENDERING_ELEMENTS.has(child.localName),
  );
}

function parentIdOf(info: string): string | undefined {
  for (const tag of info.match(LINK_TAG) ?? []) {
    if (REL.exec(tag)?.groups.rel === "independent-parent") {
      return HREF.exec(tag)?.groups.href;
    }
  }
  return undefined;
}

function defaultLocaleOf(xml: string): string | undefined {
  const root = STYLE_ROOT.exec(xml)?.[0];
  const locale = root && DEFAULT_LOCALE.exec(root)?.groups.locale.trim();
  return locale ? decodeXmlText(locale) : undefined;
}

/**
 * The same style under `locale`, which the effective Citation Locale supplies
 * and a processor reads as the style's own default.
 *
 * @returns `xml` unchanged when no locale applies.
 */
function withDefaultLocale(xml: string, locale: string | undefined): string {
  if (locale === undefined) return xml;
  const root = STYLE_ROOT.exec(xml);
  if (!root) return xml;

  const tag = root[0];
  const selfClosing = tag.endsWith("/>");
  const attributes = tag
    .slice("<style".length, selfClosing ? -2 : -1)
    .replace(DEFAULT_LOCALE_ATTR, "")
    .trimEnd();
  const replacement = `<style${attributes} default-locale="${encodeXmlText(locale)}"${
    selfClosing ? "/>" : ">"
  }`;
  return (
    xml.slice(0, root.index) + replacement + xml.slice(root.index + tag.length)
  );
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** Titles reach the picker as text, so the predefined XML entities decode. */
function decodeXmlText(text: string): string {
  return text.replaceAll(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => XML_ENTITIES[entity] ?? entity,
  );
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** A locale reaches the style as an attribute value, so its markup escapes. */
function encodeXmlText(text: string): string {
  return text.replaceAll(/[&<>"]/g, (char) => XML_ESCAPES[char] ?? char);
}
