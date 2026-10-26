// Annotation reads and gestures on the plugin's view runtime.
import { Cause, Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { isChildItemFields } from "@zotlit/db";

import { withLogCategory } from "@/lib/effect-log";
import { itemSummary } from "@/lib/item-summary";
import { viewRuntime } from "@/lib/view-atoms";
import {
  annotationChangeAtom,
  annotationListsChangeAtom,
} from "@/services/annotation-repository/atoms";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  HistoryDirection,
  MutationState,
  TextField,
} from "@/services/annotation-repository/service";
import { libraryTagNames } from "@/services/database/library-tag-names";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { savedExcerptRequestFor } from "@/services/excerpt-image/request";
import type { ExcerptRequest } from "@/services/excerpt-image/service";
import { readerTargetAtom } from "@/services/local-server/atoms";
import type { AnnotationCitation } from "@/services/note-feature/annotation-citation";
import type { AnnotationInsertRequest } from "@/services/note-feature/citations-handle";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation";
import { AnnotationNoteActions } from "@/services/note-feature/view-actions";
import { PluginSettings } from "@/services/settings/service";
import { plainTemplateError } from "@/services/template/errors";
import { zoteroDataDirAtom } from "@/services/zotero-pref/atoms";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { ExcerptImageTarget } from "./excerpt-image-state";
import type { LoadTarget } from "./resolve-target";
import type { FollowMode } from "./state";

export const resultValue = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): A | null =>
  AsyncResult.isFailure(result)
    ? null
    : Option.getOrNull(AsyncResult.value(result));

export const requireResult = <A, E>(result: AsyncResult.AsyncResult<A, E>): A =>
  AsyncResult.getOrThrow(result);

const changedKey = <A>(
  source: Atom.Atom<ReadonlyMap<string, A>>,
  key: string,
) => Atom.map(source, (changes) => changes.get(key) ?? null);

export const heldListAtom = Atom.family((key: string) => {
  const changed = changedKey(annotationListsChangeAtom, key);
  return viewRuntime.atom((get) => {
    get(changed);
    return Effect.flatMap(AnnotationRepository, (repository) =>
      repository.peek(key),
    );
  });
});

export const annotationStateAtom = Atom.family((key: string) => {
  const changed = changedKey(annotationChangeAtom, key);
  return viewRuntime.atom((get) => {
    get(changed);
    return Effect.flatMap(AnnotationRepository, (repository) =>
      repository.annotationState(key),
    );
  });
});

export const makeAttachmentRead = (key: string) => {
  const changed = changedKey(annotationListsChangeAtom, key);
  return viewRuntime.atom((get) => {
    get(changed);
    get(zoteroDataDirAtom);
    return Effect.gen(function* () {
      const scope = (yield* (yield* ZoteroPref).current).dataDir;
      const list = yield* (yield* AnnotationRepository).read(key);
      return { list, scope };
    });
  });
};

/** The layout owns the returned hold and releases it when the next lists land. */
export const makeHoldAttachmentsCommand = () =>
  viewRuntime.fn((keys: readonly string[]) =>
    Effect.flatMap(AnnotationRepository, (repository) => repository.hold(keys)),
  );

export const makeTargetRead = (target: LoadTarget, mode: FollowMode) =>
  viewRuntime.atom(
    Effect.gen(function* () {
      const { reads } = yield* ZoteroReads;
      const [attachments, items] = yield* Effect.all(
        [
          reads.AnnotViewAttachments({
            libraryID: target.libraryID,
            key: target.key,
            standalone: target.itemKey === null,
          }),
          mode === "active-tab" || target.itemKey === null
            ? Effect.succeed(null)
            : reads
                .ItemsByIndexedKeys({ indexedKeys: [target.itemKey] })
                .pipe(Effect.orElseSucceed(() => null)),
        ],
        { concurrency: "unbounded" },
      );
      const item = target.itemKey && items?.get(target.itemKey);
      return {
        attachments,
        itemDisplay:
          item && !isChildItemFields(item.fields)
            ? itemSummary(item, item.fields)
            : null,
      };
    }),
  );

type DraftRequest =
  | { kind: "edit-field"; key: string; field: TextField; text?: string }
  | { kind: "edit-tags"; key: string; names?: readonly string[] }
  | { kind: "discard-field"; key: string; field: TextField }
  | { kind: "discard-tags" | "discard-conflict"; key: string };

