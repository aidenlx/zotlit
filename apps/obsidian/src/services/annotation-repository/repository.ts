// The Annotations of one Attachment, read from one Annotation Source at a time.
import {
  cancelAllTextSaves,
  cancelTextSave,
  setDraft,
} from "./core/draft-store";
import {
  annotationState,
  discardTagDraft,
  discardTextDraft,
  editTags,
  editTextField,
  retryTextDraft,
  submitTags,
  submitTextField,
  tagDraftFor,
  textDraftFor,
} from "./core/drafts";
import { capabilityFor } from "./core/lists";
import type { AnnotationState, TagDraft, TextFieldDraft } from "./core/model";
import type { CoreState } from "./core/state";
import { TEXT_FIELDS } from "./write";
import type { MutationState, TextField } from "./write";
export type { CreateOutcome, WriteReadError } from "./core/writes";
export { WriteRunFailed } from "./core/writes";
export {
  UNHELD_RETENTION,
  LocalApiReadFailed,
  AnnotationLibraryUnresolved,
} from "./core/lists";
export type {
  DatabaseAnnotationSource,
  AnnotationSource,
  AnnotationRecord,
  AnnotationList,
  TextFieldDraftState,
  TextFieldDraft,
  TagDraftState,
  TagDraft,
  AnnotationState,
  AnnotationRepositoryEvent,
  AnnotationRepositoryCoreDeps,
} from "./core/model";

export type { EditingCapability } from "./capability";
export type { AnnotationLock, LockReason } from "./lock";
export type {
  HistoryDirection,
  HistoryEditKind,
  HistoryOutcome,
  HistoryStep,
} from "./history";
export type {
  AnnotationDraft,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteConflict,
  WriteFailure,
} from "./write";

/**
 * Answers an Attachment's Annotations from the Annotation Source that is active
 * for it, and says which source answered. Reads are held on the plugin-wide
 * query client, so the overlay and the Annotation View asking for one Attachment
 * at once cost one database read.
 *
 * It is also the one write path. A command takes Indexed Keys alone: the record
 * the active source answered supplies the version the write sends as its
 * precondition, and a record with no version — the Zotero DB source's — refuses
 * the write before any request. Each write is a mutation on the plugin-wide
 * query client, run one at a time per Annotation, and its variables are its
 * Pending Proposal: every list this repository publishes draws the proposal in
 * place of the confirmed fields until the write settles, and the query cache
 * behind it keeps the confirmed record every write, conflict, and History Step
 * is decided against.
 *
 * The Zotero DB partition is dropped wholesale whenever the database refreshes,
 * and the Zotero Local API partition whenever that source moves — a Freshness
 * Signal, another Zotero database, a capability that changed. Every Attachment
 * the drop concerns is announced through `annotations-changed`, which is the
 * only signal that a list was superseded, and read again here, so the pixels
 * such a change moved are announced even with no surface mounted to ask.
 *
 * A surface holds the lists it shows through {@link AnnotationRepository.hold}
 * and reads them through {@link AnnotationRepository.read}: the reads it asks
 * in one task the Zotero DB source answers in one batch read. A list no surface
 * holds any more is let go, so a view over a whole Library leaves nothing
 * behind.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md
 */
export class AnnotationRepositoryCore implements AsyncDisposable {
  readonly #core: CoreState;
  readonly #stack = new AsyncDisposableStack();

  constructor(core: CoreState) {
    this.#core = core;
    this.#stack.defer(
      core.bridge.subscribe(core.localApi.capabilityChanges, () => {
        for (const field of TEXT_FIELDS) {
          const drafts = core.drafts[field];
          for (const [id, draft] of drafts) {
            if (
              core.bridge.runSync(capabilityFor(core, draft.attachmentKey))
                .kind === "writable"
            )
              continue;
            cancelTextSave(core, field, draft);
            drafts.set(id, { ...draft, manualSave: true });
            core.publish({
              _tag: "annotation-changed",
              annotationKey: draft.annotationKey,
            });
          }
        }
        // A tag draft has no timer or queued save to cancel, unlike a text
        // draft, so one already held needs no second event.
        for (const draft of core.drafts.tags.values()) {
          if (
            draft.manualSave ||
            core.bridge.runSync(capabilityFor(core, draft.attachmentKey))
              .kind === "writable"
          )
            continue;
          setDraft(core, "tags", { ...draft, manualSave: true });
        }
        core.publish({ _tag: "capability-changed" });
      }),
    );
    this.#stack.defer(() => cancelAllTextSaves(core));
    this.#stack.defer(() => {
      core.commandGeneration += 1;
    });
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.#stack.disposeAsync();
  }

  annotationState(annotationKey: string): AnnotationState {
    return annotationState(this.#core, annotationKey);
  }

  textDraftFor(field: TextField, annotationKey: string): TextFieldDraft | null {
    return textDraftFor(this.#core, field, annotationKey);
  }

  editTextField(
    field: TextField,
    annotationKey: string,
    text?: string,
  ): TextFieldDraft | null {
    return editTextField(this.#core, field, annotationKey, text);
  }

  submitTextField(
    field: TextField,
    annotationKey: string,
    options: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    return submitTextField(this.#core, field, annotationKey, options);
  }

  discardTextDraft(field: TextField, annotationKey: string): void {
    return discardTextDraft(this.#core, field, annotationKey);
  }

  retryTextDraft(
    field: TextField,
    annotationKey: string,
  ): Promise<MutationState> {
    return retryTextDraft(this.#core, field, annotationKey);
  }

  tagDraftFor(annotationKey: string): TagDraft | null {
    return tagDraftFor(this.#core, annotationKey);
  }

  editTags(annotationKey: string, names?: readonly string[]): TagDraft | null {
    return editTags(this.#core, annotationKey, names);
  }

  submitTags(
    annotationKey: string,
    options: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    return submitTags(this.#core, annotationKey, options);
  }

  discardTagDraft(annotationKey: string): void {
    return discardTagDraft(this.#core, annotationKey);
  }
}
