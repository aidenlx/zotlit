// UI seam for the citekey editor service: one notice per event it reports.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import type { CitekeyEditor } from "./service";

/** Render citekey editor service events at the Obsidian UI seam. */
export function registerCitekeyEditorNotices(
  service: CitekeyEditor,
): () => void {
  const stack = new DisposableStack();
  stack.defer(
    service.on("missing-property", (property) => {
      new BaseNotice(m.notice_citation_key_property_missing({ property }));
    }),
  );
  stack.defer(
    service.on("db-unavailable", (citekey) => {
      new BaseNotice(m.notice_citekey_db_unavailable({ citekey }));
    }),
  );
  stack.defer(
    service.on("citekey-not-found", (citekey) => {
      new BaseNotice(m.notice_citekey_not_found({ citekey }));
    }),
  );
  return () => stack.dispose();
}
