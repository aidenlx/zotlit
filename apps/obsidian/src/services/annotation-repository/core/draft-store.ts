// The Annotation Drafts the core holds, their autosave timers, and how a read reconciles them.
import { Effect, FiberMap } from "effect";

import {
  isTextField,
  TEXT_FIELDS,
} from "@/services/annotation-repository/write";
import type {
  MutationState,
  TextField,
} from "@/services/annotation-repository/write";
import type { Held } from "@/services/query-client/service";

import {
  DRAFT_FIELDS,
  TEXT_FIELD_SPECS,
  indexedID,
  proposedText,
  sameText,
} from "./model";
import type {
  AnnotationList,
  AnnotationRecord,
  DraftField,
  DraftFields,
  TagDraft,
  TextFieldDraft,
} from "./model";
import { pendingWrites, settle } from "./outcomes";
import type { CoreState } from "./state";

/** The active Zotero database's shared draft of one field of an Annotation. */
const draftFor = Effect.fnUntraced(function* <F extends DraftField>(
  core: CoreState,
  field: F,
  annotationKey: string,
): Effect.fn.Return<DraftFields[F] | null> {
  const serverID =
    (yield* core.localApi.demandSource)?.serverID ??
    core.draftSources[field].get(annotationKey);
  return serverID
    ? (core.drafts[field].get(indexedID(serverID, annotationKey)) ?? null)
    : null;
});

/** Every field's draft on one Annotation, in any Zotero database. */
function draftsOn(
  core: CoreState,
  annotationKey: string,
): (TextFieldDraft | TagDraft)[] {
  return Object.values(core.drafts).flatMap((drafts) =>
    [...drafts.values()].filter(
      (draft) => draft.annotationKey === annotationKey,
    ),
  );
}

function setDraft<F extends DraftField>(
  core: CoreState,
  field: F,
  draft: DraftFields[F],
): void {
  core.drafts[field].set(indexedID(draft.serverID, draft.annotationKey), draft);
  core.draftSources[field].set(draft.annotationKey, draft.serverID);
  core.publish({
    _tag: "annotation-changed",
    annotationKey: draft.annotationKey,
  });
}

/** Drop one field's draft of an Annotation, with its autosave. */
const dropDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: DraftField,
  draft: TextFieldDraft | TagDraft,
) {
  const { serverID, annotationKey } = draft;
  if (!core.drafts[field].delete(indexedID(serverID, annotationKey))) return;
  if (core.draftSources[field].get(annotationKey) === serverID) {
    core.draftSources[field].delete(annotationKey);
  }
  if (isTextField(field)) yield* cancelTextSave(core, field, draft);
  core.publish({ _tag: "annotation-changed", annotationKey });
});

/** Drop every field's draft of an Annotation that {@link draftFor} finds. */
const dropDrafts = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  for (const field of DRAFT_FIELDS) {
    const draft = yield* draftFor(core, field, annotationKey);
    if (draft) yield* dropDraft(core, field, draft);
  }
});

/** The key of one text draft's autosave timers in either map. */
function saveKey(
  field: TextField,
  {
    serverID,
    annotationKey,
  }: Pick<TextFieldDraft, "serverID" | "annotationKey">,
): string {
  return `${field}:${indexedID(serverID, annotationKey)}`;
}

/** Whether one text draft's autosave is armed: its idle or burst timer. */
function autosaveDue(
  core: CoreState,
  field: TextField,
  draft: Pick<TextFieldDraft, "serverID" | "annotationKey">,
): boolean {
  const key = saveKey(field, draft);
  return (
    FiberMap.hasUnsafe(core.idleSaves, key) ||
    FiberMap.hasUnsafe(core.burstSaves, key)
  );
}

/** Stop both autosave timers of one text draft. */
const cancelTextSave = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  draft: Pick<TextFieldDraft, "serverID" | "annotationKey">,
) {
  const key = saveKey(field, draft);
  yield* FiberMap.remove(core.idleSaves, key);
  yield* FiberMap.remove(core.burstSaves, key);
});

