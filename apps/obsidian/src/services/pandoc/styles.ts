// Discovery of the CSL styles Zotero installed in its data directory.

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

/** One installed style, as the References style picker lists it. */
export interface InstalledCslStyle {
  /** `<info><id>` — the identity the References style setting stores. */
  id: string;
  /** `<info><title>`, or the filename stem when the style declares none. */
  title: string;
}

interface StyleFile extends InstalledCslStyle {
  path: string;
  /** Style ID of the independent parent, when this is a dependent style. */
  parentId: string | undefined;
}

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
  const styles = indexById(await readStyleDir(join(dataDir, STYLES_DIR)));
  return [...styles.values()]
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The CSL XML that renders `styleId`, with a dependent style resolved to its
 * independent parent.
 *
 * @returns `undefined` when the setting is unset, or when neither the selected
 * style nor its parent is installed — the engine then renders with its embedded
 * default style.
 */
export async function loadStyleXml(
  dataDir: string,
  styleId: string | null,
): Promise<string | undefined> {
  if (!styleId) return undefined;
  const file = await resolveStyleFile(dataDir, styleId);
  if (!file) return undefined;
  return readStyleXml(file.path);
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

/**
 * The installed style file whose XML renders `styleId`, with a dependent style
 * resolved to its independent parent.
 */
async function resolveStyleFile(
  dataDir: string,
  styleId: string,
): Promise<StyleFile | undefined> {
  const root = join(dataDir, STYLES_DIR);
  const styles = indexById([
    ...(await readStyleDir(root)),
    ...(await readStyleDir(join(root, HIDDEN_DIR))),
  ]);

  const selected = styles.get(styleId);
  if (!selected) {
    logger.debug("Selected CSL style is not installed", { styleId, dataDir });
    return undefined;
  }
  const independent = selected.parentId
    ? styles.get(selected.parentId)
    : selected;
  if (!independent) {
    logger.debug(
      "Independent parent of the selected CSL style is not installed",
      {
        styleId,
        parentId: selected.parentId,
      },
    );
    return undefined;
  }
  return independent;
}

/** A held style file, and what a later load checks it against. */
interface HeldStyle {
  dataDir: string;
  styleId: string;
  /** Path of the independent style file the XML was read from. */
  path: string;
  /** mtime the read ran against, in epoch milliseconds. */
  mtime: number;
  xml: string;
}

/**
 * The selected style's XML, held in memory across loads.
 *
 * Resolving a style ID reads every installed `.csl` file, which is far more
 * than a render that only needs the XML should pay for. The held copy stands
 * for as long as its file's mtime is the one it was read at, so a repeat load
 * costs one `stat` and a style edited in place is still picked up.
 */
export class StyleXmlCache {
  #held: HeldStyle | undefined;

  /** Same answer as {@link loadStyleXml}, from the held copy where it stands. */
  async load(
    dataDir: string,
    styleId: string | null,
  ): Promise<string | undefined> {
    if (!styleId) return undefined;

    const held = this.#held;
    if (held && held.dataDir === dataDir && held.styleId === styleId) {
      if ((await mtimeOf(held.path)) === held.mtime) {
        logger.trace("CSL style cache hit", { styleId });
        return held.xml;
      }
    }
    this.#held = undefined;

    const file = await resolveStyleFile(dataDir, styleId);
    if (!file) return undefined;
    // Read the mtime first: a file written between the read and its stat would
    // otherwise be held under an mtime it no longer has, and never re-read.
    const mtime = await mtimeOf(file.path);
    const xml = await readStyleXml(file.path);
    if (xml === undefined) return undefined;
    if (mtime !== undefined) {
      this.#held = { dataDir, styleId, path: file.path, mtime, xml };
    }
    logger.debug("CSL style loaded", { styleId, path: file.path });
    return xml;
  }
}

/** `undefined` for a file the host cannot stat, which holds nothing. */
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

async function readStyleDir(dir: string): Promise<StyleFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      logger.warn("Cannot read the Zotero styles directory", { dir, error });
    }
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(CSL_EXT))
      .map((name) => readStyleFile(join(dir, name))),
  );
  return files.filter((file) => file !== undefined);
}

async function readStyleFile(path: string): Promise<StyleFile | undefined> {
  const xml = await readStyleXml(path);
  if (xml === undefined) return undefined;

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

function parentIdOf(info: string): string | undefined {
  for (const tag of info.match(LINK_TAG) ?? []) {
    if (REL.exec(tag)?.groups.rel === "independent-parent") {
      return HREF.exec(tag)?.groups.href;
    }
  }
  return undefined;
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
