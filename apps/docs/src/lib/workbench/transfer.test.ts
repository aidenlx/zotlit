// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import {
  clearDraft,
  downloadProfile,
  profileFileName,
  readDraft,
  writeDraft,
} from "./transfer";

const REFERENCE = "standalone";
const KEY = `zotlit.workbench.draft.${REFERENCE}`;
const SNAPSHOT = SAMPLE_ITEMS[0]!;

// This environment carries no Storage of its own, so each test starts on one
// that behaves as a browser's does.
beforeEach(() => {
  const entries = new Map<string, string>();
  install({
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  });
});

describe("the downloaded file", () => {
  it("names a parsed profile by its ID, and says when it is a draft", () => {
    expect(profileFileName("scholar", { draft: false })).toBe(
      "zotlit-profile.scholar.md",
    );
    expect(profileFileName("scholar", { draft: true })).toBe(
      "zotlit-profile.scholar.draft.md",
    );
    // A draft the parser refuses carries no manifest, so it has no ID to name.
    expect(profileFileName(undefined, { draft: true })).toBe(
      "zotlit-profile.draft.md",
    );
  });

  it("hands back the bytes a CRLF document was opened with", async () => {
    const imported = DEFAULT_PROFILE_SOURCE.replaceAll("\n", "\r\n");
    const controller = new WorkbenchDocumentController(imported);
    const file = await capture(() =>
      downloadProfile(controller.source, "zotlit-profile.md"),
    );
    expect(file.name).toBe("zotlit-profile.md");
    expect(file.text).toBe(imported);
  });
});

describe("the kept draft", () => {
  it("comes back as it was written, and is gone once cleared", () => {
    writeDraft(REFERENCE, { source: "# draft", snapshot: SNAPSHOT });
    expect(readDraft(REFERENCE)).toEqual({
      source: "# draft",
      snapshot: SNAPSHOT,
    });
    clearDraft(REFERENCE);
    expect(readDraft(REFERENCE)).toBeNull();
  });

  it("is one record per document reference", () => {
    writeDraft(REFERENCE, { source: "# draft", snapshot: SNAPSHOT });
    expect(readDraft("vault:profiles/scholar.md")).toBeNull();
  });

  it("reads an empty, unreadable, or outdated record as none", () => {
    expect(readDraft(REFERENCE)).toBeNull();
    localStorage.setItem(KEY, "not json");
    expect(readDraft(REFERENCE)).toBeNull();
    localStorage.setItem(
      KEY,
      JSON.stringify({ source: "# draft", snapshot: { contractVersion: 1 } }),
    );
    expect(readDraft(REFERENCE)).toBeNull();
  });

  it("keeps a blocked storage from reaching the reader", () => {
    // A browser with site data denied throws on the property itself.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("The user denied permission to access site data.");
      },
    });
    expect(() =>
      writeDraft(REFERENCE, { source: "# draft", snapshot: SNAPSHOT }),
    ).not.toThrow();
    expect(readDraft(REFERENCE)).toBeNull();
    expect(() => clearDraft(REFERENCE)).not.toThrow();
  });
});

/** Puts `storage` where the page reads its own. */
function install(storage: object): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

/** The file the browser was handed: what it is called, and what is in it. */
async function capture(
  run: () => void,
): Promise<{ name: string; text: string }> {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:workbench";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      names.push(this.download);
    },
  );
  try {
    run();
  } finally {
    vi.restoreAllMocks();
  }
  return { name: names[0]!, text: await blobs[0]!.text() };
}
