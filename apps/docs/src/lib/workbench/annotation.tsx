// Access to the Annotation Section when the note has no render call, and the
// Source mode section bar with its repair action.

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

/**
 * The format's place under a note that calls it nowhere: the host puts the
 * call, and the loop around it, where the reader left the caret, and the box
 * opens there.
 */
export function AnnotationPointer({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_annotation_label()}
      </span>
      <span className="text-sm text-fd-muted-foreground">
        {m.workbench_annotation_pointer()}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onInsert}
        className="ms-auto"
      >
        {m.workbench_annotation_insert()}
      </Button>
    </div>
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
