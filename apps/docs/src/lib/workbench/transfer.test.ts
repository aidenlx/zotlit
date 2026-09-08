// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import {
  clearDraft,
  openProfileInObsidian,
  createProfileHandoffSource,
  downloadProfile,
  profileFileName,
  readDraft,
  writeDraft,
} from "./transfer";

const STANDALONE = { reference: "standalone" };
const KEY = `zotlit.workbench.draft.${STANDALONE.reference}`;
const SNAPSHOT = SAMPLE_ITEMS[0]!;
/** The document a vault opened, and the paper the vault handed over with it. */
const VAULT = { reference: "profile:default", installationId: "vault-1" };
const VAULT_KEY = `zotlit.workbench.draft.${VAULT.installationId}.${VAULT.reference}`;
const VAULT_SNAPSHOT_KEY = `zotlit.workbench.snapshot.${VAULT.installationId}.${VAULT.reference}`;
const VAULT_PAPER = {
  ...SNAPSHOT,
  provenance: {
    kind: "connected",
    installationId: VAULT.installationId,
    vault: "Fixture vault",
  },
} as const satisfies typeof SNAPSHOT;

// This environment carries no Storage of its own, so each test starts on one
// that behaves as a browser's does.
beforeEach(() => {
  install("localStorage");
  install("sessionStorage");
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
    writeDraft(STANDALONE, { source: "# draft", snapshot: SNAPSHOT });
    expect(readDraft(STANDALONE)).toEqual({
      source: "# draft",
      snapshot: SNAPSHOT,
    });
    clearDraft(STANDALONE);
    expect(readDraft(STANDALONE)).toBeNull();
  });

  it("is one record per document reference", () => {
    writeDraft(STANDALONE, { source: "# draft", snapshot: SNAPSHOT });
    expect(readDraft({ reference: "vault:profiles/scholar.md" })).toBeNull();
  });

  it("keeps one vault's draft apart from another vault's", () => {
    writeDraft(VAULT, { source: "# one vault" });
    expect(
      readDraft({ reference: VAULT.reference, installationId: "vault-2" }),
    ).toBeNull();
    expect(readDraft(VAULT)?.source).toBe("# one vault");
  });

  it("keeps a vault paper for the tab and the draft for the browser", () => {
    writeDraft(VAULT, { source: "# draft", snapshot: VAULT_PAPER });

    // The text persists; the paper the vault handed over does not.
    expect(JSON.parse(localStorage.getItem(VAULT_KEY)!)).toEqual({
      source: "# draft",
    });
    expect(JSON.parse(sessionStorage.getItem(VAULT_SNAPSHOT_KEY)!)).toEqual(
      VAULT_PAPER,
    );

    // A reload keeps the tab, so the paper is still there to come back to.
    expect(readDraft(VAULT)).toEqual({
      source: "# draft",
      snapshot: VAULT_PAPER,
    });

    // Closing the tab empties session storage; the draft stands without it.
    install("sessionStorage");
    expect(readDraft(VAULT)).toEqual({ source: "# draft" });
  });

  it("keeps a Sample Item in the record the browser holds", () => {
    writeDraft(STANDALONE, { source: "# draft", snapshot: SNAPSHOT });

    expect(JSON.parse(localStorage.getItem(KEY)!).snapshot).toEqual(SNAPSHOT);
    install("sessionStorage");
    expect(readDraft(STANDALONE)).toEqual({
      source: "# draft",
      snapshot: SNAPSHOT,
    });
  });

  it("reads an empty, unreadable, or outdated record as none", () => {
    expect(readDraft(STANDALONE)).toBeNull();
    localStorage.setItem(KEY, "not json");
    expect(readDraft(STANDALONE)).toBeNull();
    localStorage.setItem(
      KEY,
      JSON.stringify({ source: "# draft", snapshot: { contractVersion: 1 } }),
    );
    expect(readDraft(STANDALONE)).toBeNull();
  });

  it("keeps a blocked storage from reaching the reader", () => {
    // A browser with site data denied throws on the property itself.
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error("The user denied permission to access site data.");
        },
      });
    }
    expect(() =>
      writeDraft(STANDALONE, { source: "# draft", snapshot: SNAPSHOT }),
    ).not.toThrow();
    expect(readDraft(STANDALONE)).toBeNull();
    expect(() => clearDraft(STANDALONE)).not.toThrow();
  });
});

/** Puts a storage that behaves as a browser's does where the page reads one. */
function install(name: "localStorage" | "sessionStorage"): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    },
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

describe("Open in Obsidian", () => {
  it("waits for the exact source to reach the clipboard before opening the URI", async () => {
    const clipboard = Promise.withResolvers<void>();
    const writeText = vi.fn(() => clipboard.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const opened: string[] = [];
    using _click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        opened.push(this.href);
      });
    const source = "---\r\nid: Research1234\r\n---\r\nA paper.";
    const handoff = openProfileInObsidian(source);
    expect(writeText).toHaveBeenCalledWith(source);
    expect(opened).toEqual([]);
    clipboard.resolve();
    await handoff;
    expect(opened).toEqual(["obsidian://zotlit/import-profile?clipboard=true"]);
    vi.unstubAllGlobals();
  });
  it("keeps Obsidian closed when copying fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Denied")) },
    });
    using click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await expect(openProfileInObsidian("A paper")).rejects.toThrow("Denied");
    expect(click).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

it("hands Default off as one repeatable copy while preserving source and later edits", () => {
  const prepare = createProfileHandoffSource();
  const source = DEFAULT_PROFILE_SOURCE.replaceAll("\n", "\r\n");
  const first = prepare(source);
  const parsed = new WorkbenchDocumentController(first);
  const id = parsed.document!.manifest.id;
  expect(id).not.toBe("default");
  expect(id).toHaveLength(12);
  expect(first).toBe(source.replace("id: default", `id: ${id}`));
  const edited = source.replace("version: 1.0.0", "version: 1.0.1");
  expect(prepare(edited)).toBe(edited.replace("id: default", `id: ${id}`));
  expect(prepare(first)).toBe(first);
  expect(source).toContain("id: default");
});
