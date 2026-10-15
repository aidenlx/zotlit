// A Query View that stands in a template's note preview in the Template
// Workbench draws a placeholder in its place.
// A preview is not the note: the view could neither save a change nor read
// the note's own `this`, so it marks where the note shows the view. A
// Markdown render places each section in its target before the section's
// processors run, so the check reads the element as the host gets it.
import { setIcon } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

/** A template's note preview. */
const IN_PREVIEW = "[data-zotlit-draft]";

/** Whether `el` stands in a preview, where a Query View draws its placeholder. */
export function inPreview(el: HTMLElement): boolean {
  return el.closest(IN_PREVIEW) !== null;
}

/** Draw the placeholder into `el`, named after the Query File it shows, if any. */
export function renderPreviewPlaceholder(
  el: HTMLElement,
  name: string | null,
): void {
  el.empty();
  const box = el.createDiv({
    cls: "zt:flex zt:items-center zt:gap-2 zt:rounded-md zt:border-(length:--border-width) zt:border-solid zt:border-(--background-modifier-border) zt:px-3 zt:py-2 zt:text-sm zt:text-muted-foreground",
    attr: { "data-query-placeholder": "" },
  });
  setIcon(
    box.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-faint" }),
    "list-filter",
  );
  box.createSpan({
    cls: "zt:[font-weight:var(--font-medium)] zt:text-foreground",
    text: name ?? m.query_view_placeholder(),
  });
  box.createSpan({ text: m.query_view_placeholder_desc() });
}
