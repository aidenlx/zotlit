import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { type CitekeyEditor } from "./service";

/** Render citekey editor service events at the Obsidian UI seam. */
export function registerCitekeyEditorNotices(
  service: CitekeyEditor,
): () => void {
  return service.on("missing-property", (property) => {
    new BaseNotice(m.notice_citation_key_property_missing({ property }));
  });
}
