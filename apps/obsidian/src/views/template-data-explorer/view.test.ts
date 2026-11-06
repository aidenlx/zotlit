// @vitest-environment happy-dom
import type { ItemView as MockItemView } from "@mock/obsidian";
import { Deferred, Effect } from "effect";
import type { App, EventRef, Vault, Workspace, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { WorkbenchItemChoice } from "@zotlit/workbench/ui";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { TemplateDataLoadResult } from "@/services/template-workbench/data";
import {
  workbenchItemChoice,
  workbenchItemSearch,
} from "@/views/template-workbench/item-choice";

import { makeExplorerHost, waitFor } from "./__fixtures__";
import type { ExplorerHost, ExplorerReads } from "./__fixtures__";
import { TemplateDataExplorerView } from "./view";
import type { ExplorerViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("@/services/item-lookup/search-modal", () => ({
  pickItem: vi.fn(async () => null),
}));
vi.mock("@/views/template-workbench/item-choice", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/views/template-workbench/item-choice")
    >();
  return {
    ...actual,
    workbenchItemChoice: vi.fn(actual.workbenchItemChoice),
    workbenchItemSearch: vi.fn(actual.workbenchItemSearch),
  };
});
const read = vi.fn<NonNullable<ExplorerReads["read"]>>();
let explorerHost: ExplorerHost;
beforeEach(async () => {
  read.mockReset();
  explorerHost = await makeExplorerHost({ read });
});
afterEach(() => explorerHost.close());

class ExplorerView extends TemplateDataExplorerView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

interface HostEvent {
  name: string;
  callback: (...args: unknown[]) => void;
}

function host(events = new Map<EventRef, HostEvent>()) {
  const trigger = vi.fn((name: string, ...args: unknown[]) => {
    for (const event of events.values())
      if (event.name === name) event.callback(...args);
  });
  const on = vi.fn();
  const offref = vi.fn((ref: EventRef) => {
    events.delete(ref);
  });
  on.mockImplementation(
    (name: string, callback: (...args: unknown[]) => void): EventRef => {
      const ref: EventRef = {};
      events.set(ref, { name, callback });
      return ref;
    },
  );
  const requestSaveLayout: Workspace["requestSaveLayout"] = Object.assign(
    vi.fn(() => requestSaveLayout),
    {
      cancel: () => requestSaveLayout,
      run: () => undefined,
    },
  );
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", { on, offref }),
    workspace: stubService<Workspace>("Workspace", {
      on,
      offref,
      trigger,
      getActiveFile: () => null,
      requestSaveLayout,
    }),
    loadLocalStorage: () => null,
  });
  const leaf = (pinned = false) => {
    const value = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      pinned,
      updateHeader: vi.fn(),
    });
    Object.defineProperty(value, "app", { value: app });
    return value;
  };
  return { app, events, leaf, trigger };
}

function viewDeps(): ExplorerViewDeps {
  return stubService<ExplorerViewDeps>("ExplorerViewDeps", {
    registry: explorerHost.registry,
    itemLookup: stubService<ExplorerViewDeps["itemLookup"]>("ItemLookup", {
      search: async () => [],
      openSession: () => ({
        search: async () => [],
        close: () => {},
        [Symbol.dispose]() {},
      }),
    }),
    settings: stubService<ExplorerViewDeps["settings"]>("PluginSettings", {
      current: Effect.succeed(defaults),
    }),
    bridge: stubService<ExplorerViewDeps["bridge"]>("EffectBridge", {
      runSync: Effect.runSync,
    }),
    pluginVersion: "test",
  });
}

it("shows its own Item, offers no field insertion, and releases its workspace listeners", async () => {
  const { app, events, leaf } = host();
  read.mockResolvedValue({
    kind: "data",
    data: { title: "Native paper" },
  });
  const view = new ExplorerView(leaf(), viewDeps());
  Object.defineProperty(view, "app", { value: app });
  document.body.append(view.contentEl);
  try {
    await act(async () => view.open());
    await act(async () =>
      view.setState({ itemIndexedKey: "PAPER001" }, { history: false }),
    );
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain("Native paper"),
    );
    expect(read).toHaveBeenLastCalledWith("PAPER001", "note");
    expect(explorerHost.zoteroSubscribers()).toBe(1);
    // Its fields are copy-only: no editor receives them.
    expect(
      [...view.contentEl.querySelectorAll<HTMLElement>("[aria-label]")].some(
        (button) =>
          button.getAttribute("aria-label") ===
          m.workbench_fields_put_in_note(),
      ),
    ).toBe(false);
    // A Zotero change reads the shown Item again.
    const reads = read.mock.calls.length;
    await act(async () => explorerHost.changeZotero());
    await act(() =>
      waitFor(() => expect(read).toHaveBeenCalledTimes(reads + 1)),
    );
    expect(read).toHaveBeenLastCalledWith("PAPER001", "note");
  } finally {
    await act(async () => view.close());
    view.contentEl.remove();
  }
  expect(events.size).toBe(0);
  await waitFor(() => expect(explorerHost.zoteroSubscribers()).toBe(0));
});