export const annotationDraftCommand = viewRuntime.fn((request: DraftRequest) =>
  Effect.gen(function* () {
    const repository = yield* AnnotationRepository;
    switch (request.kind) {
      case "edit-field":
        return (
          (yield* request.text === undefined
            ? repository.editTextField(request.field, request.key)
            : repository.editTextField(
                request.field,
                request.key,
                request.text,
              )) !== null
        );
      case "edit-tags":
        return (
          (yield* request.names === undefined
            ? repository.editTags(request.key)
            : repository.editTags(request.key, request.names)) !== null
        );
      case "discard-field":
        yield* repository.discardTextDraft(request.field, request.key);
        return false;
      case "discard-tags":
        yield* repository.discardTagDraft(request.key);
        return false;
      case "discard-conflict":
        yield* repository.discardConflict(request.key);
        return false;
    }
  }),
);

export type AnnotationWriteRequest =
  | {
      kind: "submit-field";
      key: string;
      field: TextField;
      automatic?: boolean;
      text?: string;
    }
  | { kind: "submit-tags"; key: string; automatic?: boolean }
  | { kind: "retry"; key: string; field?: TextField }
  | { kind: "color"; keys: readonly string[]; color: string }
  | { kind: "delete"; keys: readonly string[] };

/** A card's write runs beside writes from other cards and other leaves. */
// A closing editor submits a write that lasts until completion or plugin unload.
export const annotationWriteCommand = Atom.keepAlive(
  viewRuntime.fn(
    (
      request: AnnotationWriteRequest & {
        complete: (states: readonly MutationState[]) => void;
      },
    ) =>
      Effect.gen(function* () {
        const repository = yield* AnnotationRepository;
        switch (request.kind) {
          case "submit-field":
            if (request.text !== undefined)
              yield* repository.editTextField(
                request.field,
                request.key,
                request.text,
              );
            return [
              yield* repository.submitTextField(request.field, request.key, {
                automatic: request.automatic,
              }),
            ];
          case "submit-tags":
            return [
              yield* repository.submitTags(request.key, {
                automatic: request.automatic,
              }),
            ];
          case "retry":
            return [
              yield* request.field
                ? repository.retryTextDraft(request.field, request.key)
                : repository.retryWrite(request.key),
            ];
          case "color": {
            const [key] = request.keys;
            if (!key) return [];
            return request.keys.length === 1
              ? [yield* repository.patchColor(key, request.color)]
              : yield* repository.patchColors(request.keys, request.color);
          }
          case "delete": {
            const [key] = request.keys;
            if (!key) return [];
            return request.keys.length === 1
              ? [yield* repository.deleteAnnotation(key)]
              : yield* repository.deleteAnnotations(request.keys);
          }
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Annotation write failed",
            Cause.squash(cause),
          ).pipe(
            Effect.as<readonly MutationState[]>([
              { kind: "failed", failure: { kind: "unknown-outcome" } },
            ]),
          ),
        ),
        Effect.tap((states) => Effect.sync(() => request.complete(states))),
        withLogCategory("annot-view"),
      ),
    { concurrent: true },
  ),
);

/** Each visible image may resolve beside every other card's image. */
export const makeExcerptRequestCommand = () =>
  viewRuntime.fn(
    (
      request: Pick<
        ExcerptImageTarget,
        "annotation" | "source" | "sourceScope"
      > & {
        complete: (value: ExcerptRequest | null) => void;
      },
    ) =>
      Effect.gen(function* () {
        const pref = yield* ZoteroPref;
        if ((yield* pref.current).dataDir !== request.sourceScope) return null;
        return yield* savedExcerptRequestFor(request);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            request.complete(exit._tag === "Success" ? exit.value : null),
          ),
        ),
      ),
    { concurrent: true },
  );

export const makeRefreshCommand = () =>
  viewRuntime.fn((request: { keys: readonly string[]; complete: () => void }) =>
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      yield* Effect.forEach(request.keys, (key) => repository.refresh(key), {
        concurrency: "unbounded",
      });
    }).pipe(Effect.onExit(() => Effect.sync(request.complete))),
  );

