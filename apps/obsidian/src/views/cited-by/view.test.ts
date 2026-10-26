// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import { TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { yieldToMain } from "@/lib/yield-to-main";
import { activeCitedByAtom } from "@/services/citation-index/atoms";
import { ParsedNote } from "@/services/citation-index/parsed-note";
import { scanNote } from "@/services/citation-index/scan-note";
import type {
  CitedByGroup,
  CitedBySnapshot,
} from "@/services/citation-index/service";
import { activeNoteAtom } from "@/services/note-index/atoms";

import { makeCitedByHost } from "./__fixtures__";
import type { CitedByHost } from "./__fixtures__";
import { SEARCH_DEBOUNCE } from "./CitedBy";
import { CitedByView } from "./view";

class TestCitedByView extends CitedByView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

function leafFor(app: App): WorkspaceLeaf {
  return stubService<WorkspaceLeaf & { app: App }>("WorkspaceLeaf", {
    app,
    updateHeader: () => {},
  });
}

let view: TestCitedByView | undefined;
let host: CitedByHost | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await act(() => view?.close());
  view = undefined;
  await host?.close();
  host = undefined;
  document.body.replaceChildren();
});

/** Retries `assertion` across host turns until it holds. */
async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 999) throw error;
      await yieldToMain();
    }
  }
}