it("restores independent Explorer navigation after delayed data and keeps search out of workspace saves", async () => {
  const { app, leaf } = host();
  let release!: (value: TemplateDataLoadResult) => void;
  const data = new Promise<TemplateDataLoadResult>((resolve) => {
    release = resolve;
  });
  read.mockReturnValue(data);
  const view = new ExplorerView(leaf(), viewDeps());
  Object.defineProperty(view, "app", { value: app });
  document.body.append(view.contentEl);
  const typing = document.createElement("input");
  document.body.append(typing);
  typing.focus();
  const descriptor = {
    itemIndexedKey: "PAPER001",
    anchorAnnotationKey: null,
    root: "note",
    collapsedSections: ["record"],
  };
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    view.contentEl.remove();
    typing.remove();
  });
  cleanup.defer(() => act(async () => view.close()));
  await act(async () => view.open());
  // A leaf saved as an editor's Fields pane names its file; it restores as
  // this standalone Explorer, with its Item.
  await act(async () =>
    view.setState(
      { ...descriptor, sourceFile: "profiles/paper.md" },
      { history: false },
    ),
  );
  const saved = view.getEphemeralState() as {
    zotlitDataExplorer: Record<string, unknown>;
  };
  saved.zotlitDataExplorer.navigation = {
    anchorKey: null,
    filterQuery: "answer",
    expanded: ["details"],
    noteRootExpanded: ["authors"],
    preFilterExpanded: ["details"],
    filterCollapsed: [],
  };
  saved.zotlitDataExplorer.presentation = {
    top: 34,
    left: 2,
    field: "details.answer",
  };
  await act(async () => view.setEphemeralState(saved));
  const saves = vi.mocked(app.workspace.requestSaveLayout);
  saves.mockClear();
  await act(async () =>
    release({
      kind: "data",
      data: { title: "A paper", details: { answer: 42 } },
    }),
  );
  const input =
    view.contentEl.querySelector<HTMLInputElement>("input[type=search]")!;
  expect(input.value).toBe("answer");
  expect(view.contentEl.textContent).toContain("42");
  const body = view.contentEl.querySelector<HTMLElement>('[data-part="body"]')!;
  expect(body.scrollTop).toBe(34);
  expect(body.scrollLeft).toBe(2);
  expect(document.activeElement).toBe(typing);
  expect(saves).not.toHaveBeenCalled();
  expect(view.getState()).toEqual(descriptor);
  await act(async () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(
    view.contentEl
      .querySelector('[data-workbench-field="details"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(view.contentEl.textContent).toContain("42");
  expect(saves).not.toHaveBeenCalled();
  const recreated = new ExplorerView(leaf(), viewDeps());
  Object.defineProperty(recreated, "app", { value: app });
  cleanup.defer(() => act(async () => recreated.close()));
  await act(async () => recreated.open());
  await act(async () =>
    recreated.setState(view.getState(), { history: false }),
  );
  expect(recreated.contentEl.textContent).toContain("A paper");
  expect(recreated.getState()).toEqual(descriptor);
  expect(
    recreated.contentEl.querySelector<HTMLInputElement>("input[type=search]")!
      .value,
  ).toBe("");
});

it("closes an open Item chooser when a newer choice starts", async () => {
  const { app, leaf } = host();
  const chooserOpened = Promise.withResolvers<void>();
  const answer = Deferred.makeUnsafe<WorkbenchItemChoice | null>();
  let chooserClosed = false;
  vi.mocked(workbenchItemChoice).mockReturnValueOnce(
    Effect.suspend(() => {
      chooserOpened.resolve();
      return Deferred.await(answer);
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          chooserClosed = true;
        }),
      ),
    ),
  );
  const searchDismissed = Promise.withResolvers<void>();
  vi.mocked(workbenchItemSearch).mockReturnValueOnce(
    Effect.sync(() => {
      searchDismissed.resolve();
      return null;
    }),
  );
  const view = new ExplorerView(leaf(), viewDeps());
  Object.defineProperty(view, "app", { value: app });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(async () => view.close()));
  await act(async () => view.open());
  await act(async () => view.setState({}, { history: false }));
  const choose = (view as unknown as MockItemView).actions.find(
    (button) => button.getAttribute("aria-label") === m.workbench_choose_item(),
  )!;
  await act(async () => choose.click());
  await chooserOpened.promise;
  const search = [...view.contentEl.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(m.workbench_search_zotero()),
  )!;
  await act(async () => search.click());
  await searchDismissed.promise;
  await vi.waitFor(() => expect(chooserClosed).toBe(true));
});
