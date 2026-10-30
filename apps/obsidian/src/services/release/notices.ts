// UI seam for the release check: the Notice that points a Zotero 10 upgrade
// at the Release Note and the ZotLit Companion installation guide.

import { Effect } from "effect";

import { DOCS_COMPANION } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { Notifier } from "@/lib/notifier";

interface CompanionNoticeAction {
  label: string;
  run: () => void;
}

interface CompanionNoticeCopy {
  title: string;
  /** The notice's buttons, in display order. */
  actions: readonly CompanionNoticeAction[];
}

/** The copy of the Companion notice, with each action bound to what it opens. */
export function companionNotice(options: {
  openReleaseNote: () => void;
}): CompanionNoticeCopy {
  return {
    title: m.companion_zotero_10_guidance(),
    actions: [
      { label: m.notice_update_see_whats_new(), run: options.openReleaseNote },
      {
        label: m.notice_companion_install_action(),
        run: () => {
          window.open(DOCS_COMPANION);
        },
      },
    ],
  };
}

/** Show the Companion notice until the user closes it. */
export const showCompanionNotice = Effect.fn("Release.showCompanionNotice")(
  function* (copy: CompanionNoticeCopy) {
    const notifier = yield* Notifier;
    return yield* notifier.show(
      BaseNotice.render((renderer) => {
        renderer.setTitle(copy.title);
        for (const action of copy.actions) {
          renderer.addAction((button) => {
            button.setButtonText(action.label).onClick(action.run);
          });
        }
      }),
      { duration: 0 },
    );
  },
);
