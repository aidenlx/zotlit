// What this browser keeps between visits: the document being edited, the paper
// it is shown against, and the prompt the next visit answers. The draft and the
// snapshot are kept together, so a reload offers both or neither.

import { useEffect, useState } from "react";

import type { SaveSelectedProfileRequest } from "@zotlit/workbench/bridge";
import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import type { SampleItem } from "./fields";
import { clearDraft, readDraft, writeDraft } from "./transfer";
import type { WorkbenchDraft } from "./transfer";

/** The paper a fresh visit opens on. */
export const DEFAULT_SAMPLE = SAMPLE_ITEMS[0]!;

/**
 * The document this page keeps a draft for. A standalone reader edits one
 * document at a time, so the page holds one reference of its own; a connected
 * Workbench keys each vault document by the reference the bridge gave it.
 */
const STANDALONE_DOCUMENT = "standalone";

/** Quiet time after the last change before the draft is written. */
const AUTOSAVE_MS = 500;

/** The saved state a document is measured against: no draft while it holds. */
interface DocumentBaseline {
  readonly reference: string;
  readonly source: string;
  readonly snapshot: string;
}

const STANDALONE_BASELINE: DocumentBaseline = {
  reference: STANDALONE_DOCUMENT,
  source: DEFAULT_PROFILE_SOURCE,
  snapshot: snapshotIdentity(DEFAULT_SAMPLE),
};

/** The last visit's work, and the state it was measured against. */
export interface RestoreOffer {
  readonly draft: WorkbenchDraft;
  readonly baseline: DocumentBaseline;
}

/** A document as its source of truth holds it right now. */
interface SavedDocument {
  readonly reference: string;
  readonly source: string;
}

export interface WorkbenchDraftKeeper {
  /** The document this browser keeps a draft under. */
  readonly reference: string;
  /** The last visit's work, standing until the reader answers the prompt. */
  readonly restorable: RestoreOffer | null;
  /** Opens `document` as the state being edited, offering `kept` beside it. */
  adopt(document: SavedDocument, kept: WorkbenchDraft | null): void;
  /** Takes `document` as the saved state of the document being edited. */
  rebase(document: SavedDocument): void;
  /** Answers the prompt with the kept work, which the caller opens. */
  restore(): WorkbenchDraft | null;
  /** Answers the prompt by dropping what the last visit left. */
  startClean(): void;
}

export function useWorkbenchDraft({
  controller,
  revision,
  sample,
  expected,
}: {
  readonly controller: WorkbenchDocumentController;
  /** Counts the controller's changes, so the autosave follows the text. */
  readonly revision: number;
  readonly sample: SampleItem;
  /** The revision a connected Save expects, kept with the draft. */
  readonly expected?: SaveSelectedProfileRequest["expected"];
}): WorkbenchDraftKeeper {
  const [baseline, setBaseline] = useState(STANDALONE_BASELINE);
  const [reference, setReference] = useState(STANDALONE_DOCUMENT);
  // Read once, before the first autosave, so the record the last visit left is
  // the one the reader is offered.
  const [restorable, setRestorable] = useState<RestoreOffer | null>(() => {
    const draft = readDraft(STANDALONE_DOCUMENT);
    return draft ? { draft, baseline: STANDALONE_BASELINE } : null;
  });

  const atBaseline =
    reference === baseline.reference &&
    controller.source === baseline.source &&
    snapshotIdentity(sample) === baseline.snapshot;

  useEffect(() => {
    // The prompt stands over an untouched page alone: the first change answers
    // it the way Start clean does, so what the reader writes before answering
    // is kept, and Restore never lands on top of it.
    if (restorable) {
      const stillWaiting =
        reference === restorable.baseline.reference &&
        controller.source === restorable.baseline.source &&
        snapshotIdentity(sample) === restorable.baseline.snapshot;
      if (stillWaiting) return;
      setRestorable(null);
      return;
    }
    const source = controller.source;
    const timer = setTimeout(() => {
      if (atBaseline) clearDraft(reference);
      else
        writeDraft(reference, {
          source,
          snapshot: sample,
          ...(expected ? { expected } : {}),
        });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [
    restorable,
    atBaseline,
    reference,
    expected,
    controller,
    sample,
    revision,
  ]);

  return {
    reference,
    restorable,
    adopt({ reference: opened, source }, kept) {
      const next = {
        reference: opened,
        source,
        snapshot: snapshotIdentity(sample),
      };
      setReference(opened);
      setBaseline(next);
      setRestorable(kept ? { draft: kept, baseline: next } : null);
    },
    rebase({ reference: saved, source }) {
      setBaseline({
        reference: saved,
        source,
        snapshot: snapshotIdentity(sample),
      });
    },
    restore() {
      if (!restorable) return null;
      setRestorable(null);
      return restorable.draft;
    },
    startClean() {
      if (restorable) clearDraft(restorable.baseline.reference);
      setRestorable(null);
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
