// A Query View that stands in a template's note preview in the Template
// Workbench draws a placeholder in its place.
// A preview is not the note: the view could neither save a change nor read
// the note's own `this`, so it marks where the note shows the view. A
// Markdown render places each section in its target before the section's
// processors run, so the check reads the element as the host gets it.
// The placeholder tells the template author what the note will show: each
// view's name, Layout and rows, whether it shows only the note's own item, and
// what in the query text keeps it from running.
import { setIcon } from "obsidian";

import { foldFilterTree } from "@zotlit/filter-expression";
import type { FilterTree } from "@zotlit/filter-expression";

import * as m from "@/lib/i18n/generated/messages";

import { layoutOf } from "./layouts";
import type { QueryFile, QueryFileDataset, QueryFileView } from "./query-file";
import { problemText } from "./view";

/** A template's note preview. */
const IN_PREVIEW = "[data-zotlit-draft]";

/** Whether `el` stands in a preview, where a Query View draws its placeholder. */
export function inPreview(el: HTMLElement): boolean {
  return el.closest(IN_PREVIEW) !== null;
}

const DATASET_NAME: Record<QueryFileDataset, () => string> = {
  annotations: m.query_view_dataset_annotations,
  attachments: m.query_view_dataset_attachments,
  items: m.query_view_dataset_items,
};

/** A filter that reads `this.item`, which binds the view to the note's item. */
const READS_NOTE_ITEM = /\bthis\.item\b/;

function readsNoteItem(tree: FilterTree | undefined): boolean {
  if (tree === undefined) return false;
  return foldFilterTree(tree, {
    leaf: (expression) => READS_NOTE_ITEM.test(expression),
    group: (_, entries) => entries.some(Boolean),
  });
}

/** What one view shows, in the author's terms: Layout, rows, and scope. */
function viewSummary(file: QueryFile, view: QueryFileView): string {
  const parts: string[] = [];
  const layout = layoutOf(view)?.name();
  if (layout !== undefined) parts.push(layout);
  const rows = DATASET_NAME[view.from ?? "annotations"]();
  if (rows !== layout) parts.push(rows);
  if (readsNoteItem(file.filters) || readsNoteItem(view.filters))
    parts.push(m.query_view_placeholder_note_item());
  return parts.join(" · ");
}

/**
 * Draw the placeholder into `el`.
 *
 * @param name the Query File it shows, if any; a Query Block has none.
 * @param file the parsed query text; `null` while an embed reads its file.
 * @param viewName the one view an embed link names; `null` for every view.
 */
export function renderPreviewPlaceholder(
  el: HTMLElement,
  {
    name,
    file = null,
    viewName = null,
  }: {
    name: string | null;
    file?: QueryFile | null;
    viewName?: string | null;
  },
): void {
  el.empty();
  const box = el.createDiv({
    cls: "zt:flex zt:flex-col zt:gap-1.5 zt:rounded-md zt:border-(length:--border-width) zt:border-solid zt:border-(--background-modifier-border) zt:px-3 zt:py-2 zt:text-sm zt:text-muted-foreground",
    attr: { "data-query-placeholder": "" },
  });
  const header = box.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2",
  });
  setIcon(
    header.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-faint" }),
    "list-filter",
  );
  header.createSpan({
    cls: "zt:[font-weight:var(--font-medium)] zt:text-foreground",
    text: name ?? m.query_view_placeholder(),
  });
  header.createSpan({ text: m.query_view_placeholder_desc() });
  if (file === null) return;

  const views =
    viewName === null
      ? file.views
      : file.views.filter((view) => view.name === viewName);
  // Divs, not a list: a note's own list styles would indent the rows.
  const list = box.createDiv({ cls: "zt:flex zt:flex-col zt:gap-1" });
  for (const view of views) {
    const row = list.createDiv({
      cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2",
      attr: { "data-query-placeholder-view": view.name },
    });
    setIcon(
      row.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-faint" }),
      layoutOf(view)?.icon ?? "list",
    );
    row.createSpan({ cls: "zt:text-foreground", text: view.name });
    row.createSpan({ text: viewSummary(file, view) });
  }

  const problems = [
    ...file.problems.map(problemText),
    ...views.flatMap((view) => view.problems.map(problemText)),
  ];
  if (viewName !== null && views.length === 0)
    problems.push(m.query_view_placeholder_no_view({ name: viewName }));
  for (const problem of problems) {
    const row = box.createDiv({
      cls: "zt:flex zt:items-start zt:gap-2 zt:text-destructive",
      attr: { "data-query-placeholder-problem": "" },
    });
    setIcon(
      row.createSpan({ cls: "zt:flex zt:shrink-0 zt:pt-0.5" }),
      "alert-triangle",
    );
    row.createSpan({ text: problem });
  }
}
