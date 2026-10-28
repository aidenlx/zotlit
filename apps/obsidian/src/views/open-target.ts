// A view's gesture that opens an Attachment or an Annotation: a page chip, a
// reader link, a picker row. The open runs as a command on the plugin's view
// registry, so it outlives the tab that started it, as the reader may replace
// that tab, and ends when the plugin unloads.
import type { Effect } from "effect";

import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { openGesture } from "@/services/attachment-open/actions";
import type { TargetOpenGesture } from "@/services/attachment-open/actions";
import type {
  OpenOutcome,
  TargetOpener,
} from "@/services/attachment-open/open-target";

/** Runs one open; the plugin mounts it once for every view. */
export const openTargetCommand = viewRuntime.fn(
  (open: Effect.Effect<OpenOutcome>) => open,
  { concurrent: true },
);

/** {@link TargetOpenGesture} that runs each open on {@link openTargetCommand}. */
export function viewTargetOpener(
  registry: ViewRegistryHandle,
  opener: Pick<TargetOpener["Service"], "open">,
): TargetOpenGesture {
  return openGesture(opener, (open) => registry.set(openTargetCommand, open));
}
