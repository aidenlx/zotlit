import { regex } from "arkregex";
import { basename, join } from "node:path/posix";

import annotation from "@zotlit/templates/defaults/annotation?raw";
import cite from "@zotlit/templates/defaults/cite?raw";
import cite2 from "@zotlit/templates/defaults/cite2?raw";
import content from "@zotlit/templates/defaults/content?raw";
import filename from "@zotlit/templates/defaults/filename?raw";
import note from "@zotlit/templates/defaults/note?raw";
import { type TemplateLanguage } from "@zotlit/templates/facade";
import { type FrontmatterField } from "@zotlit/templates/frontmatter";

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
]) satisfies readonly FrontmatterField[];

const TEMPLATE_FILE = regex(
  "^zotlit-(?<name>[A-Za-z0-9-]+)\\.(?<language>liquid|eta)\\.md$",
);

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

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  filename,
  note,
  annotation,
  content,
  cite,
  cite2,
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
  const filename = basename(normalizeVaultPath(path));
  const match = TEMPLATE_FILE.exec(filename);
  if (!match) return null;
  return { name: match.groups.name, language: match.groups.language };
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}
