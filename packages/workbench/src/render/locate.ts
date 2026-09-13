import type { RenderCallerSource } from "./attribution";
import type { RenderDiagnostic } from "./result";

// Retained repair targets are re-read against the source the reader edits now.
import { templateCalls } from "#/document/regions";

/** Re-finds a verified call, keeping the missing-partial first-call exception. */
export function currentCallSite(
  diagnostic: RenderDiagnostic,
  caller: RenderCallerSource,
): RenderDiagnostic["callSite"] {
  if (diagnostic.callSite === undefined) return undefined;
  const target =
    diagnostic.code === "missing-partial"
      ? diagnostic.params?.name
      : diagnostic.engine?.template;
  if (target === undefined) return undefined;
  const calls = templateCalls(
    caller.source,
    { from: 0, to: caller.source.length },
    caller.language,
  ).filter(({ name }) => name === String(target));
  return diagnostic.code === "missing-partial" || calls.length === 1
    ? calls[0]?.call
    : undefined;
}
