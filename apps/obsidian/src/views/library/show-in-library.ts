// Show in Library as one tag, so a view, a popover or a command opens the
// Library View on an Item without holding the Obsidian App. The layer sits
// beside `showInLibrary` in `register.ts`; this module stays free of the view.
import { Context } from "effect";
import type { Effect } from "effect";

export class ShowInLibrary extends Context.Service<
  ShowInLibrary,
  {
    /**
     * Open the Library View on the Item `indexedKey`, selected in its first
     * Collection; a notice tells the researcher when the row is not listed.
     */
    show(indexedKey: string): Effect.Effect<void>;
  }
>()("zotlit/library-view/ShowInLibrary") {}
