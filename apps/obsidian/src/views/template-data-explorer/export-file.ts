// Export rebuilds the selected contract root through the native loader so its
// request remains reproducible and device image handling stays with that loader.
import type { TemplateRoot } from "@zotlit/workbench/ui";

import { exportTimestamp, saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { loadTemplateData } from "@/services/template-workbench/data";
import type {
  TemplateDataDeps,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";

import { buildTemplateDataExport } from "./export";

const logger = getLogger(["views", "template-data-explorer"]);
export interface TemplateDataExportTarget {
  indexedKey: string;
  root: TemplateRoot;
}
export async function exportTemplateDataFile(
  deps: TemplateDataDeps,
  target: TemplateDataExportTarget & { pluginVersion: string },
): Promise<void> {
  try {
    saveTemplateDataExport(
      await loadTemplateData(deps, target.indexedKey, target.root),
      target,
    );
  } catch (error) {
    failTemplateDataExport(target, error);
  }
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
