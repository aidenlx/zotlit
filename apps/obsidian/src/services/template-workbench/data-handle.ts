// Template data for callers outside Effect: the views, the Profile dialogs and
// the Template Migration engine.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { LibraryScope } from "@/services/library-scope/service";
import { readMigrationVerificationData } from "@/services/template/migration-data";
import type { MigrationVerificationData } from "@/services/template/migration-data";

import { readCitationData, readTemplateData, withSettings } from "./data";
import type { TemplateDataLoader, TemplateDataServices } from "./data";

/** What the handle reads: the data's services and the Library Scope. */
export type TemplateDataHandleServices = TemplateDataServices | LibraryScope;

/** The edge handle `build.ts` binds; see {@link bindTemplateData}. */
export interface TemplateDataHandle extends TemplateDataLoader {
  /** One real in-scope item a Legacy Template conversion verifies against. */
  verificationData(options: {
    annotation: boolean;
  }): Promise<MigrationVerificationData | null>;
}

/**
 * The Template data reads over `context`, run through `bridge`. A load
 * resolves with its result and rejects with what failed, as a read or a
 * Template does.
 */
export function bindTemplateData(
  bridge: Pick<EffectBridge, "runPromise">,
  context: Context.Context<TemplateDataHandleServices>,
): TemplateDataHandle {
  const run = <A, E>(effect: Effect.Effect<A, E, TemplateDataHandleServices>) =>
    bridge.runPromise(Effect.provideContext(effect, context));
  return {
    load: (indexedKey, root, options) => {
      const read = readTemplateData(indexedKey, root);
      return run(
        (options?.settings === undefined
          ? read
          : read.pipe(withSettings(options.settings))
        ).pipe(Effect.mapError(({ cause }) => cause)),
      );
    },
    loadCitation: (selector, variant) =>
      run(
        readCitationData(selector, variant).pipe(
          Effect.mapError(({ cause }) => cause),
        ),
      ),
    verificationData: (options) => run(readMigrationVerificationData(options)),
  };
}
