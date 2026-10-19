// @vitest-environment happy-dom
// The Query File tab writes a toolbar change to its file at once, through
// its own save, and the toolbar says when the write failed.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import type { QueryViewOutcome } from "@/services/item-query/query-view";

import { noLiteratureNotes } from "./__fixtures__/literature-notes";
import { QueryFileView } from "./file-view";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const FILE = `views:
  - type: annotations
    name: Mine
    from: annotations
`;

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: {} as never,
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};

let cleanup = new DisposableStack();
afterEach(() => {
  cleanup.dispose();
  cleanup = new DisposableStack();
  document.body.replaceChildren();
});

/**
 * A tab of the Query File. Its save acts as Obsidian's own: it writes the
 * view's text through `write`, which stands in for the vault, and a save
 * while one writes returns at once and writes again after it.
 */
async function openTab() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const off = () => () => {};
  const deps = {
    app: {
      ...host.app,
      scope: undefined,
      workspace: { ...host.workspace, requestSaveLayout: () => {} },
    },
    reads: { on: off },
    libraryScope: { on: off },
    query: { run: () => Promise.resolve(EMPTY), on: () => () => {} },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
    literatureNotes: noLiteratureNotes(),
  } as unknown as QueryViewDeps;
  const tab = new QueryFileView(
    { app: deps.app } as unknown as WorkspaceLeaf,
    deps,
  );
  const written: string[] = [];
  const write = vi.fn(async (text: string) => {
    written.push(text);
  });
  let saving = false;
  let again = false;
  tab.save = async () => {
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    again = false;
    try {
      await write(tab.getViewData());
    } finally {
      saving = false;
      if (again) void tab.save();
    }
  };
  const requestSave = vi.fn();
  tab.requestSave = requestSave;
  document.body.append(tab.contentEl);
  // What the tab's `onload` does, which the mock view cannot run.
  tab.query.load();
  await act(() => tab.query.render(tab.contentEl));
  cleanup.defer(() => tab.query.unload());
  await act(async () => {
    tab.setViewData(FILE);
    await tab.query.settled;
  });
  return { tab, write, written, requestSave };
}

/** Whether the toolbar says that the last change is not saved. */
const notSaved = (tab: QueryFileView) => tab.query.state.getState().saveFailed;

it("writes a toolbar change to the file at once", async () => {
  const { tab, written, requestSave } = await openTab();
  await act(async () => {
    tab.query.document.addView("Yellow");
    await tab.query.flush();
  });
  expect(written).toHaveLength(1);
  expect(written[0]).toContain("name: Yellow");
  expect(requestSave).not.toHaveBeenCalled();
});

it("says a change is not saved when the write fails, until a later write succeeds", async () => {
  const { tab, write } = await openTab();
  write.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    tab.query.document.addView("Yellow");
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(true);
  expect(tab.query.state.getState().view?.name).toBe("Yellow");

  await act(async () => {
    tab.query.document.addView("Blue");
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(false);
});

it("writes a second change that comes while the first is writing", async () => {
  const { tab, write, written } = await openTab();
  const first = Promise.withResolvers<void>();
  write.mockImplementationOnce(async (text) => {
    written.push(text);
    await first.promise;
  });
  await act(async () => {
    tab.query.document.addView("Yellow");
    tab.query.document.addView("Blue");
    first.resolve();
    await tab.query.flush();
  });
  expect(written.at(-1)).toContain("name: Blue");
});

it("says a change is not saved when the write of a change that came during another write fails", async () => {
  const { tab, write } = await openTab();
  const first = Promise.withResolvers<void>();
  write
    .mockImplementationOnce(() => first.promise)
    .mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    tab.query.document.addView("Yellow");
    tab.query.document.addView("Blue");
    first.resolve();
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(true);
});

it("keeps every toolbar control, which the Library View leaves out, and offers no Save as query file", async () => {
  const { tab } = await openTab();
  const el = tab.contentEl;
  const toolbar = [
    ...el.querySelectorAll(
      "[data-query-view-menu], [data-query-results], [data-query-toolbar], [data-query-properties], [data-query-save-as]",
    ),
  ].map(
    (node) =>
      node.getAttribute("data-query-toolbar") ??
      [...node.attributes]
        .map(({ name }) => name)
        .find((name) => name.startsWith("data-query-")),
  );
  expect(toolbar).toEqual([
    "data-query-view-menu",
    "data-query-results",
    "sort",
    "group",
    "filter",
    "data-query-properties",
    "search",
  ]);
});
