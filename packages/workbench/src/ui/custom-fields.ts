// The custom fields of the Zotero source, which an expression editor offers
// quoted inside `custom[...]`: one interruptible read for every host.
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useWorkbenchModel } from "./editor";

const NONE: readonly string[] = [];

/**
 * The names of the source's custom fields, read through the editor's model
 * for each `revision`. Unmounting the editor, or a new revision, interrupts
 * the read. None while a read runs, and none from a read that fails.
 * @param revision Changes when the source may name other fields.
 */
export function useCustomFieldNames(revision: string): readonly string[] {
  const result = useAtomValue(useWorkbenchModel().customFields(revision));
  // Without the names, `custom[` offers none.
  return AsyncResult.isSuccess(result) ? result.value : NONE;
}
