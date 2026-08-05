import { pathToFileURL } from "node:url";
import { TFile } from "obsidian";

import { type TemplateLink } from "@zotlit/db";

/**
 * Build a {@link TemplateLink} to an absolute on-disk path as a `file://` URL.
 * Rendered with no override it shows `defaultAlias` and `defaultSubpath`; pass
 * `alias` / `subpath` to override either.
 */
export function fileUrlLink(
  absPath: string,
  defaultAlias: string,
  defaultSubpath = "",
): TemplateLink {
  const href = pathToFileURL(absPath).href;
  return (alias = defaultAlias, subpath = defaultSubpath) =>
    `[${alias}](${href}${subpath})`;
}

/**
 * Builds a shaped {@link TFile} stand-in so {@link FileManager.generateMarkdownLink}
 * can link an attachment that has not been created (and thus indexed) yet.
 *
 * Given `TFile.prototype` (rather than constructed) so it passes `instanceof TFile`,
 * while only populating the `path`/`name`/`basename`/`extension` fields Obsidian reads.
 *
 * @param filePath - Vault-relative path of the link target.
 * @returns A `TFile` instance carrying only the four fields Obsidian reads.
 */
export function syntheticFile(filePath: string): TFile {
  const slash = filePath.lastIndexOf("/");
  const name = slash === -1 ? filePath : filePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && dot < name.length - 1;
  // Building the synthetic TFile itself; `instanceof TFile` narrowing
  // doesn't apply here.
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path: filePath,
    name,
    basename: hasExt ? name.slice(0, dot) : name,
    extension: hasExt ? name.slice(dot + 1).toLowerCase() : "",
  });
}
