// The path a note takes when it moves to another Profile's folder.
import type { TFile } from "obsidian";

import { joinFolderPath, normalizeFolderPath } from "@/lib/ensure-folder";
import type { ResolvedProfile } from "@/services/profile/bindings";

/**
 * Replace the folder part of a note's path and keep the remainder, so the
 * subfolders that came from the note name stay. The remainder is the path
 * relative to the source Profile's folder when the note is inside it, else the
 * file name; `from` is undefined for a note with an unresolved Profile stamp.
 */
export function relocatedNotePath(
  file: Pick<TFile, "path" | "name">,
  options: {
    from: ResolvedProfile | undefined;
    to: ResolvedProfile;
    imported: boolean;
  },
): string {
  const key = options.imported
    ? "note.import-folder"
    : "note.literature-folder";
  const sourceFolder =
    options.from && normalizeFolderPath(options.from.bindings[key]);
  const remainder =
    sourceFolder === "/"
      ? file.path
      : sourceFolder && file.path.startsWith(`${sourceFolder}/`)
        ? file.path.slice(sourceFolder.length + 1)
        : file.name;
  return joinFolderPath(
    normalizeFolderPath(options.to.bindings[key]),
    remainder,
  );
}
