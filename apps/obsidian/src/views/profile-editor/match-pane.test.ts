// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { MatchItemFacts } from "@zotlit/workbench/match";
import {
  createRenderScheduler,
  createWorkbenchStore,
  DataExplorer,
  MatchPane,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
} from "@zotlit/workbench/ui";

import { initI18n } from "@/lib/i18n";
import * as m from "@/lib/i18n/generated/messages";
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
  const render = vi.fn(() =>
    Promise.reject(new Error("This test renders nothing.")),
  );
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
  using scheduler = createRenderScheduler({
    render: (request) => host.render(request),
    failed: (result) => result,
    controller,
    store,
  });
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
          { store, controller, scheduler },
          createElement(NativeMatchPane, { controller, db }),
        ),
      ),
    );
  });
  await vi.waitFor(() =>
    expect(loadMatchFacts).toHaveBeenCalledWith(db, "BOOK0001"),
  );
  expect(el.querySelector('[role="status"]')?.textContent).toBe(
    m.workbench_loading_item(),
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
  expect(el.querySelector('[role="status"]')?.textContent).toBe(
    m.workbench_example_select_item(),
  );
  expect(render).not.toHaveBeenCalled();
  vi.mocked(loadMatchFacts).mockRejectedValueOnce(
    new Error("Database unavailable"),
  );
  await act(async () => {
    store.getState().setItem({ id: "FAIL0001", title: "Unavailable paper" });
  });
  await vi.waitFor(() =>
    expect(el.querySelector('[role="status"]')?.textContent).toBe(
      m.workbench_example_failed(),
    ),
  );
  vi.mocked(loadMatchFacts).mockResolvedValueOnce(null);
  const retry = [...el.querySelectorAll("button")].find(
    (button) => button.textContent === m.workbench_example_retry(),
  )!;
  await act(async () => retry.click());
  await vi.waitFor(() =>
    expect(el.querySelector('[role="status"]')?.textContent).toBe(
      m.workbench_example_missing_item(),
    ),
  );
});

it("applies the installed pack to shared Match and Explorer controls after restart", async () => {
  const storage = new Map<string, unknown>();
  const ports = {
    getLanguage: () => "zh",
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      storage.set(key, value);
    },
    requestUrl: async () => ({
      status: 200,
      text: JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        messages: {
          workbench_match_conditions_desc: "测试包：匹配条件",
          workbench_explorer_simple: "测试包：简洁",
          workbench_field_title: "测试包：标题",
        },
      }),
    }),
  };
  const lifecycle = initI18n({ pluginVersion: "2.0.0", ports });
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
      render: () => Promise.reject(new Error("This test renders nothing.")),
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => null,
    },
  );
  using scheduler = createRenderScheduler({
    render: (request) => host.render(request),
    failed: (result) => result,
    controller,
    store,
  });
  const el = document.body.createDiv();
  const root = createRoot(el);
  stack.defer(() => {
    void act(() => root.unmount());
  });
  const show = () =>
    act(async () => {
      root.render(
        createElement(
          WorkbenchHostProvider,
          { host },
          createElement(
            WorkbenchEditorProvider,
            { store, controller, scheduler },
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
  await show();
  const englishMatch = m.workbench_match_conditions_desc();
  const englishViews =
    m.workbench_explorer_simple() + m.workbench_explorer_all();
  const variant = () =>
    el.querySelector(`[aria-label="${m.workbench_explorer_variant()}"]`);
  expect(el.textContent).toContain(englishMatch);
  expect(variant()?.textContent).toBe(englishViews);
  expect(host.getLocale()).toBe("en");

  await lifecycle.install();
  await show();
  expect(el.textContent).toContain(englishMatch);
  expect(variant()?.textContent).toBe(englishViews);

  initI18n({ pluginVersion: "2.0.0", ports });
  await show();
  expect(host.getLocale()).toBe("zh-CN");
  expect(el.textContent).toContain("测试包：匹配条件");
  expect(el.textContent).toContain("测试包：标题");
  // The pack overrides Simple; All fields falls back to bundled English.
  expect(variant()?.textContent).toBe(
    `测试包：简洁${m.workbench_explorer_all()}`,
  );
});
