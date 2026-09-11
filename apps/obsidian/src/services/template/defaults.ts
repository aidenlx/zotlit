import { regex } from "arkregex";
import { basename, join } from "node:path/posix";

import annotation from "@zotlit/templates/defaults/annotation.liquid?raw";
import citation from "@zotlit/templates/defaults/citation.liquid?raw";
import content from "@zotlit/templates/defaults/content.liquid?raw";
import filename from "@zotlit/templates/defaults/filename.liquid?raw";
import note from "@zotlit/templates/defaults/note.liquid?raw";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { normalizeVaultPath } from "./path";

function freezeAll<const T extends readonly object[]>(items: T): Readonly<T> {
  items.forEach(Object.freeze);
  return Object.freeze(items);
}

export const DEFAULT_FRONTMATTER_FIELDS = freezeAll([
  { key: "title", expr: "zt.title", merge: "replace", language: "liquid" },
  {
    key: "related",
    expr: "zt.relatedItems | note_links",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "collections",
    expr: "zt.collections | collection_paths",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "citekey",
    expr: "zt.citationKey",
    merge: "replace",
    language: "liquid",
  },
]) satisfies readonly FrontmatterField[];

const TEMPLATE_FILE = regex(
  "^zotlit-(?<name>[A-Za-z0-9-]+)\\.(?<language>liquid|eta)\\.md$",
);

const PARTIAL_FILE = regex("^zotlit-partial\\.(?<name>[A-Za-z0-9-]+)\\.md$");

/** Every Template Document filename starts with it; so does an unrecognized file. */
const TEMPLATE_DOCUMENT_PREFIX = "zotlit-";

/** A Profile document is `zotlit-profile.<slug>.md`; the slug is never read. */
const PROFILE_DOCUMENT_PREFIX = "zotlit-profile.";

/** The Citation Template is exactly one file. */
const CITATION_DOCUMENT_FILENAME = "zotlit-citation.md";

/**
 * The name the Citation Template registers under, so every host renders it —
 * and bundles it for the web Workbench — by one name.
 */
export const CITATION_TEMPLATE_NAME = "citation" as const;

/**
 * The Citation Template ZotLit renders while the vault holds no
 * `zotlit-citation.md`, and the source the settings row materializes that file
 * from. It maps the `alt` Citation Variant to an Author-in-text Citation and
 * every other variant to a bracketed one, which is what the 2.1.x `cite2` and
 * `cite` files rendered.
 */
export const CITATION_TEMPLATE_SOURCE = citation;

/** Template whose render output is wrapped in managed-region markers. */
export const MANAGED_CONTENT_TEMPLATE = "content" as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Array order is the row order rendered in the setting tab's template-files list. */
export const TEMPLATE_NAMES = [
  "filename",
  "note",
  "annotation",
  MANAGED_CONTENT_TEMPLATE,
] as const;

/**
 * The 2.1.x citation slots, in the order they fold into the Citation
 * Template: `cite` answered the main gesture and `cite2` the alternate one.
 */
export const LEGACY_CITATION_NAMES = ["cite", "cite2"] as const;

export type LegacyCitationName = (typeof LEGACY_CITATION_NAMES)[number];

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  filename,
  note,
  annotation,
  content,
};

function templateFilename(name: string, language: TemplateLanguage): string {
  return `zotlit-${name}.${language}.md`;
}

