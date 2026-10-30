// The editor mark on the Annotation Section's header line. It stands apart
// from the annotation components so Fast Refresh keeps that module a clean
// component boundary.

import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { ANNOTATION_HEADER } from "@zotlit/workbench/document";

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
