// Where a pane's render and include completion reads its partial names.

import type { WorkbenchRunner } from "#/language/host-effects";
import type { SuggestionConfig } from "#/language/index";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchHost } from "./host";

/**
 * The partial half of one pane's suggestion config.
 *
 * A host that registers partials owns the list: the vault's names, whether or
 * not this draft calls any of them, ending with the entry that creates one.
 * Where the host registers none — the web Workbench, which writes no files —
 * the draft's own dependency scan answers instead, naming what its bridge
 * bundled.
 * @param host.run Forks the create flow on the pane's runner.
 */
export function partialSuggestions(
  m: WorkbenchMessages,
  dependencies: readonly string[],
  {
    partials,
    run,
  }: {
    readonly partials: WorkbenchHost["partials"] | undefined;
    readonly run: WorkbenchRunner | null;
  },
): Pick<SuggestionConfig, "partials" | "createPartial"> {
  if (!partials || run === null) return { partials: dependencies };
  return {
    partials: partials.names(),
    createPartial: {
      label: m.workbench_partial_new(),
      detail: m.workbench_partial_new_detail(),
      run: (query) => partials.create(query),
      fork: run,
    },
  };
}
