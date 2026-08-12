// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CitedBySnapshot } from "@/services/citation-index/service";

import { CitedByView } from "./view";

vi.mock("zustand", async () => {
  const { useSyncExternalStore } = await import("preact/compat");
  return {
    useStore: <T, U>(
      store: {
        subscribe: (listener: () => void) => () => void;
        getState: () => T;
      },
      selector: (state: T) => U,
    ) =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState())),
  };
});

class TestCitedByView extends CitedByView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

let view: TestCitedByView | undefined;

afterEach(async () => {
  await act(() => view?.close());
  view = undefined;
  document.body.replaceChildren();
});

describe("CitedByView", () => {
  it("follows an active Literature Note through rename and deletion", async () => {
    const file = new TFile();
    file.path = "Literature/Old.md";
    file.name = "Old.md";
    file.basename = "Old";
    file.extension = "md";
    file.stat = { ctime: 0, mtime: 1, size: 0 };
    let activeFile: TFile | null = file;
    let onActiveLeafChange: (() => void) | undefined;
    let onMetadataChange: ((file: TFile) => void) | undefined;
    let onRename: ((file: TFile, oldPath: string) => void) | undefined;
    let onDelete: ((file: TFile) => void) | undefined;
    const second = makeFile("Literature/Second.md");
    const duplicate = makeFile("Literature/Duplicate.md");
    const ordinary = makeFile("Notes/Ordinary.md");
    const caches = new Map<TFile, CachedMetadata>([
      [file, { frontmatter: { "zotero-key": "ABCD2345" } } as CachedMetadata],
      [
        second,
        { frontmatter: { "zotero-key": "ZZZ99999g7" } } as CachedMetadata,
      ],
      [
        duplicate,
        { frontmatter: { "zotero-key": "ABCD2345" } } as CachedMetadata,
      ],
      [ordinary, {} as CachedMetadata],
    ]);
    const app = {
      workspace: {
        getActiveFile: () => activeFile,
        on: (event: string, callback: () => void) => {
          if (event === "active-leaf-change") onActiveLeafChange = callback;
          return {} as EventRef;
        },
      },
      metadataCache: {
        getFileCache: (target: TFile) => caches.get(target) ?? null,
        on: (event: string, callback: (file: TFile) => void) => {
          if (event === "changed") onMetadataChange = callback;
          return {} as EventRef;
        },
      },
      vault: {
        getAbstractFileByPath: (path: string) =>
          path === file.path ? file : null,
        cachedRead: () => Promise.resolve(""),
        on: (event: string, callback: (...args: [TFile, string?]) => void) => {
          if (event === "rename") {
            onRename = (renamed, oldPath) => callback(renamed, oldPath);
          }
          if (event === "delete") onDelete = (deleted) => callback(deleted);
          return {} as EventRef;
        },
      },
    } as unknown as App;
    let publish: ((snapshot: CitedBySnapshot) => void) | undefined;
    const dispose = vi.fn();
    const observeCitedBy = vi.fn(
      (_indexedKey: string, callback: (snapshot: CitedBySnapshot) => void) => {
        publish = callback;
        return dispose;
      },
    );
    view = new TestCitedByView({} as WorkspaceLeaf, {
      app,
      citationIndex: { observeCitedBy },
    });
    expect(view.getIcon()).toBe("file-input");
    expect(view.contentEl.classList).toContain("zt-cited-by-view");
    document.body.append(view.contentEl);
    await act(() => view!.open());

    expect(observeCitedBy).toHaveBeenLastCalledWith(
      "ABCD2345",
      expect.any(Function),
    );

    activeFile = duplicate;
    await act(() => onActiveLeafChange?.());
    expect(observeCitedBy).toHaveBeenLastCalledWith(
      "ABCD2345",
      expect.any(Function),
    );

    activeFile = second;
    await act(() => onActiveLeafChange?.());
    expect(observeCitedBy).toHaveBeenLastCalledWith(
      "ZZZ99999g7",
      expect.any(Function),
    );

    activeFile = ordinary;
    await act(() => onActiveLeafChange?.());
    expect(view.contentEl.textContent).toBe(
      "Open a literature note to see citations.",
    );

    activeFile = null;
    await act(() => onActiveLeafChange?.());
    expect(view.contentEl.textContent).toBe(
      "Open a literature note to see citations.",
    );

    activeFile = file;
    await act(() => onActiveLeafChange?.());

    caches.set(file, {
      frontmatter: { "zotero-key": "ZZZ99999g7" },
    } as CachedMetadata);
    await act(() => onMetadataChange?.(file));
    expect(observeCitedBy).toHaveBeenLastCalledWith(
      "ZZZ99999g7",
      expect.any(Function),
    );

    caches.set(file, {
      frontmatter: { "zotero-key": "ABCD2345" },
    } as CachedMetadata);
    await act(() => onMetadataChange?.(file));
    expect(observeCitedBy).toHaveBeenLastCalledWith(
      "ABCD2345",
      expect.any(Function),
    );

    const oldPath = file.path;
    file.path = "Literature/New.md";
    file.name = "New.md";
    file.basename = "New";
    await act(() => onRename?.(file, oldPath));
    await act(() =>
      publish?.({
        groups: [{ path: file.path, occurrences: [] }],
        coverage: "complete",
        resolution: "ready",
      }),
    );

    expect(activeFile).toBe(file);
    expect(observeCitedBy).toHaveBeenCalledTimes(7);
    expect(dispose).toHaveBeenCalledTimes(6);
    expect(view.contentEl.textContent).toContain("This note");

    await act(() => onDelete?.(file));

    expect(view.contentEl.textContent).toBe(
      "Open a literature note to see citations.",
    );
  });

  it("drops manual excerpt expansions when the active note changes", async () => {
    const note = makeFile("Literature/Item.md");
    const plain = makeFile("Notes/Plain.md");
    const citing = makeFile("Notes/draft.md");
    const source = "Alpha cites @doe2024 here.\nBeta cites @doe2024 there.\n";
    let activeFile: TFile = note;
    let onActiveLeafChange: (() => void) | undefined;
    const caches = new Map<TFile, CachedMetadata>([
      [note, { frontmatter: { "zotero-key": "ABCD2345" } } as CachedMetadata],
      [plain, {} as CachedMetadata],
      [citing, {} as CachedMetadata],
    ]);
    const app = {
      workspace: {
        getActiveFile: () => activeFile,
        on: (event: string, callback: () => void) => {
          if (event === "active-leaf-change") onActiveLeafChange = callback;
          return {} as EventRef;
        },
      },
      metadataCache: {
        getFileCache: (target: TFile) => caches.get(target) ?? null,
        on: () => ({}) as EventRef,
      },
      vault: {
        getAbstractFileByPath: (path: string) =>
          path === citing.path ? citing : null,
        cachedRead: () => Promise.resolve(source),
        on: () => ({}) as EventRef,
      },
    } as unknown as App;
    let publish: ((snapshot: CitedBySnapshot) => void) | undefined;
    const observeCitedBy = vi.fn(
      (_indexedKey: string, callback: (snapshot: CitedBySnapshot) => void) => {
        publish = callback;
        return () => {};
      },
    );
    view = new TestCitedByView({} as WorkspaceLeaf, {
      app,
      citationIndex: { observeCitedBy },
    });
    document.body.append(view.contentEl);
    await act(() => view!.open());

    const cited: CitedBySnapshot = {
      groups: [
        {
          path: citing.path,
          occurrences: [
            {
              kind: "citekey",
              raw: "doe2024",
              position: {
                start: { line: 0, col: 12, offset: 12 },
                end: { line: 0, col: 20, offset: 20 },
              },
            },
          ],
        },
      ],
      coverage: "complete",
      resolution: "ready",
    };
    const settle = async () => {
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    };
    await act(() => publish?.(cited));
    await act(settle);
    const card = () => view!.contentEl.querySelector("[data-occurrence]");
    expect(card()?.textContent).toBe("Alpha cites @doe2024 here.…");

    await act(() =>
      (
        view!.contentEl.querySelector(
          '[data-cited-by-expand="after"]',
        ) as HTMLElement
      ).click(),
    );
    expect(card()?.textContent).toBe(source.trimEnd());

    activeFile = plain;
    await act(() => onActiveLeafChange?.());
    activeFile = note;
    await act(() => onActiveLeafChange?.());
    await act(() => publish?.(cited));
    await act(settle);

    expect(card()?.textContent).toBe("Alpha cites @doe2024 here.…");
  });
});

function makeFile(path: string): TFile {
  const file = new TFile();
  const name = path.slice(path.lastIndexOf("/") + 1);
  file.path = path;
  file.name = name;
  file.basename = name.slice(0, -3);
  file.extension = "md";
  file.stat = { ctime: 0, mtime: 1, size: 0 };
  return file;
}
