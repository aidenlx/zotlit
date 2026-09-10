// Which Template Document the view holds, read from the filename alone.

import type { TFile } from "obsidian";

import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";

import { classifyTemplateFolderFile } from "@/services/template/defaults";

/**
 * The kind the Template Workbench View opens `file` as. The built-in Default
 * Profile draft carries no file, and every kind the classifier does not name a
 * Citation Template — a Profile document, a Shared Partial, a file the reader
 * opened from outside the template folder — opens with the Profile tabs.
 */
export function templateDocumentKind(
  file: TFile | null,
): WorkbenchDocumentKind {
  return classifyTemplateFolderFile(file?.path ?? "")?.kind === "citation"
    ? "citation"
    : "profile";
}
