// References reads and commands, shared where they need no leaf state.
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { withLogCategory } from "@/lib/effect-log";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { held, viewRuntime } from "@/lib/view-atoms";
import type { CitationOccurrence } from "@/services/citation-index/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { activeNoteAtom } from "@/services/note-index/atoms";
import {
  documentPresentation,
  profileReaderOf,
  samePresentation,
} from "@/services/pandoc/document-presentation";
import type { DocumentPresentation } from "@/services/pandoc/document-presentation";
import { PandocEngine } from "@/services/pandoc/service";
import { Profile } from "@/services/profile/service";
import { flashOccurrence } from "@/views/reveal-occurrence";

export const metadataRevisionAtom = held(
  Stream.unwrap(
    Effect.map(MetadataCache, (metadata) =>
      Stream.scan(
        metadata.changes,
        () => 0,
        (revision) => revision + 1,
      ),
    ),
  ),
  0,
);
const profileRevisionAtom = held(
  Stream.unwrap(
    Effect.map(Profile, (profile) =>
      Stream.scan(
        profile.changes,
        () => 0,
        (revision) => revision + 1,
      ),
    ),
  ),
  0,
);

export interface ReferencesSelection {
  readonly file: TFile | null;
  readonly path: string | null;
  readonly presentation: DocumentPresentation;
  readonly ready: boolean;
}
const NO_SELECTION: ReferencesSelection = {
  file: null,
  path: null,
  presentation: { kind: "read", presentation: {} },
  ready: false,
};
const selectionRead = viewRuntime.atom((get) => {
  const { path } = get(activeNoteAtom);
  get(metadataRevisionAtom);
  get(profileRevisionAtom);
  return Effect.gen(function* () {
    const file = path ? yield* (yield* Vault).getFileByPath(path) : null;
    const markdown = file?.extension === "md" ? file : null;
    const metadata = yield* MetadataCache;
    const profile = yield* Profile;
    const run = Effect.runSyncWith(yield* Effect.context<never>());
    const reader = profileReaderOf(profile, run);
    const cache = markdown ? yield* metadata.fileCache(markdown) : null;
    return {
      file: markdown,
      path: markdown?.path ?? null,
      ready: reader.loaded,
      presentation: markdown
        ? documentPresentation({ getFileCache: () => cache }, markdown, reader)
        : NO_SELECTION.presentation,
    } satisfies ReferencesSelection;
  });
});

/** Equal presentation reads leave the current scan and render standing. */
export const referencesSelectionAtom = Atom.make((get): ReferencesSelection => {
  const result = get(selectionRead);
  const previous = Option.getOrElse(
    get.self<ReferencesSelection>(),
    () => NO_SELECTION,
  );
  if (AsyncResult.isFailure(result)) return previous;
  const next = Option.getOrElse(AsyncResult.value(result), () => previous);
  return next.path === previous.path &&
    next.ready === previous.ready &&
    samePresentation(next.presentation, previous.presentation)
    ? previous
    : next;
});

/** A note open can finish after its source pane closes or another pane opens a note. */
export const openIndexedKeyCommand = Atom.keepAlive(
  viewRuntime.fn(
    (key: string) =>
      Effect.gen(function* () {
        yield* (yield* CitekeyEditor).openIndexedKey(key, false);
      }).pipe(withLogCategory("references")),
    { concurrent: true },
  ),
);
export const dismissEngineHintCommand = viewRuntime.fn(() =>
  Effect.gen(function* () {
    yield* (yield* PandocEngine).decline;
  }),
);

export const openReferenceLinkCommand = viewRuntime.fn(
  (target: { readonly linkpath: string; readonly sourcePath: string }) =>
    Effect.gen(function* () {
      yield* (yield* Workspace).openLinkText(
        target.linkpath,
        target.sourcePath,
        { newLeaf: false },
      );
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Could not open the Literature Note", { error }),
      ),
      withLogCategory("references"),
    ),
);

export const revealReferenceOccurrenceCommand = viewRuntime.fn(
  (target: {
    readonly sourcePath: string;
    readonly occurrence: CitationOccurrence;
  }) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      const view = (yield* workspace.markdownViews).find(
        (view) => view.file?.path === target.sourcePath,
      );
      if (!view) return;
      yield* workspace.setActiveLeaf(view.leaf, { focus: true });
      yield* Effect.sync(() => flashOccurrence(view, target.occurrence));
    }),
);
