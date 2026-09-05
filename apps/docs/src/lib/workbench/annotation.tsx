// Access to the Annotation Section when the note has no render call, the Source
// mode section bar and its repair action, and the preview of one highlight.

import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { ANNOTATION_HEADER } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import { ResultSheet } from "./reading-view";

/**
 * Access to the format from the note when it has no render call to open inline.
 * The host opens the section in Source mode.
 */
export function AnnotationPointer({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 flex shrink-0 cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-3 text-left"
    >
      <span className="text-sm font-medium">
        {m.workbench_highlight_heading()}
      </span>
      <span className="text-sm text-fd-muted-foreground">
        {m.workbench_highlight_pointer()}
      </span>
      <span className="ml-auto text-sm underline underline-offset-2">
        {m.workbench_highlight_open()}
      </span>
    </button>
  );
}

/**
 * Advanced's own bar over the whole file: the section it holds, or the repair
 * action for the document that has none.
 */
export function AnnotationSectionBar({
  controller,
  onGo,
}: {
  controller: WorkbenchDocumentController;
  onGo: (header: WorkbenchSliceRange) => void;
}) {
  const section = controller.annotationSection;
  // A document mid-repair can hold the section ranges it had, so the refusal
  // the parser raises decides which of the two actions the bar offers.
  const missing = controller.problems.some(
    ({ code }) => code === "missing-annotation-section",
  );
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_section_heading()}
      </span>
      {missing ? (
        <>
          <span className="text-sm text-fd-muted-foreground">
            {m.workbench_section_missing()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => controller.repairAnnotationSection()}
            className="ml-auto"
          >
            {m.workbench_section_repair()}
          </Button>
        </>
      ) : (
        section && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onGo({ ...section.header })}
            className="ml-auto"
          >
            {m.workbench_section_go()}
          </Button>
        )
      )}
    </div>
  );
}

/**
 * The `--- zotlit:annotation ---` line marked in Advanced, so the boundary the
 * document turns on is visible in the source itself. The mark is read from the
 * pane's own text, which is the whole file, so it stays on the line the reader
 * is moving while they move it.
 */
export const annotationHeaderMark: Extension = StateField.define<DecorationSet>(
  {
    create: headerMarks,
    update: (value, transaction) =>
      transaction.docChanged ? headerMarks(transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  },
);

function headerMarks({ doc }: EditorState): DecorationSet {
  const marks = [];
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (line.text === ANNOTATION_HEADER) {
      marks.push(
        Decoration.line({ class: "zt-section-header" }).range(line.from),
      );
    }
  }
  return Decoration.set(marks);
}

/**
 * The result column while the reader edits the format: the one highlight the
 * render produced, as the note would carry it.
 */
export function AnnotationResult({
  markdown,
  showMarkdown,
}: {
  markdown: string | null;
  showMarkdown: boolean;
}) {
  if (markdown === null) {
    return (
      <p className="text-sm text-fd-muted-foreground">
        {m.workbench_fields_no_highlights()}
      </p>
    );
  }
  return (
    <ResultSheet
      markdown={markdown}
      properties={[]}
      showMarkdown={showMarkdown}
    />
  );
}
