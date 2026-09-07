// Fixture CSL discovery and dependent-style resolution from Zotero data.

import { regex } from "arkregex";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  InstalledCitationStyle,
  SelectedCitationStyleRequest,
  SelectedCitationStyleResponse,
} from "@zotlit/workbench/bridge";

const CSL_EXT = ".csl";
const PREFIX = "(?:[^\\s/<>=:]+:)?";
const INFO_BLOCK = regex(
  `<${PREFIX}info(?=[\\s>])[^>]*>(?<info>[\\s\\S]*?)</${PREFIX}info\\s*>`,
);
const ID = regex(`<${PREFIX}id(?=[\\s>])[^>]*>(?<id>[^<]*)</${PREFIX}id\\s*>`);
const TITLE = regex(
  `<${PREFIX}title(?=[\\s>])[^>]*>(?<title>[^<]*)</${PREFIX}title\\s*>`,
);
const LINK_TAG = regex(`<${PREFIX}link(?=[\\s/>])[^>]*>`, "g");
const HREF = regex("href\\s*=\\s*[\"'](?<href>[^\"']*)[\"']");
const REL = regex("rel\\s*=\\s*[\"'](?<rel>[^\"']*)[\"']");
const STYLE_ROOT = regex(`<(?<name>${PREFIX}style)(?=[\\s/>])[^>]*>`);
const DEFAULT_LOCALE = regex(
  "default-locale\\s*=\\s*[\"'](?<locale>[^\"']*)[\"']",
);
const DEFAULT_LOCALE_ATTR = regex(
  "\\s*default-locale\\s*=\\s*[\"'][^\"']*[\"']",
);
const RENDERING_ELEMENT = regex(
  `<${PREFIX}(?:citation|bibliography)(?=[\\s>])`,
);
const LAYOUT_ELEMENT = regex(`<${PREFIX}layout(?=[\\s/>])`);

interface FixtureStyleFile extends InstalledCitationStyle {
  readonly path: string;
  readonly parentId?: string;
  readonly defaultLocale?: string;
}

interface StyleDirectory {
  readonly files: FixtureStyleFile[];
  readonly unreadable: boolean;
}

