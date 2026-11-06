// The custom fields of the Zotero source, which an expression editor offers
// quoted inside `custom[...]`: one interruptible read for every host.
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useMemo } from "react";

import { useWorkbenchModel } from "./editor";

const NONE: readonly string[] = [];

/**
 * The names of the source's custom fields, read by `read` on the editor's
 * runtime each time `reading` turns true, `read` changes or `revision` does;
 * turning `reading` false or unmounting the editor interrupts the read. None
 * while a read runs, and none from a read that fails.
 * @param read Keeps one identity while the source stays.
 * @param options.revision Changes when the source may name other fields.
 */
export function useCustomFieldNames(
  read: Effect.Effect<readonly string[], unknown>,
  {
    reading = true,
    revision,
  }: {
    reading?: boolean | undefined;
    revision?: unknown;
  } = {},
): readonly string[] {
  const { runtime } = useWorkbenchModel();
  const names = useMemo(
    () => runtime.atom(reading ? read : Effect.succeed(NONE)),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new `revision` reads again
    [runtime, read, reading, revision],
  );
  const result = useAtomValue(names);
  // Without the names, `custom[` offers none.
  return AsyncResult.isSuccess(result) ? result.value : NONE;
}
