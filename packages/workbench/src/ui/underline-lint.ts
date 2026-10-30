// Lint that only underlines: an editor whose diagnostics the host sets, and
// whose faults it words elsewhere, such as a status line, with no tooltip
// over the underline.
import type { Diagnostic } from "@codemirror/lint";
import { linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";

/**
 * The lint extension of an editor whose diagnostics are only underlined.
 * CodeMirror mounts the hover tooltip for any filtered list, an empty one
 * included, and skips it only when the filter answers no list at all.
 */
export const underlineOnlyLint: Extension = linter(null, {
  tooltipFilter: () => null as unknown as Diagnostic[],
});
