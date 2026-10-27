import { Effect } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { Notifier, reportOutcome } from "@/lib/notifier";

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

/** What a plain Obsidian callback needs to start a Workbench action. */
export interface WorkbenchActionDeps {
  readonly bridge: Pick<EffectBridge, "runAndForget">;
  readonly notifier: Notifier["Service"];
}

/**
 * Start the Workbench action `open` from a plain Obsidian callback, such as a
 * command or a menu entry, on the plugin's bridge: unload stops it quietly.
 */
export function startTemplateWorkbenchAction(
  deps: WorkbenchActionDeps,
  operation: string,
  open: () => Promise<void>,
): void {
  deps.bridge.runAndForget(
    templateWorkbenchAction(operation, portCall(operation, open)).pipe(
      Effect.provideService(Notifier, deps.notifier),
    ),
  );
}