describe("CitedByView", () => {
  it("follows an active Literature Note through rename and deletion", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    expect(view.getIcon()).toBe("file-input");
    expect(view.contentEl.classList).toContain("zt-cited-by-view");
    document.body.append(view.contentEl);
    await act(() => view!.open());
    const selfCited = (path: string): CitedBySnapshot => ({
      groups: [{ path, occurrences: [] }],
      coverage: "complete",
      resolution: "fresh",
    });
    await act(() => harness.publishSnapshot(selfCited(harness.note.path)));
    expect(view.contentEl.textContent).toContain("This note");

    await act(() => harness.rename(harness.note.path, "Literature/New.md"));
    await act(() => harness.publishSnapshot(selfCited("Literature/New.md")));
    expect(view.contentEl.textContent).toContain("This note");
    // A same-key path change keeps the observer.
    expect(harness.host.started).toEqual(["ABCD2345"]);

    await act(() => harness.remove("Literature/New.md"));
    expect(
      view.contentEl.querySelector("[data-cited-by-empty]")?.textContent,
    ).toBe("Open a literature note to see citations.");
    await act(() =>
      waitFor(() => expect(harness.host.stopped).toEqual(["ABCD2345"])),
    );
  });

  it("carries its controls into the workspace layout", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
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
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    await view.setState(
      {
        searchVisible: true,
        search: "cites",
        moreContext: true,
        sort: "alphabeticalReverse",
        // A collapse the view never writes stays out of the restored view.
        collapsed: [CITING_PATHS[0]],
      },
      { history: false },
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
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    await view.setState({ search: 7, sort: "byWordCount" }, { history: false });
    await view.setState(null, { history: false });

    expect(view.getState()).toEqual({
      searchVisible: false,
      search: "",
      moreContext: false,
      sort: "alphabetical",
    });
  });

  it("keeps its controls but not its collapse or expansions across a note switch", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    await view.setState(
      {
        searchVisible: true,
        search: "cites",
        moreContext: true,
        sort: "alphabeticalReverse",
      },
      { history: false },
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
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
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
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    const button = view.contentEl.querySelector("[data-cited-by-show-search]");
    await act(() =>
      harness.publishSnapshot({
        groups: [],
        coverage: "indexing",
        resolution: null,
      }),
    );
    expect(view.contentEl.querySelector("[data-cited-by-show-search]")).toBe(
      button,
    );
    expect(view.contentEl.textContent).toContain("Indexing citations…");
    expect(view.contentEl.textContent).toContain("Resolving citations…");
  });

  it("keeps collapse and excerpt expansions across a same-note leaf change", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
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

    expect(harness.host.started).toHaveLength(1);
    expect(view.contentEl.querySelectorAll("[data-occurrence]")).toHaveLength(
      1,
    );
    expect(excerpt()).toBe(expanded);
  });

  it("keeps its subscription across a switch to a duplicate Literature Note", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
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

    expect(harness.host.started).toHaveLength(1);
    expect(harness.host.stopped).toEqual([]);
    expect(excerpt()).toBe(expanded);
    expect(sourceLabels(view.contentEl)).toContain(m.cited_by_this_note());
  });

  it("resubscribes on a close then re-open with no reader left between", async () => {
    const harness = await makeHarness();
    view = new TestCitedByView(leafFor(harness.deps.app), harness.deps);
    document.body.append(view.contentEl);
    await act(() => view!.open());
    await act(() => harness.publish());
    await act(settle);

    expect(harness.host.started).toHaveLength(1);

    // An unread observer stops on a later task (the plugin's registry waits a
    // moment longer), so a reopen before then shares it.
    await act(() => view!.close());
    await act(() =>
      waitFor(() => expect(harness.host.stopped).toHaveLength(1)),
    );
    await act(() => view!.open());

    await act(() =>
      waitFor(() => expect(harness.host.started).toHaveLength(2)),
    );

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
async function makeHarness() {
  const current = (host = await makeCitedByHost());
  const { registry } = current;
  const note = { path: "Literature/Item.md", key: "ABCD2345" };
  const plain = { path: "Notes/Plain.md", key: null };
  // A duplicate Literature Note of the same Item, at a path one citing group
  // already uses, so activating it exercises both the same-key/different-path
  // seam and the "This note" label switch.
  const duplicate = { path: CITING_PATHS[0], key: "ABCD2345" };
  const files = new Map<string, TFile>(
    CITING_PATHS.map((path) => [path, makeFile(path)]),
  );
  const requestSaveLayout = Object.assign(
    vi.fn(() => requestSaveLayout),
    {
      cancel: () => requestSaveLayout,
      run: () => Promise.resolve(),
    },
  );
  const workspace = stubService<App["workspace"]>("Workspace", {
    requestSaveLayout,
  });
  const metadataCache = stubService<App["metadataCache"]>("MetadataCache", {
    getFileCache: () => ({}),
    on: () => ({}),
  });
  const vault = stubService<App["vault"]>("Vault", {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    cachedRead: () => Promise.resolve(CITING_BODY),
    on: () => ({}),
  });
  const app = stubService<App>("App", { workspace, metadataCache, vault });
  let followed: { path: string; key: string | null } = note;
  current.follow(note.path, note.key);
  /** Sends `snapshot` once the followed key's observer runs, and waits for it. */
  const publishSnapshot = async (snapshot: CitedBySnapshot) => {
    const key = followed.key;
    if (key === null) throw new Error("the followed note has no key");
    await waitFor(() => expect(current.publish(key, snapshot)).toBe(true));
    await waitFor(() => expect(registry.get(activeCitedByAtom)).toBe(snapshot));
  };

  return {
    host: current,
    deps: {
      app,
      registry,
      citationIndex: {
        getParsedNote: async () =>
          new ParsedNote(CITING_BODY, scanNote(CITING_BODY)),
      },
    },
    note,
    plain,
    duplicate,
    requestSaveLayout,
    publish: () =>
      publishSnapshot({
        groups: CITING_PATHS.map((path) => citingGroup(path)),
        coverage: "complete",
        resolution: "fresh",
      }),
    publishSnapshot,
    /** Opens `target` and waits until the registry follows it. */
    activate: async (target: { path: string; key: string | null }) => {
      followed = target;
      current.follow(target.path, target.key);
      await waitFor(() => expect(registry.get(activeNoteAtom)).toEqual(target));
    },
    rename: async (path: string, next: string) => {
      current.rename(path, next);
      followed = { ...followed, path: next };
      await waitFor(() => expect(registry.get(activeNoteAtom).path).toBe(next));
    },
    remove: async (path: string) => {
      current.remove(path);
      followed = { path, key: null };
      await waitFor(() => expect(registry.get(activeNoteAtom).key).toBeNull());
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
