// The name a host shows for a Shared Partial preview's own choice: the caller
// the partial is rendered as called from.

import type { PartialContext } from "#/render/partial-preview";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";

const CONTEXT_LABEL: Record<PartialContext, WorkbenchMessageLabel> = {
  note: "workbench_partial_context_note",
  annotation: "workbench_partial_context_annotation",
  citation: "workbench_partial_context_citation",
};

/** The chosen caller as the short phrase a caption names it with. */
export function partialContextLabel(
  m: WorkbenchMessages,
  context: PartialContext,
): string {
  return m[CONTEXT_LABEL[context]]();
}
