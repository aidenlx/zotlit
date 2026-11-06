// What this browser keeps between visits: the document being edited, the paper
// it is shown against, and the prompt the next visit answers. One record covers
// both halves, and `transfer.ts` decides which storage each half is kept in, so
// a visit that outlived its tab is offered the text with the paper it still
// has. The keeper is atoms in the page's registry: its autosave is a quiet time
// a newer change interrupts.

import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";

import type { SampleItem } from "./fields";
import type { PageAtomRuntime } from "./runtime";
import { clearDraft, readDraft, writeDraft } from "./transfer";
import type { DraftLocation, WorkbenchDraft } from "./transfer";

/** The paper a fresh visit opens on. */
export const DEFAULT_SAMPLE = SAMPLE_ITEMS[0]!;

/**
 * The document this page keeps a draft for. A standalone reader edits one
 * document at a time, so the page holds one reference of its own; a connected
 * Workbench keys each vault document by the reference the bridge gave it.
 */
const STANDALONE_DOCUMENT = "standalone";

/** Where a page that has opened no vault document keeps its work. */
export const STANDALONE_LOCATION: DraftLocation = {
  reference: STANDALONE_DOCUMENT,
};

/** Quiet time after the last change before the draft is written. */
const AUTOSAVE_MS = 500;

/** The saved state a document is measured against: no draft while it holds. */
interface DocumentBaseline {
  readonly reference: string;
  readonly source: string;
  readonly snapshot: string;
  readonly annotationSelection: string;
}

const STANDALONE_BASELINE: DocumentBaseline = {
  reference: STANDALONE_DOCUMENT,
  source: DEFAULT_PROFILE_SOURCE,
  snapshot: snapshotIdentity(DEFAULT_SAMPLE),
  annotationSelection: SAMPLE_ANNOTATIONS[0]!.id,
};

/** The last visit's work, and the state it was measured against. */
interface RestoreOffer {
  readonly draft: WorkbenchDraft;
  readonly baseline: DocumentBaseline;
}

/** A document as its source of truth holds it right now. */
export interface SavedDocument {
  readonly reference: string;
  readonly source: string;
  /** The vault it was read from, which keeps two vaults' drafts apart. */
  readonly installationId?: string;
  readonly snapshot?: SampleItem;
  readonly annotationSelection?: string;
}

/** What is on screen now, as the keeper measures it. */
export interface DraftScreen {
  readonly source: Atom.Atom<string>;
  readonly sample: Atom.Atom<SampleItem>;
  readonly annotationSelection: Atom.Atom<string>;
  /** The connected revision a draft of the location answers for, if any. */
  readonly expected: Atom.Atom<
    SaveSelectedProfileRequest["expected"] | undefined
  >;
}

export interface DraftKeeper {
  /** Changes since the file was opened, downloaded, or saved to Obsidian. */
  readonly dirty: Atom.Atom<boolean>;
  /** Whether the last visit's work stands until the reader answers the prompt. */
  readonly restorable: Atom.Atom<boolean>;
  /** Opens `document` as the state being edited, offering `kept` beside it. */
  readonly adopt: (
    document: SavedDocument,
    kept: WorkbenchDraft | null,
  ) => void;
  /** Takes `document` as the saved state of the document being edited. */
  readonly rebase: (document: SavedDocument) => void;
  /** The offered draft, which the prompt hands over once. */
  readonly restore: () => WorkbenchDraft | null;
  readonly startClean: () => void;
  /** Keeps the autosave and the prompt running; returns the release. */
  readonly hold: () => () => void;
}

