import { regex } from "arkregex";
import { basename, join } from "node:path/posix";

import annotationEta from "@zotlit/templates/defaults/annotation.eta?raw";
import annotation from "@zotlit/templates/defaults/annotation.liquid?raw";
import citeEta from "@zotlit/templates/defaults/cite.eta?raw";
import cite from "@zotlit/templates/defaults/cite.liquid?raw";
import cite2Eta from "@zotlit/templates/defaults/cite2.eta?raw";
import cite2 from "@zotlit/templates/defaults/cite2.liquid?raw";
import contentEta from "@zotlit/templates/defaults/content.eta?raw";
import content from "@zotlit/templates/defaults/content.liquid?raw";
import filenameEta from "@zotlit/templates/defaults/filename.eta?raw";
import filename from "@zotlit/templates/defaults/filename.liquid?raw";
import noteEta from "@zotlit/templates/defaults/note.eta?raw";
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

/** Template whose render output is wrapped in managed-region markers. */
export const MANAGED_CONTENT_TEMPLATE = "content" as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Array order is the row order rendered in the setting tab's template-files list. */
export const TEMPLATE_NAMES = [
  "filename",
  "note",
  "annotation",
  MANAGED_CONTENT_TEMPLATE,
  "cite",
  "cite2",
] as const;

/** Vault-global slots after Literature Note Template conversion. */
export const GLOBAL_TEMPLATE_NAMES = [
  "cite",
  "cite2",
] as const satisfies readonly TemplateName[];

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  filename,
  note,
  annotation,
  content,
  cite,
  cite2,
};

/** Eta editions of the embedded defaults, byte-parity with {@link DEFAULT_TEMPLATES}; used when a Template row switches to Eta. */
export const DEFAULT_TEMPLATES_ETA: Record<TemplateName, string> = {
  filename: filenameEta,
  note: noteEta,
  annotation: annotationEta,
  content: contentEta,
  cite: citeEta,
  cite2: cite2Eta,
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

/** Vault path of the Shared Partial named `name` inside `folder`. */
export function partialPath(folder: string, name: string): string {
  const file = `zotlit-partial.${name}.md`;
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

/**
 * What a file in the template folder is, by its filename alone.
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
  if (legacy && isTemplateName(legacy.groups.name)) {
    return {
      kind: "legacy-slot",
      name: legacy.groups.name,
      language: legacy.groups.language,
    };
  }
  return { kind: "unrecognized" };
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}
