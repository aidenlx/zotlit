import { join } from "node:path/posix";

import zAnnot from "./defaults/zt-annot.eta.md?raw";
import zAnnots from "./defaults/zt-annots.eta.md?raw";
import zCite from "./defaults/zt-cite.eta.md?raw";
import zCite2 from "./defaults/zt-cite2.eta.md?raw";
import zColored from "./defaults/zt-colored.eta.md?raw";
import zField from "./defaults/zt-field.eta.md?raw";
import zNote from "./defaults/zt-note.eta.md?raw";
import { normalizeVaultPath } from "./path";

export const CANONICAL_NAMES = [
  "note",
  "field",
  "annotation",
  "annots",
  "cite",
  "cite2",
  "colored",
] as const;

export type TemplateName = (typeof CANONICAL_NAMES)[number];

const canonicalNameSet: ReadonlySet<string> = new Set(CANONICAL_NAMES);

export const EMBEDDED_DEFAULTS: Record<TemplateName, string> = {
  note: zNote,
  field: zField,
  annotation: zAnnot,
  annots: zAnnots,
  cite: zCite,
  cite2: zCite2,
  colored: zColored,
};

export function toFilename(name: string): string | null {
  if (name === "annotation") return "zt-annot.eta.md";
  if (canonicalNameSet.has(name)) return `zt-${name}.eta.md`;
  return null;
}

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
