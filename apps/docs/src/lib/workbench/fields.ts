// The field list's own logic: which Template data root the caret sits in, the
// common rows that root offers under names a reader knows, the one-line value
// each row shows for the paper on screen, and the insertion every row shares —
// the `{{` accelerator, the engine its snippets are written in, and the patch
// Put in note applies to the master document.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import { formatAccessorPath, renderSnippet } from "@zotlit/workbench/explorer";
import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "@zotlit/workbench/explorer";
import { restoreTemplateData } from "@zotlit/workbench/render";
import type { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

export type SampleItem = (typeof SAMPLE_ITEMS)[number];

/** The parsed Profile document, named without depending on the templates package. */
type ProfileDocument = NonNullable<WorkbenchDocumentController["document"]>;

/** The Template data an editor position writes against. */
export type TemplateRoot = "note" | "annotation" | "filename";

export interface CommonField {
  /** Top-level key on the root object, which is also its display-node key. */
  readonly key: string;
  /** The name the reader recognizes, in place of the raw key. */
  readonly label: () => string;
}

/**
 * The rows each root leads with. Everything outside these lists is one select
 * away, under "Everything else from Zotero".
 */
const COMMON_FIELDS: Record<TemplateRoot, readonly CommonField[]> = {
  note: [
    { key: "title", label: m.workbench_field_title },
    { key: "authors", label: m.workbench_field_authors },
    { key: "date", label: m.workbench_field_date },
    { key: "abstract", label: m.workbench_field_abstract },
    { key: "publicationTitle", label: m.workbench_field_publication_title },
    { key: "citationKey", label: m.workbench_field_citation_key },
    { key: "tags", label: m.workbench_field_tags },
    { key: "collections", label: m.workbench_field_collections },
    { key: "backlink", label: m.workbench_field_backlink },
    { key: "attachments", label: m.workbench_field_attachments },
    { key: "annotations", label: m.workbench_field_annotations },
  ],
  annotation: [
    { key: "text", label: m.workbench_field_text },
    { key: "comment", label: m.workbench_field_comment },
    { key: "pageLabel", label: m.workbench_field_page_label },
    { key: "colorName", label: m.workbench_field_color_name },
    { key: "tags", label: m.workbench_field_tags },
    { key: "backlink", label: m.workbench_field_backlink },
    { key: "imgLink", label: m.workbench_field_img_link },
    { key: "parentItem", label: m.workbench_field_parent_item },
  ],
  filename: [
    { key: "title", label: m.workbench_field_title },
    { key: "authors", label: m.workbench_field_authors },
    { key: "date", label: m.workbench_field_date },
    { key: "citationKey", label: m.workbench_field_citation_key },
    { key: "key", label: m.workbench_field_key },
  ],
};

/** Human labels and common-field order shared by discovery and typing completion. */
export function completionFields(root: TemplateRoot) {
  return COMMON_FIELDS[root].map((field) => ({
    path: `zt.${field.key}`,
    label: field.label(),
  }));
}

/** The name shown in the panel's corner, so the reader knows what the list is for. */
export const ROOT_LABEL: Record<TemplateRoot, () => string> = {
  note: m.workbench_fields_root_note,
  annotation: m.workbench_fields_root_annotation,
  filename: m.workbench_fields_root_filename,
};

/**
 * The root an editor position writes against: the Annotation Section renders
 * one highlight, the manifest's `filename` value renders the note name, and
 * every other position renders the note. The filename range is the controller's
 * own `filenameSlice`, so a caret move reads it rather than re-parsing the
 * manifest; a note name one line cannot hold owns no slice, and a caret inside
 * it reads the note the way the rest of the manifest does.
 */
export function templateRootAt(
  document: ProfileDocument | null,
  filename: WorkbenchSliceRange | null,
  offset: number,
): TemplateRoot {
  if (!document) return "note";
  if (offset >= document.annotationSection.headerStart) return "annotation";
  if (offset >= document.bodyStart) return "note";
  return filename && offset >= filename.from && offset <= filename.to
    ? "filename"
    : "note";
}

/**
 * The Template data the root binds to `zt`, restored from the snapshot the way
 * the renderer restores it, so a row shows the value the template would read.
 * @returns null when the paper carries no such root — a paper with no highlights.
 */
export function rootData(
  snapshot: SampleItem,
  root: TemplateRoot,
): Record<string, unknown> | null {
  if (root !== "annotation") {
    return restoreTemplateData(
      snapshot.roots[root],
      snapshot.descriptors[root],
    );
  }
  const annotation = snapshot.roots.annotations[0];
  const descriptors = snapshot.descriptors.annotations[0];
  return annotation && descriptors
    ? restoreTemplateData(annotation, descriptors)
    : null;
}

export interface FieldRow {
  readonly node: DisplayNode;
  readonly label: string;
  readonly value: string;
}

/**
 * The common rows for `root` in their fixed order, over display nodes built
 * from that root. A row the paper has no key for is dropped rather than shown
 * empty.
 */
export function commonRows(
  root: TemplateRoot,
  nodes: readonly DisplayNode[],
): FieldRow[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  return COMMON_FIELDS[root].flatMap((field) => {
    const node = byKey.get(field.key);
    return node
      ? [{ node, label: field.label(), value: fieldValueText(node) }]
      : [];
  });
}

/** Matches a row on the name the reader sees and on this paper's value. */
export function rowMatches(row: FieldRow, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    row.label.toLowerCase().includes(needle) ||
    row.value.toLowerCase().includes(needle)
  );
}

