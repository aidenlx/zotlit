// The custom fields of the Zotero source, which an expression editor offers
// quoted inside `custom[...]`: one abortable read for every host.
import { useEffect, useState } from "react";

/**
 * The names of the source's custom fields, read by `read` each time
 * `reading` turns true, `read` changes or `revision` does; a read stops when
 * `reading` turns false or the editor unmounts. None until the first read
 * answers, and none from a read that fails.
 * @param read Keeps one identity while the source stays.
 * @param options.revision Changes when the source may name other fields.
 */
export function useCustomFieldNames(
  read: (signal: AbortSignal) => Promise<readonly string[]>,
  {
    reading = true,
    revision,
  }: { reading?: boolean | undefined; revision?: unknown } = {},
): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!reading) return;
    const controller = new AbortController();
    read(controller.signal).then(
      (answer) => {
        if (!controller.signal.aborted) setNames(answer);
      },
      // Without the names, `custom[` offers none.
      () => {},
    );
    return () => controller.abort();
  }, [read, reading, revision]);
  return names;
}
