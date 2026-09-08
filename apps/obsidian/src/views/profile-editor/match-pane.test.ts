import { act } from "preact/test-utils";
// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { MatchItemFacts } from "@zotlit/workbench/match";
import {
  createWorkbenchStore,
  DataExplorer,
  MatchPane,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
} from "@zotlit/workbench/ui";

import { initI18n } from "@/lib/i18n";
import type { DatabaseService } from "@/services/database/service";

import { createProfileEditorHost } from "./host";
import { loadMatchFacts } from "./match-data";
import { NativeMatchPane } from "./match-pane";
vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("./match-data", () => ({ loadMatchFacts: vi.fn() }));
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("refreshes Match and vocabulary in On demand mode and ignores the old paper response", async () => {
  using stack = new DisposableStack();
  const controller = new WorkbenchDocumentController(
    `---\nid: Bk3Qn7XvT2Lp\nname: Books\nversion: 1.0.0\ncontract: 2\nmatch: 'itemType == "book"'\nfilename: '{{ zt.title }}'\n---\n{% managed %}Body{% endmanaged %}\n--- zotlit:annotation ---\nAnnotation`,
  );
  const store = createWorkbenchStore({
    item: { id: "BOOK0001", title: "Book" },
    preview: { mode: "create", live: false },
  });
  const first = Promise.withResolvers<MatchItemFacts | null>();
  const second = Promise.withResolvers<MatchItemFacts | null>();
  vi.mocked(loadMatchFacts)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const unsubscribe = vi.fn();
  let changed = () => {};
  const db = {
    on: (event: string, listener: () => void) => {
      if (event === "changed") changed = listener;
      return unsubscribe;
    },
  } as unknown as Pick<DatabaseService, "on" | "acquireRead">;
  const tags = vi.fn(async () => []);
  const render = vi.fn(() => ({ terminate() {} }));
  using host = createProfileEditorHost(
    {} as Parameters<typeof createProfileEditorHost>[0],
    {
      render,
      matchData: {
        tags,
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => null,
    },
  );
  const el = document.body.createDiv();
  const root = createRoot(el);
  stack.defer(() => {
    void act(() => root.unmount());
  });
  await act(async () => {
    root.render(
      createElement(
        WorkbenchHostProvider,
        { host },
        createElement(
          WorkbenchEditorProvider,
          { store, controller },
          createElement(NativeMatchPane, { controller, db }),
        ),
      ),
    );
  });
  await vi.waitFor(() =>
    expect(loadMatchFacts).toHaveBeenCalledWith(db, "BOOK0001"),
  );
  await act(async () => {
    store.getState().setItem({ id: "ARTC0001", title: "Article" });
  });
  await vi.waitFor(() =>
    expect(loadMatchFacts).toHaveBeenCalledWith(db, "ARTC0001"),
  );
  await act(async () => {
    second.resolve({
      library: { type: "personal" },
      itemType: "journalArticle",
      tags: [],
      collections: [],
    });
  });
  await vi.waitFor(() =>
    expect(el.querySelector('[role="status"]')?.textContent).toBe(
      "Matches the selected paper: no",
    ),
  );
  await act(async () => {
    first.resolve({
      library: { type: "personal" },
      itemType: "book",
      tags: [],
      collections: [],
    });
  });
  expect(el.querySelector('[role="status"]')?.textContent).toBe(
    "Matches the selected paper: no",
  );
  await act(async () => {
    store.getState().setItem(null);
  });
  await act(async () => {
    changed();
  });
  await vi.waitFor(() => expect(tags).toHaveBeenCalledTimes(2));
  expect(loadMatchFacts).toHaveBeenCalledTimes(2);
  expect(render).not.toHaveBeenCalled();
});

it("renders shared Match and Explorer controls in Chinese through the native host", async () => {
  const ports = {
    getLanguage: () => "zh",
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    requestUrl: async () => ({ status: 404, text: "" }),
  };
  initI18n({ pluginVersion: "2.0.0", ports });
  using stack = new DisposableStack();
  stack.defer(() =>
    initI18n({
      pluginVersion: "2.0.0",
      ports: { ...ports, getLanguage: () => "en" },
    }),
  );
  const controller = new WorkbenchDocumentController(
    `---\nid: Bk3Qn7XvT2Lp\nname: Books\nversion: 1.0.0\ncontract: 2\nfilename: '{{ zt.title }}'\n---\nBody\n--- zotlit:annotation ---\nAnnotation`,
  );
  const store = createWorkbenchStore();
  using host = createProfileEditorHost(
    ports as unknown as Parameters<typeof createProfileEditorHost>[0],
    {
      render: () => ({ terminate() {} }),
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => null,
    },
  );
  const el = document.body.createDiv();
  const root = createRoot(el);
  stack.defer(() => {
    void act(() => root.unmount());
  });
  await act(async () => {
    root.render(
      createElement(
        WorkbenchHostProvider,
        { host },
        createElement(
          WorkbenchEditorProvider,
          { store, controller },
          createElement(MatchPane, { controller, facts: null }),
          createElement(DataExplorer, {
            root: "note",
            data: { title: "A paper" },
            copy: async () => {},
          }),
        ),
      ),
    );
  });
  expect(el.textContent).toContain("满足以下全部条件");
  expect(el.querySelector('[aria-label="字段视图"]')?.textContent).toBe(
    "简洁所有字段",
  );
});
