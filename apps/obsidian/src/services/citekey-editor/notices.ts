// UI seam for the citekey editor service: one notice per event it reports.
import { Effect, Layer } from "effect";

import { filterTag, forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { CitekeyEditor } from "./service";

/** Render citekey editor service events at the Obsidian UI seam. */
export const layerCitekeyEditorNotices = Layer.effectDiscard(
  Effect.gen(function* () {
    const editor = yield* CitekeyEditor;
    yield* forkEach(
      filterTag(
        editor.events,
        "db-unavailable",
        "citekey-not-found",
        "item-unavailable",
      ),
      (event) => {
        switch (event._tag) {
          case "db-unavailable":
            new BaseNotice(
              m.notice_citekey_db_unavailable({ citekey: event.citekey }),
            );
            return;
          case "citekey-not-found":
            new BaseNotice(
              m.notice_citekey_not_found({ citekey: event.citekey }),
            );
            return;
          case "item-unavailable":
            new BaseNotice(
              event.reason === "database"
                ? m.citation_popover_database_unavailable()
                : m.citation_popover_item_unavailable(),
            );
            return;
        }
      },
    );
  }),
);
