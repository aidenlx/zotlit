import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier, reportOutcome } from "@/lib/notifier";
import type { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import type { Customize } from "@/services/local-bridge/customize";
import type { Profile } from "@/services/profile/service";

/**
 * Run a Template Workbench action and report its outcome: a failure is logged
 * under `operation` and a notice tells the user; an interrupt passes on with
 * no notice.
 */
export const templateWorkbenchAction = <A, E, R>(
  operation: string,
  action: Effect.Effect<A, E, R>,
) =>
  reportOutcome(action, {
    success: () => undefined,
    error: () => m.notice_profile_action_failed(),
  }).pipe(
    Effect.annotateLogs({ operation }),
    withLogCategory("template-workbench"),
  );

/** What an open of the Template Workbench View asks the reader to know. */
export interface WorkbenchOpened {
  /** The document uses Eta or JavaScript fields, which only this editor runs. */
  readonly nativeRequired: boolean;
  /** The note the reader launched from, which this editor cannot update. */
  readonly unavailableNote: string | null;
}

/** Show a notice for each thing `opened` asks the reader to know. */
export const explainWorkbenchOpen = Effect.fn(
  "TemplateWorkbench.explainWorkbenchOpen",
)(function* (opened: WorkbenchOpened | void) {
  if (!opened) return;
  const notifier = yield* Notifier;
  if (opened.nativeRequired)
    yield* notifier.show(m.template_workbench_native_required());
  if (opened.unavailableNote !== null)
    yield* notifier.show(
      m.template_workbench_update_unavailable({
        name: opened.unavailableNote,
      }),
    );
});

/** The services a Workbench launch reads. */
export type WorkbenchActionServices =
  | Notifier
  | Vault
  | Workspace
  | Customize
  | Profile;

/** What a plain Obsidian callback needs to start a Workbench action. */
export interface WorkbenchActionDeps {
  readonly bridge: Pick<EffectBridge, "runAndForget">;
  /** The plugin's services that a launch runs with. */
  readonly context: Context.Context<WorkbenchActionServices>;
}

/**
 * Start the Workbench action `open` from a plain Obsidian callback, such as a
 * command or a menu entry, on the plugin's bridge: unload stops it quietly.
 * What the open asks the reader to know shows as a notice.
 */
export function startTemplateWorkbenchAction<E>(
  deps: WorkbenchActionDeps,
  operation: string,
  open: Effect.Effect<WorkbenchOpened | void, E, WorkbenchActionServices>,
): void {
  deps.bridge.runAndForget(
    templateWorkbenchAction(
      operation,
      open.pipe(Effect.flatMap((opened) => explainWorkbenchOpen(opened))),
    ).pipe(Effect.provideContext(deps.context)),
  );
}
