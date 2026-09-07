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
import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "@zotlit/workbench/explorer";
import { restoreTemplateData } from "@zotlit/workbench/render";
import type { AnnotationExample, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import { m, fieldSnippet as sharedFieldSnippet } from "@zotlit/workbench/ui";
import type { TemplateRoot } from "@zotlit/workbench/ui";

export type SampleItem = (typeof SAMPLE_ITEMS)[number];

/** The parsed Profile document, named without depending on the templates package. */
type ProfileDocument = NonNullable<WorkbenchDocumentController["document"]>;

/** The name shown in the panel's corner, so the reader knows what the list is for. */
export const ROOT_LABEL: Record<TemplateRoot, () => string> = {
  note: m.workbench_fields_root_note,
  annotation: m.workbench_fields_root_annotation,
  filename: m.workbench_fields_root_filename,
};

/**
 * The root an editor position writes against: the Annotation Section renders
 * one annotation, the manifest's `filename` value renders the note name, and
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
 * @returns null when the paper carries no such root — a paper with no annotations.
 */
export function rootData(
  snapshot: SampleItem,
  root: TemplateRoot,
  example?: AnnotationExample,
): Record<string, unknown> | null {
  if (root !== "annotation") {
    return restoreTemplateData(
      snapshot.roots[root],
      snapshot.descriptors[root],
    );
  }
  const annotation = example?.root ?? snapshot.roots.annotations[0];
  const descriptors =
    example?.descriptors ?? snapshot.descriptors.annotations[0];
  return annotation && descriptors
    ? restoreTemplateData(annotation, descriptors)
    : null;
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
  return sharedFieldSnippet(node, mode, { kind, engine: SNIPPET_ENGINE });
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

export { commonRows, fieldValueText, rowMatches } from "@zotlit/workbench/ui";
