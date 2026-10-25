// The Effect service over the Annotation Repository core.
import { Clock, Context, Effect, Layer, PubSub, Stream } from "@/lib/effect";
import { scopedBridge } from "@/lib/effect-bridge";
import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { filterTag } from "@/lib/effect-stream";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import { savedExcerptRequestOver } from "@/services/excerpt-image/request";
import type { Held } from "@/services/query-client/service";
import { QueryClients } from "@/services/query-client/service";
import { localApiPort } from "@/services/zotero-local-api/port";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { AnnotationRepositoryCore } from "./repository";
import type {
  AnnotationDraft,
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryCoreDeps,
  AnnotationRepositoryEvent,
  AnnotationSource,
  AnnotationState,
  CreateOutcome,
  EditingCapability,
  GeometryEdit,
  GeometryInput,
  HistoryOutcome,
  MutationState,
  TagDraft,
  TextField,
  TextFieldDraft,
} from "./repository";

export * from "./repository";

export type AnnotationRepositoryShape = {
  /**
   * @param attachmentKey the Attachment's Indexed Key.
   * @returns the list that stands, with the Pending Proposal of each write in
   *   flight drawn over it, or null while no read has answered for it.
   */
  read(attachmentKey: string): Effect.Effect<AnnotationList | null>;
  /**
   * Keeps the lists of these Attachments published while a surface shows
   * them: a database change reads them again, and a write finds their
   * records. Disposing the hold lets each list go once no other surface holds
   * it, and the next surface that holds it again gets a fresh read.
   *
   * @param attachmentKeys the Attachments' Indexed Keys.
   */
  hold(attachmentKeys: Iterable<string>): Effect.Effect<Disposable>;
  /**
   * Revalidates one Attachment through its active source. Concurrent surfaces
   * join the same operation, while the Held Read keeps their published list.
   */
  refresh(attachmentKey: string): Effect.Effect<AnnotationList | null>;
  /**
   * What `attachmentKey` holds right now, for a caller that cannot wait — a
   * surface redrawing synchronously. The Held Read travels whole, so the caller
   * can tell a list that stands from one a refresh has already superseded.
   *
   * @returns null while no read has answered for the Attachment.
   */
  peek(attachmentKey: string): Effect.Effect<Held<AnnotationList> | null>;
  /**
   * What a surface may do to one Attachment's Annotations: the Capability
   * Probe, plus what the write path learned about this Attachment's library and
   * about the authorization gesture in flight.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  capabilityFor(attachmentKey: string): Effect.Effect<EditingCapability>;
  /**
   * What the session itself may do, with no Attachment in hand — what the
   * "Zotero editing" settings row shows. A library Zotero refuses writes to is
   * a fact about one Attachment and has no place here.
   */
  readonly capability: Effect.Effect<EditingCapability>;
  /**
   * Re-check Zotero now, from a user gesture: the Editing Capability
   * affordance's click, and a keystroke that met a block. A probe that changes
   * anything announces itself through `capability-changed`.
   */
  probe(): Effect.Effect<void>;
  /**
   * What a write left on one Annotation, for the card that draws its verbs:
   * `pending` from the moment a write is asked for until the last write queued
   * on it settles, then the latest failure or conflict left standing.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  mutationFor(annotationKey: string): Effect.Effect<MutationState>;
  /**
   * Everything the repository holds about one Annotation beside its record.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  annotationState(annotationKey: string): Effect.Effect<AnnotationState>;
  /**
   * The active Zotero database's shared draft of one text field of an
   * Annotation: its comment or its Quoted Text.
   */
  textDraftFor(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<TextFieldDraft | null>;
  /**
   * Start or update one shared text field draft: a comment edit, or a Text
   * Edit on the Quoted Text. Without `text`, the draft starts from the
   * confirmed value, or stays as it stands.
   *
   * @returns the draft, or `null` where none can start.
   */
  editTextField(
    field: TextField,
    annotationKey: string,
    text?: string,
  ): Effect.Effect<TextFieldDraft | null>;
  /** Submit one text field's current shared draft once. */
  submitTextField(
    field: TextField,
    annotationKey: string,
    options?: { automatic?: boolean },
  ): Effect.Effect<MutationState>;
  /** Keep Zotero's reviewed value of one text field and discard the draft. */
  discardTextDraft(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<void>;
  /** Apply one text field's shared draft again against the reviewed fresh record. */
  retryTextDraft(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<MutationState>;
  /** The active Zotero database's shared tag draft for one Annotation. */
  tagDraftFor(annotationKey: string): Effect.Effect<TagDraft | null>;
  /**
   * Start or update one tag editing session. A session starts from the
   * confirmed names and only while editing is available. A draft whose save
   * is in flight stays as it is, because the editor is saving.
   *
   * @param names the editor's current names; left out, the session starts or
   *   stays as it is.
   */
  editTags(
    annotationKey: string,
    names?: readonly string[],
  ): Effect.Effect<TagDraft | null>;
  /**
   * Save one tag editing session: one write that applies the session's added
   * and removed names to the tags Zotero holds now. A session that changed
   * nothing ends with no write. The draft stays, `pending`, until the
   * Annotation is read back, and then goes, so the editor closes onto the
   * confirmed tags.
   *
   * A draft that is not saved — held for Save tags, blocked, or failed — is
   * marked `held`, since its editor has closed.
   *
   * @param options.automatic whether the editor closing asks, rather than
   *   Save tags. A draft that needs Save tags — editing unavailable, or a
   *   failed save — is then held, unsaved.
   * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
   */
  submitTags(
    annotationKey: string,
    options?: { automatic?: boolean },
  ): Effect.Effect<MutationState>;
  /** Drop a held tag draft and keep the tags Zotero holds. */
  discardTagDraft(annotationKey: string): Effect.Effect<void>;
  /**
   * Create one highlight or underline on an Attachment, from a user gesture.
   *
   * An explicit authorization must already be available. The write is a
   * one-element multi-object `POST` carrying a write token and no client key,
   * and its answer is checked object by object before the created Annotation
   * is read back.
   *
   * The Attachment's list is dropped rather than patched, because the list is
   * kept in Zotero's own reading order and only a fresh read can place a new
   * Annotation in it.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   * @param draft everything about the Annotation except its parent, which this
   *   Attachment names; its Sort Index was computed from the unrounded position.
   * @param options.group what joins this create to the others of one gesture in
   *   the Annotation History — one ink stroke split at the position ceiling
   *   creates several Annotations and is still one History Step. A create that
   *   names none is a step of its own.
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
    options?: { group?: string },
  ): Effect.Effect<CreateOutcome>;
  /**
   * Recolour one Annotation, of whatever type: Zotero's colour setter is one
   * rule for all six, so an ink stroke recolours like a highlight.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @param color the swatch to store, in any case; the write sends lower case.
   */
  patchColor(
    annotationKey: string,
    color: string,
  ): Effect.Effect<MutationState>;
  /**
   * Recolour a group of Annotations in Zotero, from one gesture on the Card
   * Selection. Each Annotation goes out as a request of its own and keeps its
   * own outcome, a Write Conflict included. The recolours that land are one
   * History Step, so one undo puts every colour back; a recolour that did not
   * land is not in it. A lock on one Annotation refuses the whole group, so
   * none goes out.
   *
   * @param annotationKeys Indexed Keys, in the order the step names them.
   * @param color the swatch to store, in any case; the write sends lower case.
   * @returns one outcome per key, in the order of `annotationKeys`.
   */
  patchColors(
    annotationKeys: readonly string[],
    color: string,
  ): Effect.Effect<MutationState[]>;
  /**
   * Replace one Annotation's comment. An empty string clears it.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  patchComment(
    annotationKey: string,
    comment: string,
  ): Effect.Effect<MutationState>;
  /**
   * Save one Geometry Edit: the new position, the Sort Index recomputed from
   * it, and for a highlight or underline the quoted text. The record Zotero
   * answers after the write is what the marks and cards draw next.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @param edit its Sort Index was computed from the unrounded position.
   * @param input what made the edit. A run of keyboard edits on one Annotation
   *   is one History Step; a pointer gesture is a step of its own.
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  patchGeometry(
    annotationKey: string,
    edit: GeometryEdit,
    input: GeometryInput,
  ): Effect.Effect<MutationState>;
  /**
   * Erase one Annotation in Zotero. The record leaves the Attachment's list
   * only once Zotero has answered, so the card and the Annotation Mark stand
   * until the delete is real.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  deleteAnnotation(annotationKey: string): Effect.Effect<MutationState>;
  /**
   * Erase a group of Annotations in Zotero, from one gesture on the Card
   * Selection. Each Annotation goes out as a request of its own and keeps its
   * own outcome, a Write Conflict included. The deletes that land are one
   * History Step, so one undo puts all of them back; a delete that did not
   * land is not in it. A lock on one Annotation refuses the whole group, so
   * none goes out and no draft of the group is ended.
   *
   * @param annotationKeys Indexed Keys, in the order the step names them.
   * @returns one outcome per key, in the order of `annotationKeys`.
   */
  deleteAnnotations(
    annotationKeys: readonly string[],
  ): Effect.Effect<MutationState[]>;
  /**
   * Send one conflicted write again, against the value Zotero holds now — the
   * card's "Apply again", and its "Delete anyway". The user has seen both
   * values by then, so this asks for the same change with the fresh version as
   * its precondition.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @returns what the second write left, which is `idle` where it landed and
   *   another conflict where Zotero moved again.
   */
  retryWrite(annotationKey: string): Effect.Effect<MutationState>;
  /**
   * Leave Zotero's copy as it stands, from the card's "Discard". The card goes
   * back to what the last read answered; nothing is sent.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  discardConflict(annotationKey: string): Effect.Effect<void>;
  /**
   * Open this Attachment's Annotation History, from one PDF view bound to it.
   * Every surface that writes through this repository records into the history
   * the Attachment already holds, so a second view of the same Attachment joins
   * this one rather than starting its own.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  openHistory(attachmentKey: string): Effect.Effect<void>;
  /**
   * Give up one PDF view's hold on this Attachment's Annotation History. The
   * last view to close ends the history, so an old session can never revert
   * today's work.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  closeHistory(attachmentKey: string): Effect.Effect<void>;
  /**
   * Whether this Attachment's Annotation History holds a step to undo, and
   * nothing standing turns that press away. The momentary guards — a write in
   * flight, an undo already running — are not read here, so a verb drawn from
   * this does not flicker under its own write. An open Annotation Draft on the
   * step's own Annotation is read, because it stands for as long as the
   * comment editor is open: a menu row drawn enabled under one would do
   * nothing, and say nothing.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  canUndo(attachmentKey: string): Effect.Effect<boolean>;
  /** Whether this Attachment's Annotation History holds a step to redo. */
  canRedo(attachmentKey: string): Effect.Effect<boolean>;
  /**
   * Step one confirmed edit back: the platform undo key, and the palette's
   * "Undo annotation change".
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  undo(attachmentKey: string): Effect.Effect<HistoryOutcome>;
  /** Step one undone edit forward again. */
  redo(attachmentKey: string): Effect.Effect<HistoryOutcome>;
  readonly annotationsChanged: Stream.Stream<string>;
  readonly excerptPixelsChanged: Stream.Stream<{
    record: AnnotationRecord;
    source: AnnotationSource;
  }>;
  readonly capabilityChanges: Stream.Stream<void>;
  readonly annotationChanged: Stream.Stream<string>;
  readonly historyChanged: Stream.Stream<string>;
  readonly writeConflicts: Stream.Stream<{
    annotationKey: string;
    attachmentKey: string;
  }>;
};

export class AnnotationRepository extends Context.Service<
  AnnotationRepository,
  AnnotationRepositoryShape
>()("zotlit/annotation-repository/AnnotationRepository") {}

export function layerAnnotationRepository(options: {
  readonly writeToken?: () => string;
}): Layer.Layer<
  AnnotationRepository,
  never,
  ExcerptImages | ZoteroReads | QueryClients | ZoteroLocalApi | ZoteroPref
> {
  return Layer.effect(
    AnnotationRepository,
    Effect.gen(function* () {
      const images = yield* ExcerptImages;
      const reads = yield* ZoteroReads;
      const queries = yield* QueryClients;
      const api = yield* ZoteroLocalApi;
      const pref = yield* ZoteroPref;
      const now = instantClock(yield* Clock.Clock);
      const bridge = yield* scopedBridge;
      const bus = yield* PubSub.unbounded<AnnotationRepositoryEvent>();
      yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
      const excerptRequest = savedExcerptRequestOver({ reads, pref, bridge });
      // A session's first read of an Attachment has no list that stood
      // before it to compare against, so it is compared against the image
      // this device persists for the Annotation instead — the display's own
      // stored-outcome read, so an Annotation this device never cached has
      // no baseline here exactly as it has no image to replace there.
      const persistedExcerpt: AnnotationRepositoryCoreDeps["persistedExcerpt"] =
        async (annotation, source) => {
          const request = await excerptRequest({ annotation, source });
          if (!request) return null;
          return (await images.stored(request))?.identity.fingerprint ?? null;
        };
      const core = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          Promise.resolve(
            new AnnotationRepositoryCore({
              bridge,
              db: reads,
              queryClient: queries,
              localApi: localApiPort(api, bridge),
              publish: (event) => {
                void PubSub.publishUnsafe(bus, event);
              },
              writeToken: options.writeToken,
              now,
              persistedExcerpt,
            }),
          ),
        ),
      );
      const events = Stream.fromPubSub(bus);
      const byTag = <T extends AnnotationRepositoryEvent["_tag"]>(tag: T) =>
        filterTag(events, tag);
      return AnnotationRepository.of({
        read: (attachmentKey) => Effect.promise(() => core.read(attachmentKey)),
        hold: (attachmentKeys) => Effect.sync(() => core.hold(attachmentKeys)),
        refresh: (attachmentKey) =>
          Effect.promise(() => core.refresh(attachmentKey)),
        peek: (attachmentKey) => Effect.sync(() => core.peek(attachmentKey)),
        capabilityFor: (attachmentKey) =>
          Effect.sync(() => core.capabilityFor(attachmentKey)),
        capability: Effect.sync(() => core.capability),
        probe: () => Effect.promise(() => core.probe()),
        mutationFor: (annotationKey) =>
          Effect.sync(() => core.mutationFor(annotationKey)),
        annotationState: (annotationKey) =>
          Effect.sync(() => core.annotationState(annotationKey)),
        textDraftFor: (field, annotationKey) =>
          Effect.sync(() => core.textDraftFor(field, annotationKey)),
        editTextField: (field, annotationKey, text) =>
          Effect.sync(() => core.editTextField(field, annotationKey, text)),
        submitTextField: (field, annotationKey, writeOptions) =>
          Effect.promise(() =>
            core.submitTextField(field, annotationKey, writeOptions),
          ),
        discardTextDraft: (field, annotationKey) =>
          Effect.sync(() => core.discardTextDraft(field, annotationKey)),
        retryTextDraft: (field, annotationKey) =>
          Effect.promise(() => core.retryTextDraft(field, annotationKey)),
        tagDraftFor: (annotationKey) =>
          Effect.sync(() => core.tagDraftFor(annotationKey)),
        editTags: (annotationKey, names) =>
          Effect.sync(() => core.editTags(annotationKey, names)),
        submitTags: (annotationKey, writeOptions) =>
          Effect.promise(() => core.submitTags(annotationKey, writeOptions)),
        discardTagDraft: (annotationKey) =>
          Effect.sync(() => core.discardTagDraft(annotationKey)),
        createAnnotation: (attachmentKey, draft, createOptions) =>
          Effect.promise(() =>
            core.createAnnotation(attachmentKey, draft, createOptions),
          ),
        patchColor: (annotationKey, color) =>
          Effect.promise(() => core.patchColor(annotationKey, color)),
        patchColors: (annotationKeys, color) =>
          Effect.promise(() => core.patchColors(annotationKeys, color)),
        patchComment: (annotationKey, comment) =>
          Effect.promise(() => core.patchComment(annotationKey, comment)),
        patchGeometry: (annotationKey, edit, input) =>
          Effect.promise(() => core.patchGeometry(annotationKey, edit, input)),
        deleteAnnotation: (annotationKey) =>
          Effect.promise(() => core.deleteAnnotation(annotationKey)),
        deleteAnnotations: (annotationKeys) =>
          Effect.promise(() => core.deleteAnnotations(annotationKeys)),
        retryWrite: (annotationKey) =>
          Effect.promise(() => core.retryWrite(annotationKey)),
        discardConflict: (annotationKey) =>
          Effect.sync(() => core.discardConflict(annotationKey)),
        openHistory: (attachmentKey) =>
          Effect.sync(() => core.openHistory(attachmentKey)),
        closeHistory: (attachmentKey) =>
          Effect.sync(() => core.closeHistory(attachmentKey)),
        canUndo: (attachmentKey) =>
          Effect.sync(() => core.canUndo(attachmentKey)),
        canRedo: (attachmentKey) =>
          Effect.sync(() => core.canRedo(attachmentKey)),
        undo: (attachmentKey) => Effect.promise(() => core.undo(attachmentKey)),
        redo: (attachmentKey) => Effect.promise(() => core.redo(attachmentKey)),
        annotationsChanged: byTag("annotations-changed").pipe(
          Stream.map(({ attachmentKey }) => attachmentKey),
        ),
        excerptPixelsChanged: byTag("excerpt-pixels-changed").pipe(
          Stream.map(({ record, source }) => ({ record, source })),
        ),
        capabilityChanges: byTag("capability-changed").pipe(
          Stream.as(undefined),
        ),
        annotationChanged: byTag("annotation-changed").pipe(
          Stream.map(({ annotationKey }) => annotationKey),
        ),
        historyChanged: byTag("history-changed").pipe(
          Stream.map(({ attachmentKey }) => attachmentKey),
        ),
        writeConflicts: byTag("write-conflict").pipe(
          Stream.map(({ annotationKey, attachmentKey }) => ({
            annotationKey,
            attachmentKey,
          })),
        ),
      });
    }).pipe(
      // Failed repository dependency wiring during core construction is a defect.
      Effect.orDie,
      withLogCategory("annotation-repository"),
    ),
  );
}