export function makeDraftKeeper({
  registry,
  runtime,
  location,
  screen,
}: {
  registry: AtomRegistry.AtomRegistry;
  runtime: PageAtomRuntime;
  location: Atom.Writable<DraftLocation>;
  screen: DraftScreen;
}): DraftKeeper {
  const baseline = Atom.make(STANDALONE_BASELINE);
  // Read once, before the first autosave, so the record the last visit left is
  // the one the reader is offered.
  const kept = readDraft(STANDALONE_LOCATION);
  const offer = Atom.make<RestoreOffer | null>(
    kept ? { draft: kept, baseline: STANDALONE_BASELINE } : null,
  );
  // The prompt stands over an untouched page alone: the first change answers
  // it the way Start clean does, so what the reader writes before answering is
  // kept, and Restore never lands on top of it.
  const untouched = Atom.make((get) => {
    const held = get(offer);
    if (held === null) return true;
    const { baseline: offered } = held;
    return (
      get(location).reference === offered.reference &&
      get(screen.source) === offered.source &&
      snapshotIdentity(get(screen.sample)) === offered.snapshot &&
      get(screen.annotationSelection) === offered.annotationSelection
    );
  });
  const autosave = runtime.atom((get) => {
    if (get(offer)) return Effect.void;
    const where = get(location);
    const held = get(baseline);
    const source = get(screen.source);
    const snapshot = get(screen.sample);
    const annotationSelection = get(screen.annotationSelection);
    const expected = get(screen.expected);
    const standalone = where.reference === STANDALONE_DOCUMENT;
    const atBaseline =
      where.reference === held.reference &&
      source === (standalone ? STANDALONE_BASELINE.source : held.source) &&
      snapshotIdentity(snapshot) ===
        (standalone ? STANDALONE_BASELINE.snapshot : held.snapshot) &&
      annotationSelection === STANDALONE_BASELINE.annotationSelection;
    return Effect.sleep(AUTOSAVE_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (atBaseline) clearDraft(where);
          else
            writeDraft(where, {
              source,
              snapshot,
              annotationSelection,
              ...(expected ? { expected } : {}),
            });
        }),
      ),
    );
  });
  const measured = (document: SavedDocument): DocumentBaseline => ({
    reference: document.reference,
    source: document.source,
    snapshot: snapshotIdentity(
      document.snapshot ?? registry.get(screen.sample),
    ),
    annotationSelection:
      document.annotationSelection ?? registry.get(screen.annotationSelection),
  });
  return {
    dirty: Atom.make((get) => get(screen.source) !== get(baseline).source),
    restorable: Atom.map(offer, (held) => held !== null),
    adopt(document, draft) {
      const next = measured(document);
      Atom.batch(() => {
        registry.set(
          location,
          document.installationId === undefined
            ? { reference: document.reference }
            : {
                reference: document.reference,
                installationId: document.installationId,
              },
        );
        registry.set(baseline, next);
        registry.set(offer, draft ? { draft, baseline: next } : null);
      });
    },
    rebase(document) {
      const next = measured(document);
      Atom.batch(() => {
        registry.set(baseline, next);
        // Recovering the launch paper is part of hydration. The pending offer
        // follows that paper while keeping the draft and text it was offered on.
        if (document.snapshot)
          registry.update(offer, (held) =>
            held
              ? {
                  ...held,
                  baseline: {
                    ...held.baseline,
                    snapshot: next.snapshot,
                    annotationSelection: next.annotationSelection,
                  },
                }
              : null,
          );
      });
    },
    restore() {
      const held = registry.get(offer);
      if (!held) return null;
      registry.set(offer, null);
      return held.draft;
    },
    startClean() {
      if (registry.get(offer)) clearDraft(registry.get(location));
      registry.set(offer, null);
    },
    hold() {
      const releases = [
        registry.mount(baseline),
        registry.mount(offer),
        registry.mount(autosave),
        registry.subscribe(
          untouched,
          (still) => {
            if (!still) registry.set(offer, null);
          },
          { immediate: true },
        ),
      ];
      return () => {
        for (const release of releases.reverse()) release();
      };
    },
  };
}

/** The paper a draft was shown against, as one comparable name. */
function snapshotIdentity(snapshot: SampleItem): string {
  const provenance =
    snapshot.provenance.kind === "sample"
      ? `sample:${snapshot.provenance.id}`
      : `connected:${snapshot.provenance.installationId}`;
  return `${provenance}:${snapshot.item.key}:${snapshot.revision}`;
}
