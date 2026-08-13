// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReferenceActions } from "./actions";
import type { CopyBibliographySnapshot, ReferenceActions } from "./actions";

function snapshot(
  overrides: Partial<CopyBibliographySnapshot> = {},
): CopyBibliographySnapshot {
  const content = document.createDocumentFragment();
  content.append("Rivers, A. (2020). Field notes. Harbour Press.");
  return {
    path: "notes/tidal.md",
    generation: 7,
    entries: [{ marker: "[1]", content }],
    ...overrides,
  };
}

let getCopySnapshot: ReturnType<
  typeof vi.fn<() => CopyBibliographySnapshot | null>
>;
let writeClipboard: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
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
  writeClipboard = vi.fn(() => Promise.resolve());
  notify = vi.fn();
});

describe("onCopyBibliography", () => {
  it("writes the serialized snapshot and reports the copy", async () => {
    await build().onCopyBibliography();

    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(
      "[1] Rivers, A. (2020). Field notes. Harbour Press.",
    );
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Bibliography snapshot copied.",
    );
  });

  it("writes nothing while no bibliography is ready", async () => {
    getCopySnapshot.mockReturnValue(null);
    await build().onCopyBibliography();

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("asks for a retry when the note changed before the write", async () => {
    getCopySnapshot
      .mockReturnValueOnce(snapshot())
      .mockReturnValueOnce(snapshot({ path: "notes/estuary.md" }));
    await build().onCopyBibliography();

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("asks for a retry when a newer render replaced the snapshot", async () => {
    getCopySnapshot
      .mockReturnValueOnce(snapshot())
      .mockReturnValueOnce(snapshot({ generation: 8 }));
    await build().onCopyBibliography();

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("asks for a retry when the bibliography went stale before the write", async () => {
    getCopySnapshot.mockReturnValueOnce(snapshot()).mockReturnValueOnce(null);
    await build().onCopyBibliography();

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "References changed. Try again.",
    );
  });

  it("reports a clipboard the platform refused", async () => {
    writeClipboard.mockRejectedValue(new Error("clipboard unavailable"));
    await build().onCopyBibliography();

    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Could not copy bibliography.",
    );
  });
});
