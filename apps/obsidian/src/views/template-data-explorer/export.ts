// Builds the Template Data Export: the contract-shaped JSON of the Explorer's current root, named for download.

import { CONTRACT_VERSION } from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { serializeTemplateData } from "@zotlit/workbench/explorer";

export interface TemplateDataExportInput {
  /** The object the pane currently shows: the note context, or the anchored annotation. */
  readonly root: object;
  readonly contractRoot: ContractRoot;
  /** Indexed Key of the exported object — the Item, or the anchored Annotation. */
  readonly indexedKey: string;
  readonly pluginVersion: string;
  /** Compact download-name timestamp, from `exportTimestamp()`. */
  readonly timestamp: string;
}

export interface TemplateDataExport {
  readonly filename: string;
  readonly json: string;
}

/**
 * `pluginVersion`, `request`, and `zt` carry the Workbench CLI's own field
 * names, so one reading serves both surfaces and `request` states the command
 * that reproduces the file. The version field does not: the CLI's
 * `contractVersion` names the CLI Contract, which versions on its own, while
 * this file's only versioned surface is the `zt` contract each
 * `<root>.schema.json` publishes.
 *
 * @throws {import("@zotlit/workbench/explorer").ContractMetadataError} when the committed contract IR no longer covers this build's data shapes.
 */
export function buildTemplateDataExport(
  input: TemplateDataExportInput,
): TemplateDataExport {
  const zt = serializeTemplateData(input.root, input.contractRoot);
  return {
    filename: `zotlit-template-data-${input.indexedKey}-${input.timestamp}.json`,
    json: JSON.stringify(
      {
        templateContractVersion: CONTRACT_VERSION,
        pluginVersion: input.pluginVersion,
        request: { key: input.indexedKey, root: input.contractRoot },
        zt,
      },
      null,
      2,
    ),
  };
}
