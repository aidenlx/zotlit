// View atoms the Cited By Sidebar alone reads: previews of the citing notes,
// their vault facts for sorting, and the commands that open them. Shared by
// every Cited By leaf through the plugin's view registry.
import { Effect, Option, Semaphore, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { PaneType } from "obsidian";

import { withLogCategory } from "@/lib/effect-log";
import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { held, viewRuntime } from "@/lib/view-atoms";
import { activeCitedByAtom } from "@/services/citation-index/atoms";
import { CitationIndex } from "@/services/citation-index/service";
import type {
  CitationOccurrence,
  CitedByGroup,
} from "@/services/citation-index/service";

import { sourceOutline } from "./store";
import type { CitedByPreview, SourceFileFacts } from "./store";

/**
 * How often each note changed this session: its metadata was indexed again,
 * it moved (old and new path), or it was deleted. One listener serves every
 * preview; a note no event named reads 0.
 */
export const revisionsAtom: Atom.Atom<Readonly<Record<string, number>>> = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const metadata = yield* MetadataCache;
      const vault = yield* Vault;
      const touched = Stream.merge(
        Stream.map(filterTag(metadata.changes, "changed"), (event) => [
          event.file.path,
        ]),
        Stream.map(filterTag(vault.changes, "rename", "delete"), (event) =>
          event._tag === "rename"
            ? [event.oldPath, event.file.path]
            : [event.file.path],
        ),
      );
      return Stream.scan(
        touched,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, paths) => ({
          ...revisions,
          ...Object.fromEntries(
            paths.map((path) => [path, (revisions[path] ?? 0) + 1]),
          ),
        }),
      );
    }),
  ),
  {},
);

/** One note's revision; an unchanged note stops here. */
const revisionAtom = Atom.family((path: string) =>
  Atom.map(revisionsAtom, (revisions) => revisions[path] ?? 0),
);

const LOADING: CitedByPreview = { status: "loading" };
const UNAVAILABLE: CitedByPreview = { status: "unavailable" };

/** One parse at a time across every preview, so a long list never floods the host. */
const reads = Semaphore.makeUnsafe(1);

const readPreview = (path: string) =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const file = yield* vault.getFileByPath(path);
    if (!file) return UNAVAILABLE;
    const index = yield* CitationIndex;
    const facts = yield* reads.withPermits(1)(index.getParsedNote(file));
    // Read after the parse, so the cache is at least as new as the source.
    const cache = yield* (yield* MetadataCache).fileCache(file);
    return {
      status: "ready",
      facts,
      source: facts.source,
      outline: sourceOutline(cache),
      cache,
    } satisfies CitedByPreview;
  });

/**
 * The preview of one citing note: loading, then its source and parse. A new
 * revision of the note reads it again and interrupts a read in progress; the
 * last preview shows until the new one lands.
 */
export const previewAtom = Atom.family(
  (path: string): Atom.Atom<CitedByPreview> =>
    Atom.map(
      viewRuntime.atom((get) => {
        get(revisionAtom(path));
        return readPreview(path);
      }),
      (result) =>
        Option.getOrElse(AsyncResult.value(result), () =>
          AsyncResult.isFailure(result) ? UNAVAILABLE : LOADING,
        ),
    ),
);

/**
 * The preview of every group in the followed note's Cited By, collapsed groups
 * included: the search filter reads their text too.
 */
export const activePreviewsAtom: Atom.Atom<
  Readonly<Record<string, CitedByPreview>>
> = Atom.make((get) =>
  Object.fromEntries(
    (get(activeCitedByAtom)?.groups ?? []).map(({ path }) => [
      path,
      get(previewAtom(path)),
    ]),
  ),
);

/** The vault facts the sort modes read from one citing note; `null` once it left the vault. */
const sourceFactsAtom = Atom.family(
  (path: string): Atom.Atom<SourceFileFacts | null> =>
    Atom.map(
      viewRuntime.atom((get) => {
        get(revisionAtom(path));
        return Effect.gen(function* () {
          const file = yield* (yield* Vault).getFileByPath(path);
          if (!file) return null;
          const { mtime, ctime } = file.stat;
          return { name: file.basename, mtime, ctime };
        });
      }),
      (result) => Option.getOrNull(AsyncResult.value(result)),
    ),
);

/** The sort facts of every group in the followed note's Cited By. */
export const activeSourceFactsAtom: Atom.Atom<
  Readonly<Record<string, SourceFileFacts | null>>
> = Atom.make((get) =>
  Object.fromEntries(
    (get(activeCitedByAtom)?.groups ?? []).map(({ path }) => [
      path,
      get(sourceFactsAtom(path)),
    ]),
  ),
);

/** Opens a citing note in the pane `newLeaf` names. */
export const openSourceCommand = viewRuntime.fn(
  (options: { readonly path: string; readonly newLeaf: PaneType | boolean }) =>
    Effect.gen(function* () {
      yield* (yield* Workspace).openLinkText(options.path, "", {
        newLeaf: options.newLeaf,
      });
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Could not open the citing note", error),
      ),
      withLogCategory("cited-by"),
    ),
);

/**
 * Opens a citing note and reveals one occurrence where the note's current
 * source still holds it. A stale occurrence, or a note that cannot be read,
 * opens the note alone.
 */
export const openOccurrenceCommand = viewRuntime.fn(
  (options: {
    readonly group: CitedByGroup;
    readonly occurrence: CitationOccurrence;
    readonly newLeaf: PaneType | boolean;
  }) =>
    Effect.gen(function* () {
      const { group, occurrence, newLeaf } = options;
      const workspace = yield* Workspace;
      const file = yield* (yield* Vault).getFileByPath(group.path);
      const index = yield* CitationIndex;
      const current = file
        ? yield* index.getParsedNote(file).pipe(
            Effect.map((facts) => facts.currentOccurrence(occurrence)),
            // Opening the note stays useful when its source cannot be read.
            Effect.orElseSucceed(() => null),
          )
        : null;
      yield* workspace.openLinkText(group.path, "", { newLeaf });
      if (!current) return;
      const active = yield* workspace.activeMarkdownView;
      const view =
        active?.file?.path === group.path
          ? active
          : (yield* workspace.markdownViews).find(
              (candidate) => candidate.file?.path === group.path,
            );
      if (!view) return;
      yield* workspace.setActiveLeaf(view.leaf, { focus: true });
      const { start, end } = current.position;
      // The same reveal as `revealMarkdownOccurrence` (views/reveal-occurrence.ts).
      yield* Effect.sync(() =>
        view.setEphemeralState({
          startLoc: start,
          endLoc: end,
          line: start.line,
        }),
      );
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Could not open the citing note", error),
      ),
      withLogCategory("cited-by"),
    ),
);