/** This paper's value for one row, as the single line a row shows. */
export function fieldValueText(node: DisplayNode): string {
  if (node.kind === "placeholder") return node.reason;
  if (node.kind === "helper") return node.evaluated ?? "";
  switch (node.valueType) {
    case "array":
      return (node.value as unknown[]).map(String).join(", ");
    case "object":
      return node.preview ?? "";
    case "getter":
    case "null":
    case "undefined":
      return "";
    default:
      return String(node.value);
  }
}

/**
 * The engine every snippet is written in, which the `{{` accelerator belongs
 * to as well. The web host edits and renders Liquid alone and sends an Eta
 * Profile to Obsidian, so one engine answers for the whole list.
 * @see docs/adr/0033-web-workbench-is-public-and-standalone.md
 */
export const SNIPPET_ENGINE: TemplateEngine = "liquid";

export type FieldInsertionMode = "template" | "expression" | "json-e";

/** A field inserted in a property uses that property's own value syntax. */
export function fieldSnippet(
  node: DisplayNode,
  mode: FieldInsertionMode,
  kind: SnippetKind,
): string {
  if (mode === "template") return renderSnippet(node, SNIPPET_ENGINE, kind);
  const path = formatAccessorPath(node.path, "zt");
  return mode === "expression" ? path : JSON.stringify({ $eval: path });
}

/** The opening delimiter that starts Template Completion. */
export const FIELD_TRIGGER = "{{";

/**
 * Where an insertion lands: the range the reader last left in `slice`, held
 * inside it so a caret parked in another pane cannot patch outside this one.
 */
export function insertRange(
  slice: WorkbenchSliceRange,
  target: WorkbenchSliceRange,
): WorkbenchSliceRange {
  const from = Math.min(Math.max(target.from, slice.from), slice.to);
  const to = Math.min(Math.max(target.to, from), slice.to);
  return { from, to };
}

/**
 * The one insertion behind Put in note and the `{{` popup: it patches the
 * master at the selection the reader left in `slice`, held inside that pane.
 * @returns the master offset the caret lands at, past the snippet.
 */
export function insertSnippet(
  controller: WorkbenchDocumentController,
  slice: WorkbenchSliceId,
  { target, snippet }: { target: WorkbenchSliceRange; snippet: string },
): number {
  const { from, to } = insertRange(controller.sliceRange(slice), target);
  controller.dispatch({
    changes: { from, to, insert: snippet },
    userEvent: "input.complete",
  });
  return from + snippet.length;
}
