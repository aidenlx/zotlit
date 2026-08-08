import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import type { CitekeyClick } from "./service";

/** Render Citation Key Links service events at the Obsidian UI seam. */
export function registerCitationKeyLinkNotices(
  service: CitekeyClick,
): () => void {
  return service.on("missing-property", (property) => {
    new BaseNotice(m.notice_citation_key_property_missing({ property }));
  });
}
