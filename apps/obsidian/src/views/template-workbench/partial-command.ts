// The one Shared Partial create flow: the Workbench's entry points and the
// Add partial settings row both run it.

import { Effect } from "effect";
import type { App } from "obsidian";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { withOutcome } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import { Template } from "@/services/template/service";

import { openNewPartialPrompt } from "./new-partial";
import type { CreateSharedPartialOptions } from "./new-partial";
import { openTemplateWorkbench } from "./open";

/**
 * Ask a name under the shared rule and write `zotlit-partial.<name>.md`. An
 * interrupt closes the prompt. Where the document opens is the caller's.
 *
 * @returns the created document and its name, or `null` when the reader
 *   dismisses the prompt. Fails with the Template's failure.
 */
export const createSharedPartial = Effect.fn("SharedPartial.create")(function* (
  app: App,
  options: Omit<CreateSharedPartialOptions, "open"> = {},
) {
  const template = yield* Template;
  const taken = yield* template.getPartialNames;
  const name = yield* awaitModal<string | null>((settle) =>
    openNewPartialPrompt(app, { taken, seed: options.name }, settle),
  );
  if (name === null) return null;
  const file = yield* template.createPartial(name, {
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  return { name, file };
});

/**
 * {@link createSharedPartial} for a Workbench entry point, which a leaf runs
 * on its runner, so closing the leaf also closes its prompt. The document opens
 * as `options.open` says. A failure is logged and shows a notice, and answers
 * `null` as a dismissal does.
 *
 * @returns the created name, or `null`.
 */
export const createSharedPartialEffect = Effect.fn(
  "TemplateWorkbench.createSharedPartial",
)(function* (app: App, options: CreateSharedPartialOptions = {}) {
  return yield* withOutcome(
    Effect.gen(function* () {
      const { open = "split", ...create } = options;
      const created = yield* createSharedPartial(app, create);
      if (!created) return null;
      if (open !== false) {
        const leaf = yield* (yield* Workspace).getLeaf(
          open === "split" ? "split" : "tab",
        );
        yield* openTemplateWorkbench(app, created.file, {
          leaf,
          explainUnsupported: false,
        });
      }
      return created.name;
    }),
    {
      success: () => undefined,
      error: () => m.notice_partial_create_failed(),
    },
  ).pipe(recover(() => Effect.void, Effect.succeed(null)));
}, withLogCategory("template-workbench"));
