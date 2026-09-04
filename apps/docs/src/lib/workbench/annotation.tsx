// The Annotation Section away from the note tab: the pointer strip the other
// two tabs carry to it, the section bar Advanced shows over the whole file with
// its repair action, and the result column's view of one highlight.

import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { ANNOTATION_HEADER } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { m } from "@/paraglide/messages.js";

import { ResultSheet } from "./reading-view";

/**
 * The strip Properties and Name and folder carry: the format lives in the note,
 * and this is the way to it. With no render call to open it at, the host sends
 * the reader to the section in Advanced instead.
 */
export function AnnotationPointer({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-auto flex shrink-0 cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 border border-fd-border bg-fd-card px-3 py-2 text-left"
    >
      <span className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-primary uppercase">
        {m.workbench_highlight_heading()}
      </span>
      <span className="text-xs text-fd-muted-foreground">
        {m.workbench_highlight_pointer()}
      </span>
      <span className="ml-auto text-xs underline underline-offset-2">
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
    <div className="mb-2 flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border border-fd-border bg-fd-card px-3 py-2">
      <span className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-primary uppercase">
        {m.workbench_section_heading()}
      </span>
      {missing ? (
        <>
          <span className="text-xs text-fd-muted-foreground">
            {m.workbench_section_missing()}
          </span>
          <button
            type="button"
            onClick={() => controller.repairAnnotationSection()}
            className="ml-auto cursor-pointer border border-fd-border px-2 py-0.5 text-xs"
          >
            {m.workbench_section_repair()}
          </button>
        </>
      ) : (
        section && (
          <button
            type="button"
            onClick={() => onGo({ ...section.header })}
            className="ml-auto cursor-pointer text-xs underline underline-offset-2"
          >
            {m.workbench_section_go()}
          </button>
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
