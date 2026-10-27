// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { ClipboardRepresentation } from "@/lib/clipboard";
import { ambiguousCandidates } from "@/services/citation-index/__fixtures__/ambiguous-candidates";
import type {
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";

import {
  copyBibliography,
  copyBibliographyMessage,
  createReferenceActions,
} from "./actions";
import type {
  CopyBibliographyOutcome,
  CopyBibliographySnapshot,
} from "./actions";
import type { CopiedBibliography } from "./copied-bibliography";
import type { ReferenceEntry } from "./entries";
import type { ReferencesCopyTarget } from "./state";

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

function copy() {
  return copyBibliography({ getCopySnapshot, writeClipboard }, offered);
}

beforeEach(() => {
  getCopySnapshot = vi.fn(() => snapshot());
  writeClipboard = vi.fn(() =>
    Promise.resolve<ClipboardRepresentation>("rich"),
  );
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
    const openIndexedKey = vi.fn();
    const openLinkText = vi.fn();
    createReferenceActions({
      app: stubService<App>("App", {
        workspace: stubService<App["workspace"]>("Workspace", {
          openLinkText: (
            ...args: Parameters<App["workspace"]["openLinkText"]>
          ) => openLinkText(...args),
        }),
      }),
      getSourcePath: () => "notes/tidal.md",
      openIndexedKey,
      openLinkText,
      nextOccurrence: () => 0,
      revealOccurrence: () => undefined,
      onOpenEngineSettings: () => undefined,
      onChangeStyle: () => undefined,
      onDismissEngineHint: () => undefined,
      getCopySnapshot,
      writeClipboard,
      reportCopy: () => undefined,
    }).onOpenNote(entry);
    return { openIndexedKey, openLinkText };
  }

  // The key names several Items, so no one note is this row's to open — and
  // creating one would put the wrong Item's note in the vault.
  it("reaches no note for an Ambiguous Citation Key", () => {
    const { openIndexedKey, openLinkText } = openNote({
      id: "@doe2024",
      refNumber: 1,
      occurrences: [occurrence],
      kind: "ambiguous",
      citekey: "doe2024",
      candidates: ambiguousCandidates,
    });

    expect(openIndexedKey).not.toHaveBeenCalled();
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("#1693 opens an annotation-only parent's note by Indexed Key without a Citation Key", () => {
    const { openIndexedKey } = openNote({
      id: "NCKEY234",
      refNumber: 1,
      occurrences: [{ ...occurrence, kind: "annotation", raw: "ANNNCKEY" }],
      kind: "summary",
      source: { citekey: null } as ReferenceSource,
      linkpath: null,
    });
    expect(openIndexedKey).toHaveBeenCalledExactlyOnceWith("NCKEY234");
  });
});

describe("copyBibliography", () => {
  it("writes both representations of the snapshot", async () => {
    expect(await copy()).toEqual({ kind: "copied", representation: "rich" });

    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith({
      html: "<p>[1] Rivers, A. (2020). <em>Field notes</em>. Harbour Press.</p>",
      text: "[1] Rivers, A. (2020). Field notes. Harbour Press.",
    });
  });

  it("answers the plain-text fallback the platform fell back to", async () => {
    writeClipboard.mockResolvedValue("text");

    expect(await copy()).toEqual({ kind: "copied", representation: "text" });
  });

  it.each([
    ["the note changed", snapshot({ path: "notes/estuary.md" })],
    ["a newer render replaced the snapshot", snapshot({ generation: 8 })],
    ["readiness went away", null],
  ])("refuses the copy when %s before the write", async (_case, held) => {
    getCopySnapshot.mockReturnValue(held);

    expect(await copy()).toEqual({ kind: "changed" });
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("answers a clipboard the platform refused", async () => {
    writeClipboard.mockRejectedValue(new Error("clipboard unavailable"));

    expect(await copy()).toEqual({ kind: "failed" });
  });
});

describe("onCopyBibliography", () => {
  it("hands the copy's outcome to the seam that reports it", async () => {
    const reportCopy = vi.fn<(outcome: CopyBibliographyOutcome) => void>();
    writeClipboard.mockResolvedValue("text");

    await createReferenceActions({
      app: stubService<App>("App", {}),
      getSourcePath: () => "notes/tidal.md",
      openIndexedKey: () => undefined,
      openLinkText: () => undefined,
      nextOccurrence: () => 0,
      revealOccurrence: () => undefined,
      onOpenEngineSettings: () => undefined,
      onChangeStyle: () => undefined,
      onDismissEngineHint: () => undefined,
      getCopySnapshot,
      writeClipboard,
      reportCopy,
    }).onCopyBibliography(offered);

    expect(reportCopy).toHaveBeenCalledExactlyOnceWith({
      kind: "copied",
      representation: "text",
    });
  });
});

describe("copyBibliographyMessage", () => {
  it.each([
    [
      { kind: "copied", representation: "rich" },
      "Bibliography snapshot copied.",
    ],
    [
      { kind: "copied", representation: "text" },
      "Bibliography copied as plain text.",
    ],
    [{ kind: "changed" }, "References changed. Try again."],
    [{ kind: "failed" }, "Could not copy bibliography."],
  ] satisfies [CopyBibliographyOutcome, string][])(
    "reports %o as %s",
    (outcome, message) => {
      expect(copyBibliographyMessage(outcome)).toBe(message);
    },
  );
});
