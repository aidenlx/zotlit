import { regex } from "arkregex";
import { basename, join } from "node:path/posix";

import annotation from "@zotlit/templates/defaults/annotation?raw";
import cite from "@zotlit/templates/defaults/cite?raw";
import cite2 from "@zotlit/templates/defaults/cite2?raw";
import content from "@zotlit/templates/defaults/content?raw";
import note from "@zotlit/templates/defaults/note?raw";
import { type FrontmatterField } from "@zotlit/templates/frontmatter";

export const DEFAULT_NOTE_FILENAME =
  "<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %><%= suffix() %>";

export const DEFAULT_FRONTMATTER_FIELDS = Object.freeze([
  Object.freeze({ key: "title", expr: "zt.title", merge: "replace" }),
  Object.freeze({
    key: "related",
    expr: "zt.relatedItems.map((item) => item.noteLink()).filter(Boolean)",
    merge: "replace",
  }),
  Object.freeze({
    key: "collections",
    expr: 'zt.collections.map((c) => c.path.join("/"))',
    merge: "replace",
  }),
]) satisfies readonly FrontmatterField[];

import { normalizeVaultPath } from "./path";

const TEMPLATE_FILE = regex("^zotlit-(?<name>[A-Za-z0-9-]+)\\.eta\\.md$");

/** Template whose render output is wrapped in managed-region markers. */
export const MANAGED_CONTENT_TEMPLATE = "content" as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const TEMPLATE_NAMES = [
  "note",
  "annotation",
  MANAGED_CONTENT_TEMPLATE,
  "cite",
  "cite2",
] as const;

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  note,
  annotation,
  content,
  cite,
  cite2,
};

function templateFilename(name: TemplateName): string {
  return `zotlit-${name}.eta.md`;
}

export function templatePath(folder: string, name: TemplateName): string {
  const file = templateFilename(name);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

/** Extract the `<name>` from a `zotlit-<name>.eta.md` vault path; `null` if it doesn't match. */
export function templateNameFromPath(path: string): string | null {
  const filename = basename(normalizeVaultPath(path));
  return TEMPLATE_FILE.exec(filename)?.groups.name ?? null;
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}
