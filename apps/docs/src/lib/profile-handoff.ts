// ZotLit's clipboard handoff: a Profile document leaves the site for the import sheet in Obsidian.
// The Template Workbench and the Template Directory both hand a document over this way.

import { buildImportProfileProtocolUrl } from "@zotlit/protocol";

/** Copies the exact document before handing control to the native import sheet. */
export async function openProfileInObsidian(source: string): Promise<void> {
  await navigator.clipboard.writeText(source);
  const link = document.createElement("a");
  link.href = buildImportProfileProtocolUrl();
  link.click();
}