export const makeHistoryCommand = () =>
  viewRuntime.fn(
    (request: {
      key: string;
      direction: HistoryDirection;
      complete: (
        outcome: import("@/services/annotation-repository/service").HistoryOutcome,
      ) => void;
    }) =>
      Effect.gen(function* () {
        const repository = yield* AnnotationRepository;
        const outcome = yield* request.direction === "undo"
          ? repository.undo(request.key)
          : repository.redo(request.key);
        yield* Effect.sync(() => request.complete(outcome));
      }),
  );

export const enableLiveUpdatesCommand = viewRuntime.fn(() =>
  Effect.flatMap(PluginSettings, (settings) =>
    settings.update({ "server.enabled": true, "server.live-update": true }),
  ),
);

export const readerResolutionAtom = viewRuntime.atom((get) => {
  const pushed = get(readerTargetAtom);
  get(zoteroRevisionAtom);
  return Effect.gen(function* () {
    if (!pushed) return null;
    const named = yield* (yield* ZoteroReads).reads.ReaderTargetKeys({
      attachmentID: pushed.attachmentID,
      selected: pushed.selected,
    });
    return named
      ? {
          target: {
            attachmentKey: named.attachmentKey,
            itemKey: named.itemKey,
          },
          selected: named.selected,
        }
      : null;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not name the Zotero reader target", error).pipe(
        Effect.as(null),
      ),
    ),
    withLogCategory("annot-view"),
  );
});

/** Two panes can request authorization or report separate blocked gestures. */
export const editingCapabilityCommand = viewRuntime.fn(
  (request: { kind: "allow" } | { kind: "blocked"; key: string }) =>
    Effect.gen(function* () {
      const notices = yield* CapabilityNotices;
      yield* request.kind === "allow"
        ? notices.allowEditing
        : notices.reportBlockedGesture(request.key);
    }),
  { concurrent: true },
);

/** Tag editors on duplicate cards resolve their suggestions independently. */
export const makeLibraryTagNamesCommand = () =>
  viewRuntime.fn(
    (request: { key: string; complete: (names: readonly string[]) => void }) =>
      Effect.gen(function* () {
        return yield* libraryTagNames(yield* ZoteroReads, request.key);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            request.complete(exit._tag === "Success" ? exit.value : []),
          ),
        ),
      ),
    { concurrent: true },
  );

export const openExcerptDemandCommand = viewRuntime.fn(() =>
  Effect.flatMap(ExcerptDisplays, (display) =>
    Effect.sync(() => display.open()),
  ),
);
export const refreshExcerptDisplayCommand = viewRuntime.fn(() =>
  Effect.flatMap(ExcerptDisplays, (display) =>
    Effect.sync(() => display.refresh()),
  ),
);

/** Two card menus can copy citations without cancelling each other's read. */
export const copyCitationCommand = viewRuntime.fn(
  (request: {
    key: string;
    resolve: (citation: AnnotationCitation) => void;
    reject: (error: unknown) => void;
  }) =>
    Effect.flatMap(AnnotationNoteActions, (notes) =>
      notes.citation(request.key),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success") request.resolve(exit.value);
          else request.reject(plainTemplateError(Cause.squash(exit.cause)));
        }),
      ),
    ),
  { concurrent: true },
);

/** The menu and a drag each own their captured editor and cancellation signal. */
export const makePrepareInsertCommand = () =>
  viewRuntime.fn(
    (request: {
      input: AnnotationInsertRequest;
      resolve: (insert: AnnotationInsert | null) => void;
      reject: (error: unknown) => void;
    }) =>
      Effect.gen(function* () {
        const { signal, ...options } = request.input;
        if (signal.aborted) return yield* Effect.interrupt;
        const cancelled = Effect.callback<never>((resume) => {
          const interrupt = () => resume(Effect.interrupt);
          if (signal.aborted) {
            interrupt();
            return;
          }
          signal.addEventListener("abort", interrupt, { once: true });
          return Effect.sync(() =>
            signal.removeEventListener("abort", interrupt),
          );
        });
        const notes = yield* AnnotationNoteActions;
        return yield* Effect.raceFirst(notes.prepare(options), cancelled);
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (exit._tag === "Success") request.resolve(exit.value);
            else
              request.reject(
                request.input.signal.aborted
                  ? request.input.signal.reason
                  : plainTemplateError(Cause.squash(exit.cause)),
              );
          }),
        ),
      ),
    { concurrent: true },
  );
