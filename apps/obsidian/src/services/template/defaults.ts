import { join } from "node:path/posix";

import zAnnot from "./defaults/zt-annot.eta.md?raw";
import zCite from "./defaults/zt-cite.eta.md?raw";
import zCite2 from "./defaults/zt-cite2.eta.md?raw";
import zContent from "./defaults/zt-content.eta.md?raw";
import zNote from "./defaults/zt-note.eta.md?raw";
import { normalizeVaultPath } from "./path";

export const CANONICAL_NAMES = [
  "note",
  "annotation",
  "content",
  "cite",
  "cite2",
] as const;

export type TemplateName = (typeof CANONICAL_NAMES)[number];

const canonicalNameSet: ReadonlySet<string> = new Set(CANONICAL_NAMES);

export const EMBEDDED_DEFAULTS: Record<TemplateName, string> = {
  note: zNote,
  annotation: zAnnot,
  content: zContent,
  cite: zCite,
  cite2: zCite2,
};

export function toFilename(name: string): string | null {
  if (name === "annotation") return "zt-annot.eta.md";
  if (canonicalNameSet.has(name)) return `zt-${name}.eta.md`;
  return null;
}

/**
 * Default Eta expression used as the literature-note filename stem.
 * @see {@link https://eta.js.org} for template syntax.
 */
export const DEFAULT_NOTE_FILENAME =
  "<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %>";

/**
 * Default frontmatter fields injected into every literature note.
 * Each entry maps a YAML key to a JS expression evaluated over `zt`.
 */
export const DEFAULT_FRONTMATTER_FIELDS: ReadonlyArray<{
  readonly key: string;
  readonly expr: string;
}> = Object.freeze([Object.freeze({ key: "title", expr: "zt.title" })]);

export function fromFilename(
  filepath: string,
  folder: string,
): TemplateName | null {
  const normalizedPath = normalizeVaultPath(filepath);
  const normalizedFolder = normalizeVaultPath(folder);

  for (const name of CANONICAL_NAMES) {
    if (join(normalizedFolder, toFilename(name)!) === normalizedPath) {
      return name;
    }
  }
  return null;
}
