// What the Library View does with the Item of a row: the operations its keys,
// its row menu and its drag run. Each runs the operation another surface
// runs: the quick switcher's note and PDF opens, the citation insert of the
// "Insert Markdown citation" command, and the `zotero://select` link of the
// citation popover.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import type { Editor, MarkdownFileInfo, PaneType } from "obsidian";

import { itemSelectUri, parseIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import * as toast from "@/lib/toast";
import type { AttachmentOpenLookupDeps } from "@/services/attachment-open/actions";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { getInsertionEditor } from "@/views/annot-view/drag-insert";
import {
  padCitationInsert,
  resolveCitationInsert,
} from "@/views/citation-suggest/editor-suggest";
import type { CitationSuggestDeps } from "@/views/citation-suggest/register";
import {
  openItemPdf,
  openOrCreateNote,
} from "@/views/quick-switch/result-actions";
import type { NoteResultDeps } from "@/views/quick-switch/result-actions";

import { lastEditor } from "./last-note";

const logger = getLogger(["library-view", "item-actions"]);

export type ItemActionsDeps = NoteResultDeps &
  AttachmentOpenLookupDeps &
  Pick<CitationSuggestDeps, "citationLookup"> & {
    noteFeature: CitationSuggestDeps["noteFeature"];
    /** Show a short message to the researcher. */
    notify: (message: string) => void;
    /**
     * Hands a `zotero://` link to the system.
     * @default window.open
     */
    openUri?: (uri: string) => void;
  };

/** Where a citation goes: an editor, at its selection or at `at`. */
export interface CitationTarget {
  editor: Editor;
  info: MarkdownFileInfo;
  /** The offset to insert at; the editor's selection where absent. */
  at?: number;
}

/** What a row of the Library View can do with its Item, by Indexed Key. */
export interface ItemActions {
  /** Open the Literature Note, or write it through the Profile selection. */
  openNote(indexedKey: string, pane: PaneType | boolean): Promise<void>;
  /** Open the PDF in Obsidian. */
  openPdf(indexedKey: string, pane: PaneType | boolean): Promise<void>;
  /** Insert the Item's citation into `target`, or the note the researcher was last in. */
  insertCitation(indexedKey: string, target?: CitationTarget): Promise<void>;
  copyCitationKey(indexedKey: string): Promise<void>;
  /** Select the Item in Zotero, which the system starts where it is closed. */
  showInZotero(indexedKey: string): void;
}

export function itemActions(deps: ItemActionsDeps): ItemActions {
  const read = async (indexedKey: string): Promise<Item | null> => {
    try {
      await using lease = await deps.reads.acquireRead();
      const items = await Effect.runPromise(
        lease.reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
      );
      return items.get(indexedKey) ?? null;
    } catch (error) {
      logger.warn("The Library View could not read an Item", {
        indexedKey,
        error,
      });
      return null;
    }
  };

  return {
    openNote: (indexedKey, pane) =>
      openOrCreateNote(deps, {
        indexedKey,
        item: () => read(indexedKey),
        newPane: pane,
      }),
    openPdf: (indexedKey, pane) => openItemPdf(deps, indexedKey, pane),
    insertCitation: async (indexedKey, target) => {
      const into = target ?? editorTarget(deps);
      if (!into) {
        deps.notify(m.library_view_cite_no_note());
        return;
      }
      const { editor, info } = into;
      const file = info.file;
      const at = into.at;
      using insertion = captureInsertion({
        editor,
        info,
        ...(at !== undefined && { range: { from: at, to: at } }),
        isCurrent: () => info.file === file && info.editor === editor,
      });
      const { doc, selection } = editor.cm.state;
      const start = at ?? selection.main.from;
      const end = at ?? selection.main.to;
      // The characters around the insert, so the citation sticks to neither.
      const around = {
        previous:
          start === doc.lineAt(start).from
            ? ""
            : doc.sliceString(start - 1, start),
        next: doc.sliceString(end, end + 1),
      };
      const item = await read(indexedKey);
      if (!item) return;
      const outcome = await resolveCitationInsert(deps, { item }, "main");
      if (outcome.kind === "notice") {
        deps.notify(outcome.message);
        return;
      }
      insertion.commit(padCitationInsert(outcome.text, around).text);
    },
    copyCitationKey: async (indexedKey) => {
      const item = await read(indexedKey);
      if (!item) return;
      const citationKey =
        "citationKey" in item.fields ? item.fields.citationKey : null;
      if (!citationKey) {
        deps.notify(m.notice_no_citekey({ key: item.key }));
        return;
      }
      await toast.promise(navigator.clipboard.writeText(citationKey), {
        success: m.graph_citations_citekey_copied(),
        error: m.graph_citations_citekey_copy_failed(),
      });
    },
    showInZotero: (indexedKey) => {
      const parsed = parseIndexedKey(indexedKey);
      if (!parsed) return;
      (deps.openUri ?? ((uri) => window.open(uri)))(
        itemSelectUri(parsed.key, parsed.groupID),
      );
    },
  };
}

/**
 * The note the researcher was last in: the one an annotation insert finds,
 * else, while the Library View is the active tab, the note in Source mode
 * or Live Preview that was active last.
 */
function editorTarget({
  app,
}: Pick<ItemActionsDeps, "app">): CitationTarget | null {
  const info = getInsertionEditor(app) ?? lastEditor(app.workspace);
  if (!info?.file || !info.editor) return null;
  return { editor: info.editor, info };
}
