// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type {
  CitedByGroup,
  CitedBySnapshot,
} from "@/services/citation-index/service";

import { SEARCH_DEBOUNCE } from "./CitedBy";
import { CitedByView } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

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
  vi.useRealTimers();
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
    expect(
      view.contentEl.querySelector("[data-cited-by-empty]")?.textContent,
    ).toBe("Open a literature note to see citations.");

    activeFile = null;
    await act(() => onActiveLeafChange?.());
    expect(
      view.contentEl.querySelector("[data-cited-by-empty]")?.textContent,
    ).toBe("Open a literature note to see citations.");

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
    // A same-key path change carries only activePath; the subscription
    // stays, so only the four key changes above resubscribe.
    expect(observeCitedBy).toHaveBeenCalledTimes(5);
    expect(dispose).toHaveBeenCalledTimes(4);
    expect(view.contentEl.textContent).toContain("This note");

    await act(() => onDelete?.(file));

    expect(
      view.contentEl.querySelector("[data-cited-by-empty]")?.textContent,
    ).toBe("Open a literature note to see citations.");
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
    expect(card()?.textContent).toBe("Alpha cites @doe2024 here.");

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

    expect(card()?.textContent).toBe("Alpha cites @doe2024 here.");
  });

  it("carries its controls into the workspace layout", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    expect(view.getState()).toEqual({
      searchVisible: false,
      search: "",
      moreContext: false,
      sort: "alphabetical",
    });

    await act(() => click(view!.contentEl, "[data-cited-by-show-search]"));
    await typeSearch(view.contentEl, "cites");
    await act(() =>
      click(view!.contentEl, "[data-cited-by-show-more-context]"),
    );
    await chooseSort(view.contentEl, "Modified time (new to old)");
    // The expansion and the collapse below stay in this session.
    await act(() => click(view!.contentEl, '[data-cited-by-expand="after"]'));
    await act(() => click(view!.contentEl, "[data-cited-by-source-toggle]"));

    expect(view.getState()).toEqual({
      searchVisible: true,
      search: "cites",
      moreContext: true,
      sort: "byModifiedTime",
    });
    expect(harness.requestSaveLayout).toHaveBeenCalled();
  });

  it("restores the controls the workspace layout holds", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    await view.setState(
      {
        searchVisible: true,
        search: "cites",
        moreContext: true,
        sort: "alphabeticalReverse",
        // A collapse the view never writes stays out of the restored view.
        collapsed: [CITING_PATHS[0]],
      },
      {} as ViewStateResult,
    );
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    expect(
      (
        view.contentEl.querySelector(
          "[data-cited-by-search] input",
        ) as HTMLInputElement
      ).value,
    ).toBe("cites");
    expect(
      view.contentEl.querySelector("[data-cited-by-show-more-context]")
        ?.classList,
    ).toContain("is-active");
    expect(sourceLabels(view.contentEl)).toEqual(["beta", "alpha"]);
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      2,
    );

    await typeSearch(view.contentEl, "beta");
    expect(sourceLabels(view.contentEl)).toEqual(["beta"]);
  });

  it("ignores layout state it does not recognize", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    await view.setState(
      { search: 7, sort: "byWordCount" },
      {} as ViewStateResult,
    );
    await view.setState(null, {} as ViewStateResult);

    expect(view.getState()).toEqual({
      searchVisible: false,
      search: "",
      moreContext: false,
      sort: "alphabetical",
    });
  });

  it("keeps its controls but not its collapse or expansions across a note switch", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    await view.setState(
      {
        searchVisible: true,
        search: "cites",
        moreContext: true,
        sort: "alphabeticalReverse",
      },
      {} as ViewStateResult,
    );
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const excerpt = () =>
      view!.contentEl.querySelector("[data-occurrence]")?.textContent;
    const truncated = excerpt();
    await act(() => click(view!.contentEl, '[data-cited-by-expand="after"]'));
    const expanded = excerpt();
    expect(expanded).not.toBe(truncated);

    await act(() => click(view!.contentEl, "[data-cited-by-source-toggle]"));
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      1,
    );

    await act(() => harness.activate(harness.plain));
    await act(() => harness.activate(harness.note));
    await act(() => harness.publish());
    await act(settle);

    expect(view.getState()).toEqual({
      searchVisible: true,
      search: "cites",
      moreContext: true,
      sort: "alphabeticalReverse",
    });
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      2,
    );
    expect(excerpt()).toBe(truncated);
  });

  it("keeps the toolbar node through a same-note leaf change that starts mid-press", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const button = view.contentEl.querySelector(
      "[data-cited-by-show-search]",
    ) as HTMLElement;
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await act(() => harness.activate(harness.note));
    await act(() => harness.publish());
    await act(settle);
    expect(view.contentEl.contains(button)).toBe(true);
    await act(() => button.click());
    expect(view.getState()).toMatchObject({ searchVisible: true });
  });

  it("keeps the toolbar node through a transient empty snapshot", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const button = view.contentEl.querySelector("[data-cited-by-show-search]");
    await act(() =>
      harness.publishSnapshot({
        groups: [],
        coverage: "indexing",
        resolution: "resolving",
      }),
    );
    expect(view.contentEl.querySelector("[data-cited-by-show-search]")).toBe(
      button,
    );
    expect(view.contentEl.textContent).toContain("Indexing citations…");
    expect(view.contentEl.textContent).toContain("Resolving citations…");
  });

  it("keeps collapse and excerpt expansions across a same-note leaf change", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const excerpt = () =>
      view!.contentEl.querySelector("[data-occurrence]")?.textContent;
    const truncated = excerpt();
    // Expand the first source's excerpt, then collapse the SECOND source
    // (not the one holding the expanded excerpt), so the surviving
    // `[data-occurrence]` after the collapse is still the expanded one.
    await act(() => click(view!.contentEl, '[data-cited-by-expand="after"]'));
    const expanded = excerpt();
    expect(expanded).not.toBe(truncated);
    const toggles = view.contentEl.querySelectorAll(
      "[data-cited-by-source-toggle]",
    );
    await act(() => (toggles[1] as HTMLElement).click());
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      1,
    );

    await act(() => harness.activate(harness.note));

    expect(harness.deps.citationIndex.observeCitedBy).toHaveBeenCalledTimes(1);
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      1,
    );
    expect(excerpt()).toBe(expanded);
  });

  it("keeps its subscription across a switch to a duplicate Literature Note", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const excerpt = () =>
      view!.contentEl.querySelector("[data-occurrence]")?.textContent;
    const truncated = excerpt();
    await act(() => click(view!.contentEl, '[data-cited-by-expand="after"]'));
    const expanded = excerpt();
    expect(expanded).not.toBe(truncated);

    await act(() => harness.activate(harness.duplicate));

    expect(harness.deps.citationIndex.observeCitedBy).toHaveBeenCalledTimes(1);
    expect(harness.dispose).not.toHaveBeenCalled();
    expect(excerpt()).toBe(expanded);
    expect(sourceLabels(view.contentEl)).toContain(m.cited_by_this_note());
  });

  it("resubscribes on a close then re-open", async () => {
    const harness = makeHarness();
    view = new TestCitedByView({} as WorkspaceLeaf, harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    expect(harness.deps.citationIndex.observeCitedBy).toHaveBeenCalledTimes(1);

    await act(() => view!.close());
    await act(() => view!.open());

    expect(harness.deps.citationIndex.observeCitedBy).toHaveBeenCalledTimes(2);

    await act(() => harness.publish());
    await act(settle);
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      2,
    );
  });
});

