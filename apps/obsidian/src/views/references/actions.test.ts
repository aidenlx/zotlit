// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipboardRepresentation } from "@/lib/clipboard";
import { ambiguousCandidates } from "@/services/citation-index/__fixtures__/ambiguous-candidates";
import type {
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";

import { createReferenceActions } from "./actions";
import type { CopyBibliographySnapshot, ReferenceActions } from "./actions";
import type { CopiedBibliography } from "./copied-bibliography";
import type { ReferenceEntry } from "./entries";
import type { ReferencesCopyTarget } from "./store";

/** What the toolbar offered when the copy action was clicked. */
const offered: ReferencesCopyTarget = {
  path: "notes/tidal.md",
  generation: 7,
};

function snapshot(
  overrides: Partial<CopyBibliographySnapshot> = {},
): CopyBibliographySnapshot {
  return {
    ...offered,
    entries: [
      {
        marker: [{ t: "Str", c: "[1]" }],
        content: [
          { t: "Str", c: "Rivers, A. (2020)." },
          { t: "Space" },
          { t: "Emph", c: [{ t: "Str", c: "Field notes" }] },
          { t: "Str", c: ". Harbour Press." },
        ],
      },
    ],
    ...overrides,
  };
}

let getCopySnapshot: ReturnType<
  typeof vi.fn<() => CopyBibliographySnapshot | null>
>;
let writeClipboard: ReturnType<
  typeof vi.fn<
    (content: CopiedBibliography) => Promise<ClipboardRepresentation>
  >
>;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;

function build(): ReferenceActions {
  return createReferenceActions({
    app: {} as App,
    getSourcePath: () => "notes/tidal.md",
    openCitekey: () => undefined,
    onOpenEngineSettings: () => undefined,
    onChangeStyle: () => undefined,
    onDismissEngineHint: () => undefined,
    getCopySnapshot,
    writeClipboard,
    notify,
  });
}

beforeEach(() => {
  getCopySnapshot = vi.fn(() => snapshot());
  writeClipboard = vi.fn(() =>
    Promise.resolve<ClipboardRepresentation>("rich"),
  );
  notify = vi.fn();
});

describe("onOpenNote", () => {
  /** One occurrence of the citekey, which is what a row would open by. */
  const occurrence: CitationOccurrence = {
    kind: "citekey",
    raw: "doe2024",
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: 8, offset: 8 },
    },
  };

  function openNote(entry: ReferenceEntry) {
    const openCitekey = vi.fn();
    const openLinkText = vi.fn();
    createReferenceActions({
      app: { workspace: { openLinkText } } as unknown as App,
      getSourcePath: () => "notes/tidal.md",
      openCitekey,
      onOpenEngineSettings: () => undefined,
      onChangeStyle: () => undefined,
      onDismissEngineHint: () => undefined,
      getCopySnapshot,
      writeClipboard,
      notify,
    }).onOpenNote(entry);
    return { openCitekey, openLinkText };
  }

  // The key names several Items, so no one note is this row's to open — and
  // creating one would put the wrong Item's note in the vault.
  it("reaches no note for an Ambiguous Citation Key", () => {
    const { openCitekey, openLinkText } = openNote({
      id: "@doe2024",
      refNumber: 1,
      occurrences: [occurrence],
      kind: "ambiguous",
      citekey: "doe2024",
      candidates: ambiguousCandidates,
    });

    expect(openCitekey).not.toHaveBeenCalled();
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("creates and opens the note of a cited Item that has none yet", () => {
    const { openCitekey } = openNote({
      id: "BOOK0001",
      refNumber: 1,
      occurrences: [occurrence],
      kind: "summary",
      source: {} as ReferenceSource,
      linkpath: null,
    });

    expect(openCitekey).toHaveBeenCalledExactlyOnceWith("doe2024");
  });
});

describe("onCopyBibliography", () => {
  it("writes both representations of the snapshot and reports the copy", async () => {
    await build().onCopyBibliography(offered);

    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith({
      html: "<p>[1] Rivers, A. (2020). <em>Field notes</em>. Harbour Press.</p>",
      text: "[1] Rivers, A. (2020). Field notes. Harbour Press.",
    });
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Bibliography snapshot copied.",
    );
  });

  it("names the plain-text fallback the platform fell back to", async () => {
    writeClipboard.mockResolvedValue("text");
    await build().onCopyBibliography(offered);

    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Bibliography copied as plain text.",
    );
  });

  it("asks for a retry when the note changed before the write", async () => {
    getCopySnapshot.mockReturnValue(snapshot({ path: "notes/estuary.md" }));
    await build().onCopyBibliography(offered);

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("asks for a retry when a newer render replaced the snapshot", async () => {
    getCopySnapshot.mockReturnValue(snapshot({ generation: 8 }));
    await build().onCopyBibliography(offered);

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("asks for a retry when readiness went away before the write", async () => {
    getCopySnapshot.mockReturnValue(null);
    await build().onCopyBibliography(offered);

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("reports a clipboard the platform refused", async () => {
    writeClipboard.mockRejectedValue(new Error("clipboard unavailable"));
    await build().onCopyBibliography(offered);

    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Could not copy bibliography.",
    );
  });
});
