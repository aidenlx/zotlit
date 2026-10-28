// The custom fields of the Zotero source, which an expression editor offers
// quoted inside `custom[...]`: one interruptible read for every host.
import type { Effect } from "effect";
import { useState } from "react";

import { useForkedEffect } from "./run";
import type { WorkbenchRunner } from "./run";

/**
 * The names of the source's custom fields, read by `read` on `run` each time
 * `reading` turns true, `read` changes or `revision` does; turning `reading`
 * false or unmounting the editor interrupts the read. None until the first
 * read answers, and none from a read that fails.
 * @param read Keeps one identity while the source stays.
 * @param options.revision Changes when the source may name other fields.
 */
export function useCustomFieldNames(
  read: Effect.Effect<readonly string[], unknown>,
  {
    run,
    reading = true,
    revision,
  }: {
    run: WorkbenchRunner;
    reading?: boolean | undefined;
    revision?: unknown;
  },
): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  useForkedEffect(run, () => (reading ? read : null), {
    deps: [read, reading, revision],
    onSuccess: setNames,
    // Without the names, `custom[` offers none.
  });
  return names;
}