/** Reconcile drafts only against a complete read from their own database. */
const reconcileDrafts = Effect.fnUntraced(function* (
  core: CoreState,
  { serverID, attachmentKey }: { serverID: string; attachmentKey: string },
  annotations: readonly AnnotationRecord[],
) {
  const records = new Map(annotations.map((record) => [record.key, record]));
  const completeID = indexedID(serverID, attachmentKey);
  const before = core.completeKeys.get(completeID);
  core.completeKeys.set(completeID, new Set(records.keys()));
  // Gone is what the last complete read showed, or a draft stands on, and
  // this one no longer answers.
  const gone = new Set(
    [
      ...(before ?? []),
      ...Object.values(core.drafts)
        .flatMap((drafts) => [...drafts.values()])
        .filter(
          (draft) =>
            draft.serverID === serverID &&
            draft.attachmentKey === attachmentKey,
        )
        .map((draft) => draft.annotationKey),
    ].filter((key) => !records.has(key)),
  );
  for (const key of records.keys()) core.gone.delete(key);
  for (const key of gone) core.gone.add(key);
  // Deletion confirmed in Zotero discards the tag draft with the text
  // drafts; the gone Annotation is announced below.
  for (const draft of core.drafts.tags.values()) {
    if (
      draft.serverID !== serverID ||
      draft.attachmentKey !== attachmentKey ||
      records.has(draft.annotationKey)
    )
      continue;
    yield* dropDraft(core, "tags", draft);
  }
  for (const field of TEXT_FIELDS) {
    yield* reconcileTextDrafts(core, field, {
      serverID,
      attachmentKey,
      records,
    });
  }
  // What a write left on an Annotation goes with it, and every surface
  // still drawing it hears that it is gone, with a draft or without.
  for (const key of gone) {
    core.outcomes.delete(key);
    core.publish({ _tag: "annotation-changed", annotationKey: key });
  }
});

/**
 * Reconcile one text field's drafts in one Attachment against a complete
 * read: a value Zotero already holds ends the draft, an untouched draft
 * follows Zotero, and a changed value under typed text is a Write Conflict.
 */
const reconcileTextDrafts = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    serverID,
    attachmentKey,
    records,
  }: {
    serverID: string;
    attachmentKey: string;
    records: ReadonlyMap<string, AnnotationRecord>;
  },
) {
  const drafts = core.drafts[field];
  for (const draft of drafts.values()) {
    if (draft.serverID !== serverID || draft.attachmentKey !== attachmentKey) {
      continue;
    }
    const record = records.get(draft.annotationKey);
    if (!record) {
      yield* dropDraft(core, field, draft);
      continue;
    }
    const fresh = TEXT_FIELD_SPECS[field].valueOf(record) ?? "";
    if (draft.state.kind === "pending") {
      if (
        pendingWrites(core, draft.annotationKey).some(
          (mutation) =>
            mutation.options.mutationKey?.[2] === field &&
            sameText(fresh, proposedText(field, mutation)),
        )
      ) {
        drafts.set(indexedID(serverID, draft.annotationKey), {
          ...draft,
          baseline: fresh,
        });
        core.publish({
          _tag: "annotation-changed",
          annotationKey: draft.annotationKey,
        });
      }
      continue;
    }
    if (sameText(fresh, draft.text)) {
      yield* dropDraft(core, field, draft);
      continue;
    }
    if (sameText(fresh, draft.baseline)) continue;
    if (sameText(draft.text, draft.baseline)) {
      drafts.set(indexedID(serverID, draft.annotationKey), {
        ...draft,
        baseline: fresh,
        text: fresh,
        state: { kind: "editing" },
      });
      core.publish({
        _tag: "annotation-changed",
        annotationKey: draft.annotationKey,
      });
      continue;
    }
    const conflict: MutationState = {
      kind: "conflict",
      conflict: { write: field, attempted: draft.text, fresh },
    };
    settle(core, draft.annotationKey, { write: field, state: conflict });
    drafts.set(indexedID(draft.serverID, draft.annotationKey), {
      ...draft,
      state: { kind: "conflict", fresh },
    });
    core.publish({
      _tag: "annotation-changed",
      annotationKey: draft.annotationKey,
    });
    core.publish({
      _tag: "write-conflict",
      annotationKey: draft.annotationKey,
      attachmentKey,
    });
  }
});

/**
 * Reconcile only a complete result Query Core accepted for publication.
 *
 * @param held what the list's query key holds now.
 */
const reconcilePublishedDrafts = Effect.fnUntraced(function* (
  core: CoreState,
  held: Held<AnnotationList> | null,
  { attachmentKey, list }: { attachmentKey: string; list: AnnotationList },
) {
  if (held?.status !== "fresh" || held.value !== list) return;
  const serverID =
    list.source.kind === "zotero-local-api"
      ? list.source.serverID
      : list.source.database.serverID;
  if (serverID === null) return;
  yield* reconcileDrafts(core, { serverID, attachmentKey }, list.annotations);
});

export {
  draftFor,
  draftsOn,
  setDraft,
  dropDraft,
  dropDrafts,
  saveKey,
  autosaveDue,
  cancelTextSave,
  reconcileDrafts,
  reconcilePublishedDrafts,
};
