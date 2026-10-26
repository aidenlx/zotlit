// What the Library View does with the Item of a row: the operations its keys,
// its row menu and its drag run. Each runs the operation another surface
// runs: the quick switcher's note and PDF opens, the citation insert of the
// "Insert Markdown citation" command, and the `zotero://select` link of the
// citation popover.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import type { Scope } from "effect";
import { Cause, Effect, Exit } from "effect";
import { MarkdownView } from "obsidian";
import type { Editor, MarkdownFileInfo, PaneType, TFile } from "obsidian";

import { itemSelectUri, parseIndexedKey } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { AbortError } from "@/lib/abort-error";
import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import type { AttachmentOpenDeps } from "@/services/attachment-open/actions";
import { pdfPickerReader } from "@/services/attachment-open/actions";
import { literatureNoteAttachments } from "@/services/attachment-open/literature-note";
import type {
  TargetOpener,
  OpenOutcome,
} from "@/services/attachment-open/open-target";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";
import { NoteIndex } from "@/services/note-index/service";
import { InertTemplateError } from "@/services/template/errors";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { getInsertionEditor } from "@/views/annot-view/drag-insert";

import { lastEditor } from "./last-note";

export const libraryItemCommand = viewRuntime.fn(
  (request: {
    readonly effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>;
    readonly result: PromiseWithResolvers<void>;
  }) =>
    request.effect.pipe(
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

export const openLibraryTargetCommand = viewRuntime.fn(
  (request: {
    readonly opener: Pick<TargetOpener, "open">;
    readonly args: Parameters<TargetOpener["open"]>;
    readonly result: PromiseWithResolvers<OpenOutcome>;
  }) =>
    Effect.tryPromise(() => request.opener.open(...request.args)).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit))
            request.result.reject(
              Cause.hasInterruptsOnly(exit.cause)
                ? new AbortError()
                : Cause.squash(exit.cause),
            );
          else request.result.resolve(exit.value);
        }),
      ),
    ),
  { concurrent: true },
);

export function libraryTargetOpener(
  registry: ViewRegistryHandle,
  opener: Pick<TargetOpener, "open">,
): Pick<TargetOpener, "open"> {
  return {
    open: (...args) => {
      const result = Promise.withResolvers<OpenOutcome>();
      registry.set(openLibraryTargetCommand, { opener, args, result });
      return result.promise;
    },
  };
}

export type ItemActionsDeps = Pick<AttachmentOpenDeps, "app" | "opener"> & {
  registry: ViewRegistryHandle;
  noteFeature: Pick<
    NoteFeatureHandle,
    "createNoteInteractively" | "renderCitation"
  >;
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
  const run = (
    effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>,
  ): Promise<void> => {
    const result = Promise.withResolvers<void>();
    deps.registry.set(libraryItemCommand, { effect, result });
    return result.promise;
  };
  const read = (
    indexedKey: string,
  ): Effect.Effect<Item | null, never, ZoteroReads> =>
    Effect.gen(function* () {
      const snapshot = yield* (yield* ZoteroReads).snapshot;
      const items = yield* snapshot.ItemsByIndexedKeys({
        indexedKeys: [indexedKey],
      });
      return items.get(indexedKey) ?? null;
    }).pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning("The Library View could not read an Item", {
            indexedKey,
            error,
          }),
        Effect.succeed(null),
      ),
      withLogCategory("library-view", "item-actions"),
    );

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
  const openNote = async (
    file: TFile,
    pane: PaneType | boolean,
  ): Promise<void> => {
    const { workspace } = deps.app;
    if (!pane) {
      const existing = workspace
        .getLeavesOfType("markdown")
        .find(
          (leaf) =>
            leaf.view instanceof MarkdownView && leaf.view.file === file,
        );
      if (existing) {
        await workspace.revealLeaf(existing);
        workspace.setActiveLeaf(existing, { focus: true });
        return;
      }
    }
    await workspace.openLinkText(file.path, "", pane, { active: true });
  };

  return {
    openNote: (indexedKey, pane) =>
      run(
        Effect.gen(function* () {
          const index = yield* NoteIndex;
          yield* index.whenIndexed;
          const existing = resolveLiteratureNoteWithWarning(
            yield* index.getNotesByItemKey(indexedKey),
          );
          if (existing) {
            yield* Effect.tryPromise(() => openNote(existing, pane));
            return;
          }
          const item = yield* read(indexedKey);
          if (item) {
            const file = yield* Effect.tryPromise(() =>
              deps.noteFeature.createNoteInteractively(item),
            );
            if (file) yield* Effect.tryPromise(() => openNote(file, pane));
          }
        }),
      ),
    openPdf: (indexedKey, pane) =>
      run(
        Effect.gen(function* () {
          const attachments = yield* literatureNoteAttachments(indexedKey);
          openAttachments(attachments, {
            reader: withFixedPane(
              pdfPickerReader(libraryTargetOpener(deps.registry, deps.opener)),
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
            deps.notify(m.library_view_cite_no_note());
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
          const item = yield* read(indexedKey);
          if (!item) return;
          const outcome = yield* resolveCitation(item);
          if (outcome.kind === "notice") {
            deps.notify(outcome.message);
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
          const item = yield* read(indexedKey);
          if (!item) return;
          const citationKey =
            "citationKey" in item.fields ? item.fields.citationKey : null;
          if (!citationKey) {
            deps.notify(m.notice_no_citekey({ key: item.key }));
            return;
          }
          const copied = yield* Effect.tryPromise(() =>
            toast.promise(navigator.clipboard.writeText(citationKey), {
              success: m.graph_citations_citekey_copied(),
              error: m.graph_citations_citekey_copy_failed(),
              swallowError: false,
            }),
          ).pipe(
            Effect.match({ onFailure: () => false, onSuccess: () => true }),
          );
          if (copied) yield* (yield* UseLedger).record(indexedKey, "cited");
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