const CITING_BODY = "Alpha cites @doe2024 here.\nMore text follows.\n";
const CITING_PATHS = ["Notes/alpha.md", "Notes/beta.md"] as const;

/** A Cited By Sidebar over two citing notes that share one source body. */
function makeHarness() {
  const note = makeFile("Literature/Item.md");
  const plain = makeFile("Notes/Plain.md");
  const citing = CITING_PATHS.map((path) => makeFile(path));
  // A duplicate Literature Note of the same Item, at a path one citing group
  // already uses, so activating it exercises both the same-key/different-path
  // seam and the "This note" label switch.
  const duplicate = makeFile(CITING_PATHS[0]);
  const caches = new Map<TFile, CachedMetadata>([
    [note, { frontmatter: { "zotero-key": "ABCD2345" } } as CachedMetadata],
    [plain, {} as CachedMetadata],
    [
      duplicate,
      { frontmatter: { "zotero-key": "ABCD2345" } } as CachedMetadata,
    ],
    ...citing.map((file) => [file, {} as CachedMetadata] as const),
  ]);
  const files = new Map(citing.map((file) => [file.path, file]));
  let activeFile: TFile | null = note;
  let onActiveLeafChange: (() => void) | undefined;
  const requestSaveLayout = vi.fn();
  const app = {
    workspace: {
      getActiveFile: () => activeFile,
      requestSaveLayout,
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
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: () => Promise.resolve(CITING_BODY),
      on: () => ({}) as EventRef,
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

  return {
    deps: { app, citationIndex: { observeCitedBy } },
    note,
    plain,
    duplicate,
    dispose,
    requestSaveLayout,
    publish: () =>
      publish?.({
        groups: citing.map(({ path }) => citingGroup(path)),
        coverage: "complete",
        resolution: "ready",
      }),
    publishSnapshot: (snapshot: CitedBySnapshot) => publish?.(snapshot),
    activate: (file: TFile) => {
      activeFile = file;
      onActiveLeafChange?.();
    },
  };
}

/** Type one query into the open search field and let its debounce elapse. */
async function typeSearch(root: HTMLElement, query: string): Promise<void> {
  const input = root.querySelector(
    "[data-cited-by-search] input",
  ) as HTMLInputElement | null;
  if (!input) throw new Error("the search field is out of view");
  vi.useFakeTimers();
  await act(() => {
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE);
  });
  vi.useRealTimers();
}

function citingGroup(path: string): CitedByGroup {
  const offset = CITING_BODY.indexOf("@doe2024");
  return {
    path,
    occurrences: [
      {
        kind: "citekey",
        raw: "doe2024",
        position: {
          start: { line: 0, col: offset, offset },
          end: { line: 0, col: offset + 8, offset: offset + 8 },
        },
      },
    ],
  };
}

/** Settles the preview reads one published snapshot starts. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function click(root: HTMLElement, selector: string): void {
  const target = root.querySelector(selector);
  if (!target) throw new Error(`the view shows no ${selector}`);
  (target as HTMLElement).click();
}

/** Open the sort menu and pick the mode of one title. */
async function chooseSort(root: HTMLElement, title: string): Promise<void> {
  Menu.instances.length = 0;
  await act(() => click(root, "[data-cited-by-sort]"));
  const item = Menu.instances
    .at(-1)
    ?.items.find((entry) => entry.title === title);
  if (!item) throw new Error(`the sort menu offers no "${title}"`);
  await act(() => item.click());
}

/** The source-group labels, in the order the sidebar shows them. */
function sourceLabels(root: HTMLElement): (string | null)[] {
  return [...root.querySelectorAll("[data-cited-by-source-label]")].map(
    (label) => label.textContent,
  );
}

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
