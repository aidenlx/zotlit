// Export rebuilds the selected contract root through the native loader so its
// request remains reproducible and device image handling stays with that loader.
import type { TemplateRoot } from "@zotlit/workbench/ui";

import { exportTimestamp, saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { TemplateDataLoadResult } from "@/services/template-workbench/data";
import { getSampleItem } from "@/views/template-workbench/selection-data";

import { buildTemplateDataExport } from "./export";

const logger = getLogger(["views", "template-data-explorer"]);
export interface TemplateDataExportTarget {
  indexedKey: string;
  root: TemplateRoot;
}

/**
 * What an export of `root` saves: the chosen Item's root, or on the
 * Annotation root the shown annotation, `annotation`, with the paper's own
 * data standing in when no library annotation is shown. A Sample Item has
 * nothing to export.
 */
export function exportTarget(
  item: { readonly id: string } | null,
  root: TemplateRoot,
  annotation: string | null,
): TemplateDataExportTarget | null {
  if (!item || getSampleItem(item.id)) return null;
  if (root !== "annotation") return { indexedKey: item.id, root };
  return annotation
    ? { indexedKey: annotation, root }
    : { indexedKey: item.id, root: "note" };
}

/** Saves the export of one loaded root; a root with no data shows a notice. */
export function saveTemplateDataExport(
  result: TemplateDataLoadResult,
  {
    indexedKey,
    root,
    pluginVersion,
  }: TemplateDataExportTarget & { pluginVersion: string },
): void {
  if (result.kind !== "data") {
    logger.error("No template data to export for {indexedKey}: {reason}", {
      indexedKey,
      root,
      reason: result.kind,
    });
    new BaseNotice(m.template_data_explorer_export_failed());
    return;
  }
  const { filename, json } = buildTemplateDataExport({
    root: result.data,
    contractRoot: root,
    indexedKey,
    pluginVersion,
    timestamp: exportTimestamp(),
  });
  saveFile(new Blob([json], { type: "application/json" }), filename);
  logger.debug("Exported template data to {filename}", { filename, root });
}

/** Reports an export that failed with `error`. */
export function failTemplateDataExport(
  { indexedKey, root }: TemplateDataExportTarget,
  error: unknown,
): void {
  logger.error("Failed to export template data for {indexedKey}", {
    indexedKey,
    root,
    error,
  });
  new BaseNotice(m.template_data_explorer_export_failed());
}