export async function listFixtureCitationStyles(
  dataDir: string,
): Promise<InstalledCitationStyle[]> {
  const root = join(dataDir, "styles");
  const visible = indexById((await readStyleDirectory(root)).files);
  const hidden = await readStyleDirectory(join(root, "hidden"));
  const all = indexById([...visible.values(), ...hidden.files]);
  return [...visible.values()]
    .filter(({ parentId }) => parentId === undefined || all.has(parentId))
    .map(({ id, title }) => ({ id, title }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export async function resolveFixtureCitationStyle(
  dataDir: string,
  request: SelectedCitationStyleRequest,
): Promise<SelectedCitationStyleResponse> {
  if (request.styleId === null) {
    return {
      kind: "default",
      ...(request.locale ? { locale: request.locale } : {}),
    };
  }

  const root = join(dataDir, "styles");
  const [visible, hidden] = await Promise.all([
    readStyleDirectory(root),
    readStyleDirectory(join(root, "hidden")),
  ]);
  const styles = indexById([...visible.files, ...hidden.files]);
  const requested = styles.get(request.styleId);
  if (requested === undefined) {
    return {
      kind: "failed",
      styleId: request.styleId,
      reason:
        visible.unreadable || hidden.unreadable
          ? "unreadable"
          : "style-missing",
    };
  }
  const independent =
    requested.parentId === undefined
      ? requested
      : styles.get(requested.parentId);
  if (independent === undefined) {
    return {
      kind: "failed",
      styleId: request.styleId,
      parentId: requested.parentId,
      reason:
        visible.unreadable || hidden.unreadable
          ? "unreadable"
          : "parent-missing",
    };
  }
  if (independent.parentId !== undefined) {
    return {
      kind: "failed",
      styleId: request.styleId,
      parentId: requested.parentId,
      reason: "invalid",
    };
  }

  const [requestedXml, independentXml] = await Promise.all([
    readOptionalStyle(requested.path),
    requested.path === independent.path
      ? readOptionalStyle(requested.path)
      : readOptionalStyle(independent.path),
  ]);
  if (requestedXml === undefined || independentXml === undefined) {
    return {
      kind: "failed",
      styleId: request.styleId,
      ...(requested.parentId ? { parentId: requested.parentId } : {}),
      reason: "unreadable",
    };
  }
  if (!isCslStyle(requestedXml) || !isStandaloneCslStyle(independentXml)) {
    return {
      kind: "failed",
      styleId: request.styleId,
      ...(requested.parentId ? { parentId: requested.parentId } : {}),
      reason: "invalid",
    };
  }

  const locale = request.locale ?? requested.defaultLocale;
  return {
    kind: "installed",
    styleId: request.styleId,
    ...(requested.parentId ? { parentId: requested.parentId } : {}),
    ...(locale ? { locale } : {}),
    xml: withDefaultLocale(independentXml, locale ?? undefined),
  };
}

async function readStyleDirectory(dir: string): Promise<StyleDirectory> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    return isErrno(error, "ENOENT")
      ? { files: [], unreadable: false }
      : { files: [], unreadable: true };
  }
  const contents = await Promise.all(
    names
      .filter((name) => name.endsWith(CSL_EXT))
      .map(async (name) => {
        const path = join(dir, name);
        return { path, xml: await readOptionalStyle(path) };
      }),
  );
  const files: FixtureStyleFile[] = [];
  let unreadable = false;
  for (const { path, xml } of contents) {
    if (xml === undefined) {
      unreadable = true;
      continue;
    }
    const style = styleFileOf(path, xml);
    if (style === undefined) unreadable = true;
    else files.push(style);
  }
  return { files, unreadable };
}

function styleFileOf(path: string, xml: string): FixtureStyleFile | undefined {
  const info = INFO_BLOCK.exec(xml)?.groups.info;
  const id = info && ID.exec(info)?.groups.id.trim();
  if (!info || !id || !isCslStyle(xml)) return undefined;
  const title = TITLE.exec(info)?.groups.title.trim();
  return {
    id: decodeXmlText(id),
    title: title ? decodeXmlText(title) : basename(path, CSL_EXT),
    path,
    parentId: parentIdOf(info),
    defaultLocale: defaultLocaleOf(xml),
  };
}

function parentIdOf(info: string): string | undefined {
  for (const tag of info.match(LINK_TAG) ?? []) {
    if (REL.exec(tag)?.groups.rel !== "independent-parent") continue;
    const href = HREF.exec(tag)?.groups.href;
    return href === undefined ? undefined : decodeXmlText(href);
  }
}

function defaultLocaleOf(xml: string): string | undefined {
  const root = STYLE_ROOT.exec(xml)?.[0];
  const locale = root && DEFAULT_LOCALE.exec(root)?.groups.locale.trim();
  return locale ? decodeXmlText(locale) : undefined;
}

function isCslStyle(xml: string): boolean {
  return STYLE_ROOT.test(xml);
}

function isStandaloneCslStyle(xml: string): boolean {
  return (
    isCslStyle(xml) && RENDERING_ELEMENT.test(xml) && LAYOUT_ELEMENT.test(xml)
  );
}

function withDefaultLocale(xml: string, locale: string | undefined): string {
  if (locale === undefined) return xml;
  const root = STYLE_ROOT.exec(xml);
  if (!root) return xml;
  const tag = root[0];
  const { name } = root.groups;
  const selfClosing = tag.endsWith("/>");
  const attributes = tag
    .slice(`<${name}`.length, selfClosing ? -2 : -1)
    .replace(DEFAULT_LOCALE_ATTR, "")
    .trimEnd();
  const replacement = `<${name}${attributes} default-locale="${encodeXmlText(locale)}"${selfClosing ? "/>" : ">"}`;
  return (
    xml.slice(0, root.index) + replacement + xml.slice(root.index + tag.length)
  );
}

function indexById(
  files: readonly FixtureStyleFile[],
): Map<string, FixtureStyleFile> {
  const styles = new Map<string, FixtureStyleFile>();
  for (const file of files) {
    if (!styles.has(file.id)) styles.set(file.id, file);
  }
  return styles;
}

async function readOptionalStyle(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlText(text: string): string {
  return text.replaceAll(
    regex("&(?:amp|lt|gt|quot|apos);", "g"),
    (entity) => XML_ENTITIES[entity] ?? entity,
  );
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function encodeXmlText(text: string): string {
  return text.replaceAll(
    regex('[&<>"]', "g"),
    (character) => XML_ESCAPES[character] ?? character,
  );
}
