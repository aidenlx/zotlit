// Every source pane reads the editor's current findings, independent of whether
// the Problems explanation is open. Only verified locations become marks.
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#/document/index";
import type { Diagnostic } from "@codemirror/lint";
import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { WorkbenchMessages } from "./generated/messages";
import { diagnosisExplanation } from "./problems";
import type { WorkbenchDiagnosis } from "./problems";

import { jsonPosition } from "#/document/index";
import { currentCallSite } from "#/render/locate";

const Findings = createContext<readonly WorkbenchDiagnosis[]>([]);
const Reveal = createContext<((id: string) => void) | undefined>(undefined);
export function WorkbenchDiagnosticsProvider({
  value,
  onReveal,
  children,
}: {
  value: readonly WorkbenchDiagnosis[];
  onReveal?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Findings.Provider value={value}>
      <Reveal.Provider value={onReveal}>{children}</Reveal.Provider>
    </Findings.Provider>
  );
}
export const useRevealSourceDiagnosis = () => useContext(Reveal);
export const useSourceDiagnoses = () => useContext(Findings);

interface SourceDiagnostic extends Diagnostic {
  diagnosisId: string;
}

/** Convert verified master offsets into the text this pane displays. */
export function sourceDiagnostics({
  controller,
  slice,
  source,
  diagnoses,
  messages,
  json,
}: {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  source: string;
  diagnoses: readonly WorkbenchDiagnosis[];
  messages: WorkbenchMessages;
  json: boolean;
}): SourceDiagnostic[] {
  const bounds = controller.sliceRange(slice);
  return diagnoses.flatMap((diagnosis) => {
    const explanation = diagnosisExplanation(messages, diagnosis);
    const ranges =
      diagnosis.kind === "document"
        ? diagnosis.occurrences.map((problem) => problem.range)
        : diagnosis.occurrences.map((diagnostic) =>
            currentCallSite(diagnostic, controller),
          );
    return ranges.flatMap((range): SourceDiagnostic[] => {
      if (!range || range.from < bounds.from || range.to > bounds.to) return [];
      const local = (offset: number) =>
        json
          ? jsonPosition(
              controller.sliceText(slice),
              source,
              offset - bounds.from,
            )
          : offset - bounds.from;
      return [
        {
          from: local(range.from),
          to: local(range.to),
          severity: "error",
          diagnosisId: diagnosis.id,
          message: `${explanation.condition}\n${explanation.suggestion}`,
        },
      ];
    });
  });
}

/**
 * An explicit, keyboard-accessible control beside each affected source line.
 * The column is mounted while the pane holds a problem and dropped once it is
 * clean, so a pane with nothing wrong keeps its full width. The pane owns that
 * switch: it calls `show` whenever it sets the diagnostics the column reads.
 */
export function sourceProblemGutter(
  reveal: (id: string) => void,
  label: () => string,
) {
  class ProblemMarker extends GutterMarker {
    constructor(readonly id: string) {
      super();
    }
    eq(other: ProblemMarker) {
      return this.id === other.id;
    }
    toDOM(view: EditorView) {
      const button = view.dom.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "cm-problem-button";
      button.setAttribute("aria-label", label());
      button.onclick = () => reveal(this.id);
      return button;
    }
  }
  const slot = new Compartment();
  const column = [
    gutter({
      class: "cm-problem-gutter",
      lineMarker(view, line) {
        let id: string | undefined;
        forEachDiagnostic(view.state, (diagnostic, from) => {
          if (
            id === undefined &&
            from >= line.from &&
            from <= line.to &&
            "diagnosisId" in diagnostic &&
            typeof diagnostic.diagnosisId === "string"
          ) {
            id = diagnostic.diagnosisId;
          }
        });
        return id === undefined ? null : new ProblemMarker(id);
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setDiagnosticsEffect)),
        ),
    }),
    EditorView.theme({
      "&.cm-editor .cm-scroller .cm-gutters": { marginInlineEnd: "0" },
      ".cm-problem-gutter": { width: "16px" },
      ".cm-problem-gutter .cm-gutterElement": {
        padding: "0",
        textAlign: "center",
      },
      ".cm-problem-button": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        minWidth: "0",
        height: "1.4em",
        padding: "0",
        margin: "0",
        border: "0",
        borderRadius: "3px",
        background: "transparent",
        boxShadow: "none",
        verticalAlign: "top",
        cursor: "pointer",
      },
      ".cm-problem-button::before": {
        content: '""',
        display: "block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: "currentColor",
      },
      ".cm-problem-button:focus-visible": {
        outline: "2px solid currentColor",
        outlineOffset: "-2px",
      },
    }),
  ];
  return {
    extension: slot.of([]),
    /** Mount the column while `present`, and drop it once nothing is wrong. */
    show: (present: boolean) => slot.reconfigure(present ? column : []),
  };
}
