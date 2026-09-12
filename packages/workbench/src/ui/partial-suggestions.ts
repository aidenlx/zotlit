// Where a pane's render and include completion reads its partial names.

import type { SuggestionConfig } from "#/language/index";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchPartials } from "./host";

/**
 * The partial half of one pane's suggestion config.
 *
 * A host that registers partials owns the list: the vault's names, whether or
 * not this draft calls any of them, ending with the entry that creates one.
 * Where the host registers none — the web Workbench, which writes no files —
 * the draft's own dependency scan answers instead, naming what its bridge
 * bundled.
 */
export function partialSuggestions(
  m: WorkbenchMessages,
  dependencies: readonly string[],
  partials: WorkbenchPartials | undefined,
): Pick<SuggestionConfig, "partials" | "createPartial"> {
  if (!partials) return { partials: dependencies };
  return {
    partials: partials.names(),
    createPartial: {
      label: m.workbench_partial_new(),
      detail: m.workbench_partial_new_detail(),
      run: (query) => partials.create(query),
    },
  };
}
