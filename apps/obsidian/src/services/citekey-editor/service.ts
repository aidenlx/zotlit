// The citekey editor treatment service: it reads the settings that switch the
// treatment on and owns the click that opens a citekey's note. Its CodeMirror
// extension registers in ./register.
import { Cause, Context, Effect, Layer, PubSub, Stream } from "effect";

import { logAndContinue, withLogCategory } from "@/lib/effect-log";
import type { Notifier } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import { describeCandidatesEffect } from "@/services/citation-index/ambiguity";
import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";
import { heldResolution } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type {
  CitationLookupAnswer,
  SnapshotItem,
} from "@/services/citation-index/service";
import { hoverPreferences } from "@/services/citekey-navigation";
import type {
  HoverPreferences,
  NavigationPane,
} from "@/services/citekey-navigation";
import { LibraryScope } from "@/services/library-scope/service";
import { createNoteInteractively } from "@/services/note-feature/creation-view";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import type { NoteFeature } from "@/services/note-feature/service";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";
import { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

export type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";

/** One Ambiguous Citation Key, as the candidate picker is asked to show it. */
export interface AmbiguousCitekey {
  citekey: string;
  candidates: readonly AmbiguousCandidate[];
  /** Where the chosen candidate's Literature Note opens. */
  pane: NavigationPane;
}

/** What an open reports when it opens no note by itself. */
export type CitekeyEditorEvent =
  | { readonly _tag: "db-unavailable"; readonly citekey: string }
  | { readonly _tag: "citekey-not-found"; readonly citekey: string }
  | {
      readonly _tag: "item-unavailable";
      readonly reason: "database" | "item";
    }
  /** The citekey names several Items; a UI subscriber asks which one to open. */
  | {
      readonly _tag: "citekey-ambiguous";
      readonly ambiguous: AmbiguousCitekey;
    };

/** What the citekey editor treatment does under one settings snapshot. */
export interface CitekeyTreatment {
  /** Whether literal Citations expose ZotLit navigation. */
  readonly navigationEnabled: boolean;
  /** Whether Live Preview replaces complete Citations with formatted text. */
  readonly showFormatted: boolean;
  /** Whether the extension is installed at all. */
  readonly active: boolean;
  /** What hover answers with. */
  readonly hover: HoverPreferences;
}

/** The treatment `settings` ask for: nothing while Pandoc citations are off. */
export function citekeyTreatment(
  settings: Readonly<Settings>,
): CitekeyTreatment {
  const pandocCitations = settings["citation.pandoc-citations"];
  const navigationEnabled =
    pandocCitations && settings["citation.open-as-links"];
  const showFormatted = pandocCitations && settings["citation.show-formatted"];
  return {
    navigationEnabled,
    showFormatted,
    active: navigationEnabled || showFormatted,
    hover: hoverPreferences(settings),
  };
}

/**
 * The citekey editor treatment: literal Pandoc `@citekey` text opens the
 * Literature Note of the Zotero Item its native citation key names — the note
 * an Indexed Key already points at, or a note created from the matching Item.
 * An open that finds no single note reports why on `events`. An open never
 * fails: a defect is logged, and the open ends.
 */
export class CitekeyEditor extends Context.Service<
  CitekeyEditor,
  {
    /** What an open reports, from when the consumer's Stream starts. */
    readonly events: Stream.Stream<CitekeyEditorEvent>;
    /** The palette commands gate on this independently from presentation. */
    readonly navigationEnabled: Effect.Effect<boolean>;
    /**
     * The Literature Note a page preview may show: the one note indexed under
     * the Indexed Key a citekey resolves to. A citekey with zero or several
     * notes answers with nothing, which keeps every preview path clear of the
     * create-then-open flow. An Ambiguous Citation Key names no one Item, so
     * it answers with nothing too.
     */
    hoverNotePath(
      citekey: string,
      lookup?: CitationLookupAnswer | null,
    ): Effect.Effect<string | null>;
    /**
     * The Zotero Item a citekey names decides what opens: an existing note for
     * its Indexed Key wins, and only an Item with no note at all creates one.
     * A citekey naming several Items opens nothing by itself — it reports its
     * candidates, and the choice opens one of them exactly.
     */
    openCitekey(citekey: string, pane: NavigationPane): Effect.Effect<void>;
    /**
     * Opens one candidate of an Ambiguous Citation Key by its exact Indexed
     * Key. The candidate already carries the identity the picker showed, so
     * the Citation Key is never resolved again and the choice cannot re-enter
     * ambiguity.
     */
    openCandidate(
      candidate: AmbiguousCandidate,
      pane: NavigationPane,
    ): Effect.Effect<void>;
    /** Opens an exact Item using current database identity and Literature Note paths. */
    openIndexedKey(
      indexedKey: string,
      pane: NavigationPane,
    ): Effect.Effect<void>;
  }
>()("zotlit/citekey-editor/CitekeyEditor") {}

/**
 * The one Item a citekey names. An Ambiguous Citation Key answers with
 * nothing: it adopts no candidate's identity, so every surface reading this
 * treats it as a key that opens no single Item.
 */
function uniqueItem(
  citekey: string,
  lookup: CitationLookupAnswer,
): SnapshotItem | null {
  const resolved = heldResolution(lookup, citekey);
  return resolved?.kind === "unique" ? resolved.item : null;
}

/** A failure `report` answers for; an interrupt stays an interrupt. */
function reportFailure<A, E, R, B, R2>(
  effect: Effect.Effect<A, E, R>,
  report: (cause: Cause.Cause<E>) => Effect.Effect<B, never, R2>,
): Effect.Effect<A | B, never, R | R2> {
  return effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : report(cause),
    ),
  );
}

