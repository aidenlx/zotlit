import { attachmentsSection } from "./attachments";
import { type CompatContext } from "./context";
import { databaseSection } from "./database";
import { generalSection } from "./general";
import { liveUpdatesSection } from "./live-updates";
import { loggingSection } from "./logging";
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
  generalSection(containerEl, ctx);
  databaseSection(containerEl, ctx);
  templatesSection(containerEl, ctx);
  attachmentsSection(containerEl, ctx);
  liveUpdatesSection(containerEl, ctx);
  loggingSection(containerEl, ctx);
}
