// The one place the user is told why editing is blocked: the layer over
// `capability-notices.ts`, which decides what is said and how often.
//
// @see apps/obsidian/policies/ui-seams.md
import { Clock, Context, Duration, Effect, FiberSet, Layer } from "effect";

import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { BaseNotice } from "@/lib/notice";
import { Notifier } from "@/lib/notifier";
import type { NoticeHandle } from "@/lib/notifier";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";

import type { EditingCapability } from "./capability";
import {
  allowEditingNotice,
  CapabilityNoticeLedger,
} from "./capability-notices";
import type { CapabilityNotice } from "./capability-notices";
import { AnnotationRepository } from "./service";

/** Default reading time for problems and actions that are not sticky. */
const NOTICE_DURATION = Duration.seconds(10);

/**
 * One {@link CapabilityNotice} as the notice draws it. Separate from the
 * triggers so `/obsidian-debug` can put any of them on screen without first
 * arranging the state that would raise it.
 *
 * @param runAction what the notice's one action runs — the "Zotero editing"
 *   settings row for a capability notice, the card itself for a conflict.
 */
export function capabilityNoticeMessage(
  { title, lines, action }: CapabilityNotice,
  runAction: () => void,
): DocumentFragment {
  return BaseNotice.render((renderer) => {
    renderer.setTitle(title);
    for (const line of lines) renderer.addText(line);
    if (action === null) return;
    renderer.addAction((button) => {
      button.setButtonText(action).setCta().onClick(runAction);
    });
  });
}

/** How long one {@link CapabilityNotice} stays, in ms; `0` keeps it until dismissed. */
function noticeDuration({ sticky, duration }: CapabilityNotice): number {
  if (sticky) return 0;
  return duration === undefined
    ? Duration.toMillis(NOTICE_DURATION)
    : duration.total("milliseconds");
}

/**
 * The Editing Capability's UI seam: the gestures its renderers hand over, and
 * the notices a blocked gesture or a refused write earns. Every "once per …"
 * rule lives in the ledger, so this holds no state of its own beyond the
 * ledger it renders.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export class CapabilityNotices extends Context.Service<
  CapabilityNotices,
  {
    /**
     * Allow editing, from every entry that offers it: ask Zotero once, then
     * say what its answer left. An Allow's notice offers this same gesture
     * again; nothing here asks a second time on its own.
     *
     * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
     */
    readonly allowEditing: Effect.Effect<void>;
    /**
     * The reader's held-draft Allow editing: re-check Zotero, then open the
     * "Zotero editing" settings row, which both explains the state and offers
     * the gestures that change it — rendering the same enum from the same copy
     * table.
     */
    readonly showEditingCapability: Effect.Effect<void>;
    /**
     * An edit gesture met a block on this Attachment, with a fresh Capability
     * Probe already behind it.
     *
     * @param attachmentKey the Attachment's Indexed Key.
     */
    reportBlockedGesture(attachmentKey: string): Effect.Effect<void>;
  }
>()("zotlit/annotation-repository/CapabilityNotices") {}

/** What the notices open in Obsidian. */
export interface CapabilityNoticePorts {
  /** Reveals the "Zotero editing" settings row. */
  readonly openEditingSettings: () => void;
  /** Whether an Annotation View on screen already shows this card. */
  readonly cardShown: (annotationKey: string) => boolean;
  /** Opens the Annotation View and brings one Annotation's card forward. */
  readonly revealAnnotation: (annotationKey: string) => void;
}

export function layerCapabilityNotices(
  ports: CapabilityNoticePorts,
): Layer.Layer<
  CapabilityNotices,
  never,
  AnnotationRepository | ZoteroLocalApi | Notifier
> {
  return Layer.effect(
    CapabilityNotices,
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      const api = yield* ZoteroLocalApi;
      const notifier = yield* Notifier;
      const ledger = new CapabilityNoticeLedger(
        instantClock(yield* Clock.Clock),
      );
      // A notice's button is a DOM callback: its action runs on the layer's
      // Scope, so unload interrupts it.
      const run = yield* FiberSet.makeRuntime<never>();

      const show = Effect.fnUntraced(function* (
        notice: CapabilityNotice,
        action: Effect.Effect<void>,
      ) {
        let handle: NoticeHandle | null = null;
        handle = yield* notifier.show(
          capabilityNoticeMessage(notice, () => {
            run(Effect.andThen(handle?.hide ?? Effect.void, action));
          }),
          { duration: noticeDuration(notice) },
        );
      });
      const openEditingSettings = Effect.sync(() =>
        ports.openEditingSettings(),
      );
      const showProblem = (notice: CapabilityNotice | null) =>
        notice ? show(notice, openEditingSettings) : Effect.void;

      const allowEditing: Effect.Effect<void> = Effect.gen(function* () {
        const notice = allowEditingNotice(yield* api.authorize);
        if (notice) yield* show(notice, allowEditing);
      }).pipe(Effect.withSpan("CapabilityNotices.allowEditing"));

      yield* forkEach(repository.capabilityChanges, () =>
        Effect.gen(function* () {
          const capabilities = new Map<string, EditingCapability>();
          for (const attachmentKey of ledger.openEpisodes()) {
            capabilities.set(
              attachmentKey,
              yield* repository.capabilityFor(attachmentKey),
            );
          }
          ledger.refresh(capabilities);
        }),
      );
      // A conflict the user cannot see is a change lost in silence, so the
      // one notice that answers it is the way to the card. A view that
      // already shows the card says everything this notice would, in the
      // place the user resolves it.
      yield* forkEach(repository.writeConflicts, ({ annotationKey }) =>
        Effect.gen(function* () {
          if (ports.cardShown(annotationKey)) return;
          const notice = ledger.conflictOffScreen(annotationKey);
          if (!notice) return;
          yield* Effect.logDebug(
            "A write conflict stands on a card no view shows",
          ).pipe(Effect.annotateLogs({ annotationKey }));
          yield* show(
            notice,
            Effect.sync(() => ports.revealAnnotation(annotationKey)),
          );
        }),
      );
      // A card that settled back to any other state has no conflict standing
      // on it, so the next one is news rather than the same one twice.
      yield* forkEach(repository.annotationChanged, (annotationKey) =>
        Effect.gen(function* () {
          const mutation = yield* repository.mutationFor(annotationKey);
          if (mutation.kind !== "conflict")
            ledger.conflictResolved(annotationKey);
        }),
      );
      yield* forkEach(api.writeRefusals, ({ failure, library }) =>
        showProblem(ledger.writeRefused(failure, library)),
      );
      yield* forkEach(api.serverChanges, (serverID) =>
        showProblem(ledger.serverChanged(serverID)),
      );
      yield* forkEach(api.writeRefusalsRetired, () => {
        ledger.writeRefusalsRetired();
      });

      return CapabilityNotices.of({
        allowEditing,
        showEditingCapability: Effect.andThen(
          repository.probe,
          openEditingSettings,
        ).pipe(Effect.withSpan("CapabilityNotices.showEditingCapability")),
        reportBlockedGesture: Effect.fn(
          "CapabilityNotices.reportBlockedGesture",
        )(function* (attachmentKey) {
          const capability = yield* repository.capabilityFor(attachmentKey);
          const notice = ledger.blockedGesture(attachmentKey, capability);
          if (!notice) return;
          yield* Effect.logDebug("An edit gesture met a block").pipe(
            Effect.annotateLogs({ attachmentKey, capability }),
            withLogCategory("annotation-repository"),
          );
          yield* show(notice, openEditingSettings);
        }),
      });
    }).pipe(withLogCategory("annotation-repository")),
  );
}