const log = withLogCategory("citekey-editor");
/**
 * An open ends when a read, the creation flow or Obsidian fails: the failure
 * or defect is logged here, and the caller runs the open fire-and-forget.
 */
const contained = logAndContinue("Cannot open the note", "citekey-editor");

export const layerCitekeyEditor = (
  creation: InteractiveCreationPorts,
): Layer.Layer<
  CitekeyEditor,
  never,
  | NoteFeature
  | Notifier
  | ZoteroPref
  | NoteIndex
  | ZoteroReads
  | CitationLookup
  | LibraryScope
  | PluginSettings
  | Workspace
> =>
  Layer.effect(
    CitekeyEditor,
    Effect.gen(function* () {
      const notes = yield* NoteIndex;
      const reads = yield* ZoteroReads;
      const lookup = yield* CitationLookup;
      const libraryScope = yield* LibraryScope;
      const settings = yield* PluginSettings;
      const workspace = yield* Workspace;
      const creationContext = yield* Effect.context<
        NoteFeature | Notifier | ZoteroPref
      >();
      const events = yield* Effect.acquireRelease(
        PubSub.unbounded<CitekeyEditorEvent>(),
        (pubsub) => PubSub.shutdown(pubsub),
      );
      const report = (event: CitekeyEditorEvent) =>
        PubSub.publish(events, event);

      /** The live Item an Indexed Key names, or `undefined` when none does. */
      const readItem = (indexedKey: string) =>
        reads.reads
          .ItemsByIndexedKeys({ indexedKeys: [indexedKey] })
          .pipe(Effect.map((items) => items.get(indexedKey)));

      const openNote = (path: string, pane: NavigationPane) =>
        workspace.openLinkText(path, "", {
          newLeaf: pane,
          state: { active: true },
        });

      /**
       * @param citekey the key the Item was reached by, for the not-found
       *   report an exact candidate has no key to name.
       */
      const openItem = Effect.fnUntraced(function* (
        item: SnapshotItem,
        pane: NavigationPane,
        citekey?: string,
      ) {
        const existing = resolveLiteratureNoteWithWarning(
          yield* notes.getNotesByItemKey(item.indexedKey),
        );
        if (existing) {
          yield* Effect.logDebug("Opened citekey note").pipe(
            Effect.annotateLogs({
              indexedKey: item.indexedKey,
              path: existing.path,
              branch: "existing",
            }),
          );
          yield* openNote(existing.path, pane);
          return;
        }

        // A failed read ends the open: the open's boundary logs it.
        const zoteroItem = yield* readItem(item.indexedKey);
        if (!zoteroItem) {
          yield* Effect.logDebug("Citekey open blocked").pipe(
            Effect.annotateLogs({
              indexedKey: item.indexedKey,
              branch: "citekey-not-found",
            }),
          );
          yield* report({
            _tag: "citekey-not-found",
            citekey: citekey ?? item.key,
          });
          return;
        }

        // A citation names one Item, so its note is created at once: the
        // flow asks for a Profile only where no Profile resolves.
        const file = yield* createNoteInteractively(creation, zoteroItem, {
          direct: true,
        }).pipe(
          Effect.provideContext(creationContext),
          Effect.catch((error) =>
            Effect.logError("Cannot create the citekey note").pipe(
              Effect.annotateLogs({ indexedKey: item.indexedKey, error }),
              Effect.as(null),
            ),
          ),
        );
        if (!file) {
          yield* Effect.logDebug("Citekey note creation cancelled").pipe(
            Effect.annotateLogs({ indexedKey: item.indexedKey }),
          );
          return;
        }
        yield* Effect.logDebug("Created citekey note").pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            path: file.path,
          }),
        );
        yield* openNote(file.path, pane);
      });

      return CitekeyEditor.of({
        events: Stream.fromPubSub(events),
        navigationEnabled: settings.current.pipe(
          Effect.map((current) => citekeyTreatment(current).navigationEnabled),
          Effect.withSpan("CitekeyEditor.navigationEnabled"),
        ),
        // Untraced: every hover over a citation reads it.
        hoverNotePath: Effect.fnUntraced(function* (citekey, answer) {
          const item = answer ? uniqueItem(citekey, answer) : null;
          if (!item) return null;
          const matches = yield* notes.getNotesByItemKey(item.indexedKey);
          return matches.length === 1 ? matches[0]!.path : null;
        }),
        openCitekey: Effect.fn("CitekeyEditor.openCitekey")(
          function* (citekey, pane) {
            const answer = yield* reportFailure(
              Effect.all(
                [notes.whenIndexed, lookup.read({ citekeys: [citekey] })],
                { concurrency: "unbounded" },
              ).pipe(Effect.map(([, answer]) => answer)),
              (cause) =>
                Effect.logWarning(
                  "Cannot resolve citekey for navigation",
                  cause,
                ).pipe(
                  Effect.annotateLogs({ citekey }),
                  Effect.andThen(report({ _tag: "db-unavailable", citekey })),
                  Effect.as(null),
                ),
            );
            if (answer === null) return;

            const resolved = answer.resolve(citekey);
            if (resolved.kind === "ambiguous") {
              yield* Effect.logDebug("Citekey names several items").pipe(
                Effect.annotateLogs({
                  citekey,
                  candidates: resolved.candidates.length,
                }),
              );
              const current = yield* libraryScope.current;
              const candidates = yield* describeCandidatesEffect(
                { db: reads, libraryScope: { current } },
                resolved.candidates,
              );
              yield* report({
                _tag: "citekey-ambiguous",
                ambiguous: { citekey, candidates, pane },
              });
              return;
            }
            if (resolved.kind === "missing") {
              const branch =
                (yield* reads.current).state === "ready"
                  ? "citekey-not-found"
                  : "db-unavailable";
              yield* Effect.logDebug("Citekey open blocked").pipe(
                Effect.annotateLogs({ citekey, branch }),
              );
              yield* report({ _tag: branch, citekey });
              return;
            }

            yield* openItem(resolved.item, pane, citekey);
          },
          contained,
          log,
        ),
        openCandidate: Effect.fn("CitekeyEditor.openCandidate")(
          function* (candidate, pane) {
            yield* notes.whenIndexed;
            yield* openItem(candidate, pane);
          },
          contained,
          log,
        ),
        openIndexedKey: Effect.fn("CitekeyEditor.openIndexedKey")(
          function* (indexedKey, pane) {
            yield* notes.whenIndexed;
            if ((yield* reads.current).state === "degraded") {
              yield* report({ _tag: "item-unavailable", reason: "database" });
              return;
            }
            const item = yield* reportFailure(readItem(indexedKey), (cause) =>
              Effect.logWarning("Cannot read Item for navigation", cause).pipe(
                Effect.annotateLogs({ indexedKey }),
                Effect.andThen(
                  report({ _tag: "item-unavailable", reason: "database" }),
                ),
                Effect.as(null),
              ),
            );
            if (item === null) return;
            if (!item) {
              yield* report({ _tag: "item-unavailable", reason: "item" });
              return;
            }
            yield* openItem(item, pane);
          },
          contained,
          log,
        ),
      });
    }),
  );