export function templatePath(
  folder: string,
  name: string,
  language: TemplateLanguage = "liquid",
): string {
  const file = templateFilename(name, language);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

/** Extract the `<name>` and `<language>` from a `zotlit-<name>.(liquid|eta).md` vault path; `null` if it doesn't match. */
export function templateFileFromPath(
  path: string,
): { name: string; language: TemplateLanguage } | null {
  const match = TEMPLATE_FILE.exec(basename(normalizeVaultPath(path)));
  if (!match) return null;
  return { name: match.groups.name, language: match.groups.language };
}

/** Vault path of the Citation Template inside `folder`. */
export function citationPath(folder: string): string {
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === ""
    ? CITATION_DOCUMENT_FILENAME
    : join(normalizedFolder, CITATION_DOCUMENT_FILENAME);
}

/** The file a Shared Partial named `name` lives in. */
export function partialFilename(name: string): string {
  return `zotlit-partial.${name}.md`;
}

/**
 * Names a Shared Partial cannot claim: the Citation Template answers to
 * `citation`, and each Legacy Template File slot answers to its own name —
 * `annotation` among them, which a Profile's Annotation Section also renders
 * under.
 *
 * The template facade is one namespace, so a partial registered under a slot
 * name replaces that slot's compiled template: a `zotlit-partial.filename.md`
 * would name every new Literature Note.
 */
export const RESERVED_PARTIAL_NAME_LIST: readonly string[] = [
  ...TEMPLATE_NAMES,
  CITATION_TEMPLATE_NAME,
];

/** {@link RESERVED_PARTIAL_NAME_LIST} as a membership test. */
export const RESERVED_PARTIAL_NAMES: ReadonlySet<string> = new Set<string>(
  RESERVED_PARTIAL_NAME_LIST,
);

const PARTIAL_NAME = /^[A-Za-z0-9-]+$/;
const PARTIAL_NAME_SPACES = /\s+/g;

/**
 * Whether `name` has the shape a Shared Partial file carries: letters, digits,
 * and hyphens. {@link partialNameRefusal} is the whole rule; an entry point
 * that reports the reserved and duplicate halves itself asks only this.
 */
export function isPartialNameShape(name: string): boolean {
  return PARTIAL_NAME.test(name);
}

/** Why a name cannot be given to a Shared Partial; `null` accepts it. */
export type PartialNameRefusal =
  | "empty"
  | "characters"
  | "reserved"
  | "duplicate";

/**
 * Fold what the reader typed into a Shared Partial name: trim it, join the
 * words with hyphens, and lowercase it, so "Venue line" reaches the vault as
 * `venue-line`.
 */
export function normalizePartialName(input: string): string {
  return input.trim().replace(PARTIAL_NAME_SPACES, "-").toLowerCase();
}

/**
 * Judge one {@link normalizePartialName} result against the rule every entry
 * point shares: letters, digits, and hyphens, free of the reserved names, and
 * unique among `taken`.
 *
 * `taken` is compared without case: the rule admits uppercase, so a hand-made
 * `zotlit-partial.Authors.md` takes `authors` too — a case-insensitive
 * filesystem holds one file for both, and the reader gets the duplicate
 * message rather than a failed write.
 */
export function partialNameRefusal(
  name: string,
  taken: Iterable<string>,
): PartialNameRefusal | null {
  if (name === "") return "empty";
  if (!isPartialNameShape(name)) return "characters";
  if (RESERVED_PARTIAL_NAMES.has(name)) return "reserved";
  const folded = name.toLowerCase();
  return [...taken].some((used) => used.toLowerCase() === folded)
    ? "duplicate"
    : null;
}

/** Vault path of the Shared Partial named `name` inside `folder`. */
export function partialPath(folder: string, name: string): string {
  const file = partialFilename(name);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

/**
 * What a file in the template folder is, by its filename alone.
 *
 * `"legacy-citation"` and `"legacy-partial"` are the remaining 2.1.x
 * `zotlit-<name>.(liquid|eta).md` shapes the one-shot conversion folds: the
 * two citation slots, and every other bare name, which 2.1.x registered as a
 * partial.
 *
 * `"unrecognized"` is a `zotlit-` prefixed Markdown file that is none of the
 * three Template Document kinds and no Legacy Template File: ZotLit reports it
 * once in settings rather than guessing at it.
 */
export type TemplateFolderFile =
  | { kind: "profile"; reference: string }
  | { kind: "citation" }
  | { kind: "partial"; name: string }
  | { kind: "legacy-slot"; name: TemplateName; language: TemplateLanguage }
  | {
      kind: "legacy-citation";
      name: LegacyCitationName;
      language: TemplateLanguage;
    }
  | { kind: "legacy-partial"; name: string; language: TemplateLanguage }
  | { kind: "unrecognized" };

/**
 * Classify one file of the template folder by its filename prefix.
 *
 * @returns `null` for a file ZotLit ignores: anything that is not a
 *   `zotlit-` prefixed Markdown file.
 */
export function classifyTemplateFolderFile(
  path: string,
): TemplateFolderFile | null {
  const filename = basename(normalizeVaultPath(path));
  if (!filename.startsWith(TEMPLATE_DOCUMENT_PREFIX)) return null;
  if (!filename.endsWith(".md")) return null;

  if (filename.startsWith(PROFILE_DOCUMENT_PREFIX)) {
    return { kind: "profile", reference: filename };
  }
  if (filename === CITATION_DOCUMENT_FILENAME) return { kind: "citation" };

  const partial = PARTIAL_FILE.exec(filename);
  if (partial) return { kind: "partial", name: partial.groups.name };

  const legacy = TEMPLATE_FILE.exec(filename);
  if (legacy) {
    const { name, language } = legacy.groups;
    if (isTemplateName(name)) return { kind: "legacy-slot", name, language };
    if (isLegacyCitationName(name)) {
      return { kind: "legacy-citation", name, language };
    }
    // `zotlit-citation.liquid.md` names the Citation Template, which is
    // `zotlit-citation.md`; a partial may not claim that name either.
    if (name !== CITATION_TEMPLATE_NAME) {
      return { kind: "legacy-partial", name, language };
    }
  }
  return { kind: "unrecognized" };
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function isLegacyCitationName(name: string): name is LegacyCitationName {
  return (LEGACY_CITATION_NAMES as readonly string[]).includes(name);
}
