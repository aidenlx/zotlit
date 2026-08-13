// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipboardRepresentation } from "@/lib/clipboard";

import { createReferenceActions } from "./actions";
import type { CopyBibliographySnapshot, ReferenceActions } from "./actions";
import type { CopiedBibliography } from "./copied-bibliography";
import type { ReferencesCopyTarget } from "./store";

/** What the toolbar offered when the copy action was clicked. */
const offered: ReferencesCopyTarget = {
  path: "notes/tidal.md",
  generation: 7,
};

function snapshot(
  overrides: Partial<CopyBibliographySnapshot> = {},
): CopyBibliographySnapshot {
  const content = document.createDocumentFragment();
  const emphasis = document.createElement("i");
  emphasis.append("Field notes");
  content.append("Rivers, A. (2020). ", emphasis, ". Harbour Press.");
  return {
    ...offered,
    entries: [{ marker: "[1]", content }],
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

describe("onCopyBibliography", () => {
  it("writes both representations of the snapshot and reports the copy", async () => {
    await build().onCopyBibliography(offered);

    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith({
      html: "<p>[1] Rivers, A. (2020). <i>Field notes</i>. Harbour Press.</p>",
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
