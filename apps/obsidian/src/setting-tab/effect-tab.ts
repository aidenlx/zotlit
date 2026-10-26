// The setting tab's seam to Effect: one service that runs the tab's Effects on
// the tab layer's own context and Scope.
//
// Obsidian drives a declarative tab synchronously: `getSettingDefinitions()`,
// `getControlValue`/`setControlValue`, and the `visible`/`disabled` predicates
// return before Obsidian paints. Those run with `sync`, so a builder reads a
// service through the Context (`yield* ZoteroReads`) instead of an injected
// adapter. An event handler starts a fiber with `run`; a row with live state
// starts one with `mount` and returns its interrupt as the row's cleanup.
// Every fiber lives in the tab layer's Scope, so closing the layer ends them.
import { Cause, Context, Effect, Fiber, Scope, Stream } from "effect";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log-category";
import { Notifier } from "@/lib/notifier";
import type { FileManager } from "@/lib/obsidian-file-manager";
import type { Vault } from "@/lib/obsidian-vault";
import { formatErrorMessage } from "@/lib/toast";
import type { CapabilityNotices } from "@/services/annotation-repository/notices";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type { AttachmentImport } from "@/services/attachment-import/service";
import type { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import type { CitationIndex } from "@/services/citation-index/service";
import type { ExcerptDisplays } from "@/services/excerpt-image/display";
import type { ExcerptImages } from "@/services/excerpt-image/layer";
import type { LanguagePack } from "@/services/language-pack/service";
import type { LibraryScope } from "@/services/library-scope/service";
import type { LocalBridge } from "@/services/local-bridge/service";
import type { LocalServer } from "@/services/local-server/service";
import type { NoteFeature } from "@/services/note-feature/service";
import type { NoteIndex } from "@/services/note-index/service";
import type { PandocEngine } from "@/services/pandoc/service";
import type { Profile } from "@/services/profile/service";
import type { Release } from "@/services/release/service";
import type { PluginSettings } from "@/services/settings/service";
import type { Template } from "@/services/template/service";
import type { ZoteroLocalApi } from "@/services/zotero-local-api/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

/** Every service a tab Effect may read: the tab layer's whole context. */
export type SettingTabEnv =
  | SettingTab
  | Notifier
  | PluginSettings
  | Profile
  | Template
  | ZoteroPref
  | ZoteroReads
  | LibraryScope
  | LocalServer
  | Release
  | AnnotationRepository
  | CapabilityNotices
  | ZoteroLocalApi
  | CitationIndex
  | PandocEngine
  | ChineseSegmenter
  | AttachmentImport
  | LocalBridge
  | LanguagePack
  | ExcerptImages
  | ExcerptDisplays
  | NoteFeature
  | NoteIndex
  | Vault
  | FileManager;

export interface SettingTabShape {
  /**
   * Run a synchronous Effect now, for a callback Obsidian reads a value from:
   * a definition build, a control read, a predicate. Throws what the Effect
   * fails with, as a synchronous Obsidian callback would.
   */
  sync<A, E>(effect: Effect.Effect<A, E, SettingTabEnv>): A;
  /**
   * Start a handler's Effect: a button, an action, a control write. A failure
   * is logged under `label` and shown as a notice; an interrupt (the tab
   * closing) is silent. An Effect that reports its own outcome
   * (`reportOutcome`, `withProgress`) takes no `label`: what still reaches the
   * runner is only logged. The Promise settles when the Effect ends and never
   * rejects, so a caller that awaits it (Obsidian awaits `setControlValue`
   * before it refreshes the DOM state) sees the work done, and one that drops
   * it leaks no rejection.
   */
  run<A, E>(
    effect: Effect.Effect<A, E, SettingTabEnv>,
    label?: string,
  ): Promise<void>;
  /**
   * Start a row's live Effect in a Scope of its own, for `render` to return
   * the result as its cleanup. The cleanup interrupts the fiber, which closes
   * that Scope.
   */
  mount<E>(
    effect: Effect.Effect<unknown, E, SettingTabEnv | Scope.Scope>,
  ): () => void;
  /**
   * Rebuild the definitions: rows were added, removed, or renamed. Obsidian
   * re-renders every `render` row on a rebuild, so a row never asks for one
   * from inside its own `render`.
   */
  readonly update: Effect.Effect<void>;
}

export class SettingTab extends Context.Service<SettingTab, SettingTabShape>()(
  "zotlit/setting-tab/SettingTab",
) {}

/**
 * The tab service over the current context, itself included, with every fiber
 * forked into the current Scope. `update` is late-bound: the tab instance is
 * built from this service, so it does not exist yet.
 */
export const makeSettingTab = Effect.fn("makeSettingTab")(function* (
  update: () => void,
) {
  const base = yield* Effect.context<
    Exclude<SettingTabEnv, SettingTab> | Scope.Scope
  >();
  const notifier = Context.get(base, Notifier);
  const onFiberStart = Fiber.runIn(Context.get(base, Scope.Scope));
  const service: SettingTabShape = {
    sync: (effect) => runSync(effect),
    run: async (effect, label) => {
      await runPromiseExit(
        effect.pipe(
          recover(
            (cause) =>
              label === undefined
                ? Effect.logWarning("A setting action failed", cause)
                : Effect.logWarning(label, cause).pipe(
                    Effect.andThen(
                      notifier.show(
                        `${label}: ${formatErrorMessage(Cause.squash(cause))}`,
                      ),
                    ),
                  ),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
    },
    mount: (effect) => {
      const fiber = runFork(
        Effect.scoped(effect).pipe(
          recover(
            (cause) =>
              Effect.logWarning("A setting row stopped updating", cause),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
      return () => fiber.interruptUnsafe();
    },
    update: Effect.sync(update),
  };
  const context = Context.add(base, SettingTab, service);
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const runPromiseExit = Effect.runPromiseExitWith(context);
  return service;
});

/**
 * Paint each element of `stream` until the row's Scope closes: the live-row
 * body of `mount`. `paint` runs on the renderer and may touch the row's DOM.
 */
export const paintEach = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  paint: (value: A) => void,
) => Stream.runForEach(stream, (value) => Effect.sync(() => paint(value)));
