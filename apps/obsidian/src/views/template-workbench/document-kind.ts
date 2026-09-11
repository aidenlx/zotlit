// Which Template Document the view holds, read from the filename — and only
// inside the template folder, which is where the scan reads one.

import type { TFile } from "obsidian";

import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";

import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import {
  classifyTemplateFolderFile,
  inTemplateFolder,
} from "@/services/template/defaults";

/** The template folder the classifier reads within, as the service reads it. */
export function templateFolderOf(
  settings: Pick<SettingsService, "current">,
): string {
  return settings.current?.["template.folder"] ?? defaults["template.folder"];
}

/**
 * The kind the Template Workbench View opens `file` as. Every kind the
 * classifier names neither the Citation Template nor a Shared Partial — a
 * Profile document, a file the reader opened from outside the template folder,
 * and the built-in Default Profile draft, which carries no file at all — opens
 * with the Profile tabs.
 *
 * The same `zotlit-partial.<name>.md` filename elsewhere in the vault is a
 * note ZotLit registers nothing for, so it opens with the Profile tabs rather
 * than as a partial whose own editor would preview a template nothing calls.
 */
export function templateDocumentKind(
  file: TFile | null,
  folder: string,
): WorkbenchDocumentKind {
  const path = file?.path ?? "";
  if (!inTemplateFolder(path, folder)) return "profile";
  const kind = classifyTemplateFolderFile(path)?.kind;
  return kind === "citation" || kind === "partial" ? kind : "profile";
}

/**
 * The name the Shared Partial at `path` answers to, which the tab title carries
 * and every render fault is reported against.
 *
 * @returns null when `path` names no Shared Partial of `folder`.
 */
export function templatePartialName(
  path: string,
  folder: string,
): string | null {
  if (!inTemplateFolder(path, folder)) return null;
  const classified = classifyTemplateFolderFile(path);
  return classified?.kind === "partial" ? classified.name : null;
}
