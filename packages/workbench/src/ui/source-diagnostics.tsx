// Every source pane reads the editor's current findings, independent of whether
// the Problems explanation is open. Only verified locations become marks.
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#/document/index";
import type { Diagnostic } from "@codemirror/lint";
import { createContext, useContext } from "react";

import type { WorkbenchMessages } from "./generated/messages";
import { diagnosisExplanation } from "./problems";
import type { WorkbenchDiagnosis } from "./problems";

import { jsonPosition } from "#/document/index";
import { currentCallSite } from "#/render/locate";

const Findings = createContext<readonly WorkbenchDiagnosis[]>([]);
export const WorkbenchDiagnosticsProvider = Findings.Provider;
export const useSourceDiagnoses = () => useContext(Findings);

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
}): Diagnostic[] {
  const bounds = controller.sliceRange(slice);
  return diagnoses.flatMap((diagnosis) => {
    const explanation = diagnosisExplanation(messages, diagnosis);
    const ranges =
      diagnosis.kind === "document"
        ? diagnosis.occurrences.map((problem) => problem.range)
        : diagnosis.occurrences.map((diagnostic) =>
            currentCallSite(diagnostic, controller),
          );
    return ranges.flatMap((range): Diagnostic[] => {
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
          message: `${explanation.condition}\n${explanation.suggestion}`,
        },
      ];
    });
  });
}
