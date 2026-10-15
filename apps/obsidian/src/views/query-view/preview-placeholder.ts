// A Query View that stands in a preview — a template's note preview in the
// Template Workbench, an Annotation comment — draws a placeholder in its place.
// A preview is not the note: the view could neither save a change nor read
// the note's own `this`, so it marks where the note shows the view. A
// Markdown render places each section in its target before the section's
// processors run, so the check reads the element as the host gets it.
import { setIcon } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

/** Where a Query View shows as a preview: an Annotation comment, a note preview. */
const IN_PREVIEW = ".zt-annot-comment, [data-zotlit-draft]";

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
    cls: "zt:flex zt:items-center zt:gap-2 zt:rounded-(--radius-m) zt:border zt:border-solid zt:border-(--background-modifier-border) zt:px-3 zt:py-2 zt:text-sm zt:text-(--text-muted)",
    attr: { "data-query-placeholder": "" },
  });
  setIcon(
    box.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-(--text-faint)" }),
    "list-filter",
  );
  box.createSpan({
    cls: "zt:font-medium zt:text-(--text-normal)",
    text: name ?? m.query_view_placeholder(),
  });
  box.createSpan({ text: m.query_view_placeholder_desc() });
}
