// Export rebuilds the selected contract root through the native loader so its
// request remains reproducible and device image handling stays with that loader.
import type { TemplateRoot } from "@zotlit/workbench/ui";

import { exportTimestamp, saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { TemplateDataDeps } from "@/services/template-workbench/data";

import { buildTemplateDataExport } from "./export";

const logger = getLogger(["views", "template-data-explorer"]);
export interface TemplateDataExportTarget {
  indexedKey: string;
  root: TemplateRoot;
}
export async function exportTemplateDataFile(
  deps: TemplateDataDeps,
  {
    indexedKey,
    root,
    pluginVersion,
  }: TemplateDataExportTarget & { pluginVersion: string },
): Promise<void> {
  try {
    const result = await loadTemplateData(deps, indexedKey, root);
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
  } catch (error) {
    logger.error("Failed to export template data for {indexedKey}", {
      indexedKey,
      root,
      error,
    });
    new BaseNotice(m.template_data_explorer_export_failed());
  }
}
