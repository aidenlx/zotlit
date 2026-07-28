import { attachmentsSection } from "./attachments";
import { type CompatContext } from "./context";
import { databaseSection } from "./database";
import { diagnosticsSection } from "./diagnostics";
import { generalSection } from "./general";
import { languagePackSetting } from "./language-pack";
import { liveUpdatesSection } from "./live-updates";
import { noteImportSection } from "./note-import";
import { resourcesSection } from "./resources";
import { templatesSection } from "./templates";

export { type CompatContext } from "./context";

/**
 * Build the imperative settings tab for Obsidian < 1.13.0. Sections render flat
 * in the same order the declarative tab presents them; structural changes call
 * {@link CompatContext.rerender} to rebuild the whole tab.
 *
 * The caller owns emptying `containerEl` and disposing the per-render teardown
 * stack that backs {@link CompatContext.defer}.
 */
export function renderCompatSettings(
  containerEl: HTMLElement,
  ctx: CompatContext,
): void {
  resourcesSection(containerEl, ctx);
  languagePackSetting(containerEl, ctx);
  generalSection(containerEl, ctx);
  databaseSection(containerEl, ctx);
  templatesSection(containerEl, ctx);
  noteImportSection(containerEl, ctx);
  attachmentsSection(containerEl, ctx);
  liveUpdatesSection(containerEl, ctx);
  diagnosticsSection(containerEl, ctx);
}
