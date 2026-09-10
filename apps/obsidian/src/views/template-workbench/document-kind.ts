// Which Template Document the view holds, read from the filename alone.

import type { TFile } from "obsidian";

import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";

import { classifyTemplateFolderFile } from "@/services/template/defaults";

/**
 * The kind the Template Workbench View opens `file` as. Every kind the
 * classifier names neither the Citation Template nor a Shared Partial — a
 * Profile document, a file the reader opened from outside the template folder,
 * and the built-in Default Profile draft, which carries no file at all — opens
 * with the Profile tabs.
 */
export function templateDocumentKind(
  file: TFile | null,
): WorkbenchDocumentKind {
  const kind = classifyTemplateFolderFile(file?.path ?? "")?.kind;
  return kind === "citation" || kind === "partial" ? kind : "profile";
}

/**
 * The name the Shared Partial at `path` answers to, which the tab title carries
 * and every render fault is reported against.
 *
 * @returns null when `path` names no Shared Partial.
 */
export function templatePartialName(path: string): string | null {
  const classified = classifyTemplateFolderFile(path);
  return classified?.kind === "partial" ? classified.name : null;
}
