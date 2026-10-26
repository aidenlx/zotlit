// Commands of the Template Data Explorer, run on the plugin's view registry.
import { Cause, Effect } from "effect";

import { viewRuntime } from "@/lib/view-atoms";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";

import { failTemplateDataExport, saveTemplateDataExport } from "./export-file";
import type { TemplateDataExportTarget } from "./export-file";

/** Saves the Template data of one root as a JSON file. */
export const exportTemplateDataCommand = viewRuntime.fn(
  (target: TemplateDataExportTarget & { readonly pluginVersion: string }) =>
    Effect.gen(function* () {
      const result = yield* (yield* TemplateDataReads).read(
        target.indexedKey,
        target.root,
      );
      yield* Effect.sync(() => saveTemplateDataExport(result, target));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => failTemplateDataExport(target, Cause.squash(cause))),
      ),
    ),
);
