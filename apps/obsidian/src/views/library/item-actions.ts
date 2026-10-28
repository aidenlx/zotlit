// What the Library View does with the Item of a row: the operations its keys,
// its row menu and its drag run. Each runs the operation another surface
// runs: the quick switcher's note and PDF opens, the citation insert of the
// "Insert Markdown citation" command, and the `zotero://select` link of the
// citation popover.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import type { Scope } from "effect";
import { Cause, Effect, Exit } from "effect";
import type { Editor, MarkdownFileInfo, PaneType } from "obsidian";

import { itemSelectUri, parseIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier, reportOutcome } from "@/lib/notifier";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import type { AttachmentOpenDeps } from "@/services/attachment-open/actions";
import { pdfPickerReader } from "@/services/attachment-open/actions";
import { literatureNoteAttachments } from "@/services/attachment-open/literature-note";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import { openLiteratureNote } from "@/services/note-feature/navigation";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { InertTemplateError } from "@/services/template/errors";
import { UseLedger } from "@/services/use-ledger/service";
import { readActionItem } from "@/services/zotero-reads/read-item";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { getInsertionEditor } from "@/views/annot-view/drag-insert";
import { viewTargetOpener } from "@/views/open-target";

import { lastEditor } from "./last-note";

export const libraryItemCommand = viewRuntime.fn(
  (request: {
    readonly effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>;
    readonly result: PromiseWithResolvers<void>;
  }) =>
    request.effect.pipe(
      Effect.scoped,
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            request.result.reject(Cause.squash(exit.cause));
          else request.result.resolve();
        }),
      ),
    ),
  { concurrent: true },
);

export type ItemActionsDeps = Pick<AttachmentOpenDeps, "app" | "opener"> & {
  registry: ViewRegistryHandle;
  noteFeature: Pick<NoteFeatureHandle, "renderCitation">;
  creation: InteractiveCreationPorts;
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
  const run = (
    effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>,
  ): Promise<void> => {
    const result = Promise.withResolvers<void>();
    deps.registry.set(libraryItemCommand, { effect, result });
    return result.promise;
  };
  const resolveCitation = (item: Item) =>
    Effect.gen(function* () {
      const citationKey =
        "citationKey" in item.fields ? item.fields.citationKey : null;
      const notice = (message: string) => ({
        kind: "notice" as const,
        message,
      });
      if (!citationKey) return notice(m.notice_no_citekey({ key: item.key }));
      const lookup = yield* CitationLookup;
      if ((yield* lookup.current).status === "pending")
        return notice(m.notice_citekey_not_ready());
      const answer = yield* lookup
        .read({ citekeys: [citationKey] })
        .pipe(Effect.option);
      if (answer._tag === "None") return notice(m.notice_citekey_not_ready());
      if (answer.value.resolve(citationKey).kind === "ambiguous")
        return notice(
          m.notice_citekey_ambiguous_insert({ citekey: citationKey }),
        );
      const rendered = yield* Effect.sync(() => {
        try {
          return deps.noteFeature.renderCitation(
            [{ citationKey, item }],
            "main",
          );
        } catch (error) {
          if (error instanceof InertTemplateError) return notice(error.message);
          throw error;
        }
      });
      if (rendered === null) return notice(m.notice_template_not_ready());
      return typeof rendered === "string"
        ? { kind: "insert" as const, text: rendered }
        : rendered;
    });
  return {
    openNote: (indexedKey, pane) =>
      run(
        Effect.asVoid(
          openLiteratureNote(deps.creation, indexedKey, {
            source: "interactive",
            paneType: pane,
          }),
        ),
      ),
    openPdf: (indexedKey, pane) =>
      run(
        Effect.gen(function* () {
          const attachments = yield* literatureNoteAttachments(indexedKey);
          openAttachments(attachments, {
            reader: withFixedPane(
              pdfPickerReader(viewTargetOpener(deps.registry, deps.opener)),
              pane,
            ),
            app: deps.app,
          });
        }),
      ),
    insertCitation: (indexedKey, target) =>
      run(
        Effect.gen(function* () {
          const into = target ?? editorTarget(deps);
          if (!into) {
            yield* Notifier.use((notifier) =>
              notifier.show(m.library_view_cite_no_note()),
            );
            return;
          }
          const { editor, info } = into;
          const file = info.file;
          const at = into.at;
          const insertion = yield* Effect.acquireDisposable(
            Effect.sync(() =>
              captureInsertion({
                editor,
                info,
                ...(at !== undefined && { range: { from: at, to: at } }),
                isCurrent: () => info.file === file && info.editor === editor,
                workspace: deps.app.workspace,
              }),
            ),
          );
          const item = yield* readActionItem(indexedKey);
          if (!item) return;
          const outcome = yield* resolveCitation(item);
          if (outcome.kind === "notice") {
            yield* Notifier.use((notifier) => notifier.show(outcome.message));
            return;
          }
          if (
            outcome.text.length > 0 &&
            insertion.commit(outcome.text, { kind: "citation" })
          )
            yield* (yield* UseLedger).record(indexedKey, "cited");
        }),
      ),
    copyCitationKey: (indexedKey) =>
      run(
        Effect.gen(function* () {
          const item = yield* readActionItem(indexedKey);
          if (!item) return;
          const citationKey =
            "citationKey" in item.fields ? item.fields.citationKey : null;
          if (!citationKey) {
            yield* Notifier.use((notifier) =>
              notifier.show(m.notice_no_citekey({ key: item.key })),
            );
            return;
          }
          const copied = yield* Effect.exit(
            Effect.tryPromise(() => navigator.clipboard.writeText(citationKey)),
          );
          yield* reportOutcome(copied, {
            success: () => m.graph_citations_citekey_copied(),
            error: () => m.graph_citations_citekey_copy_failed(),
          });
          if (Exit.isSuccess(copied))
            yield* (yield* UseLedger).record(indexedKey, "cited");
        }),
      ),
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
