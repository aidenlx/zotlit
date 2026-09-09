// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRenderScheduler } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { pickItem } from "@/services/item-lookup/search-modal";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import { ProfileEditorView } from "@/views/profile-editor/view";
import type { ProfileEditorDeps } from "@/views/profile-editor/view";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { subscribeActiveProfileEditor } from "./register";
import { renderNativeProfile } from "./render";
import { NotePreviewView } from "./view";

vi.mock("@zotlit/workbench/ui", async (original) => {
  const actual = await original<typeof import("@zotlit/workbench/ui")>();
  return {
    ...actual,
    createRenderScheduler: vi.fn(actual.createRenderScheduler),
  };
});
vi.mock("@/views/profile-editor/host", async (original) => {
  const actual = await original<typeof import("@/views/profile-editor/host")>();
  return {
    ...actual,
    createProfileEditorHost: vi.fn(actual.createProfileEditorHost),
  };
});
vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("./register", () => ({
  subscribeActiveProfileEditor: vi.fn(),
  openProfileWorkbench: vi.fn(),
}));
vi.mock("@/services/item-lookup/search-modal", () => ({
  pickItem: vi.fn(async () => null),
}));
vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  MarkdownRenderer: {
    render: async (_app: App, markdown: string, target: HTMLElement) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = markdown;
      target.append(paragraph);
    },
  },
}));
vi.mock("./render", async (original) => {
  const actual = await original<typeof import("./render")>();
  return { ...actual, renderNativeProfile: vi.fn(actual.renderNativeProfile) };
});

class Preview extends NotePreviewView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}
class Editor extends ProfileEditorView {
  close() {
    return this.onClose();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function setup() {
  const fixture = await createRenderFixture();
  const { app } = fixture.deps;
  const events = new Map<
    EventRef,
    { name: string; callback: (...args: unknown[]) => void }
  >();
  const workspace = {
    on(name: string, callback: (...args: unknown[]) => void) {
      const ref = {} as EventRef;
      events.set(ref, { name, callback });
      return ref;
    },
    offref(ref: EventRef) {
      events.delete(ref);
    },
    trigger(name: string, ...args: unknown[]) {
      for (const event of events.values())
        if (event.name === name) event.callback(...args);
    },
    requestSaveLayout: vi.fn(),
    setActiveLeaf: vi.fn(),
  };
  Object.assign(app.workspace, workspace);
  using lease = await fixture.deps.db.acquireRead();
  const editorLeaf = { app } as unknown as WorkspaceLeaf;
  const editor = new Editor(editorLeaf, {
    app,
    settings: fixture.deps.settings,
    db: {
      ...fixture.deps.db,
      ready: Promise.resolve(),
      state: "ready",
      client: lease.client,
    },
    zoteroPref: { ready: Promise.resolve(), dataDir: null },
    nativePreview: fixture.deps,
  } as unknown as ProfileEditorDeps);
  const file = new TFile();
  file.path = "templates/paper.md";
  editor.file = file;
  editor.setViewData(PROFILE_SOURCE, true);
  // The editor's compact examples have their own refresh choice.
  editor.store.getState().setPreview({ live: false });
  const subscriptions = new Set<(view: ProfileEditorView | null) => void>();
  vi.mocked(subscribeActiveProfileEditor).mockImplementation(
    (_app, listener) => {
      subscriptions.add(listener);
      try {
        listener(editor);
      } catch (error) {
        subscriptions.delete(listener);
        throw error;
      }
      return () => {
        subscriptions.delete(listener);
      };
    },
  );
  const previews: Preview[] = [];
  async function open() {
    const preview = new Preview({ app } as unknown as WorkspaceLeaf, "zotlit");
    // The lightweight ItemView mock leaves this native base property to its test.
    Object.defineProperty(preview, "app", { value: app });
    previews.push(preview);
    document.body.append(preview.contentEl);
    await act(async () => preview.open());
    return preview;
  }
  return {
    fixture,
    editor,
    events,
    subscriptions,
    previews,
    open,
    async [Symbol.asyncDispose]() {
      for (const preview of previews) await act(async () => preview.close());
      await act(async () => editor.close());
      await fixture[Symbol.asyncDispose]();
    },
  };
}

async function choose(view: Preview, label: string, value: string) {
  const select = Array.from(view.contentEl.querySelectorAll("label"))
    .find((element) => element.textContent?.includes(label))
    ?.querySelector("select");
  if (!select) throw new Error(`Missing control: ${label}`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const advance = (ms = 300) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function run(view: Preview) {
  const button = Array.from(view.contentEl.querySelectorAll("button")).find(
    (element) => element.textContent === m.workbench_preview_run(),
  );
  if (!button) throw new Error("Missing Run action");
  await act(async () => button.click());
  await advance(0);
}

describe("independent native Note Preview", () => {
  it("rolls back failed binding resources and can retry the same view", async () => {
    await using test = await setup();
    const released = vi.fn();
    vi.spyOn(test.fixture.deps.db, "on").mockReturnValue(released);
    vi.mocked(createProfileEditorHost).mockImplementationOnce(() => {
      throw new Error("Host unavailable");
    });
    await expect(test.open()).rejects.toThrow("Host unavailable");
    expect(released).toHaveBeenCalledOnce();
    expect(test.events.size).toBe(0);
    expect(test.subscriptions.size).toBe(0);
    const scheduler = vi
      .mocked(createRenderScheduler)
      .mock.results.at(-1)!.value;
    scheduler.setInput({ snapshot: test.fixture.snapshot });
    scheduler.run();
    expect(renderNativeProfile).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const preview = test.previews[0]!;
    await act(async () => preview.open());
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await advance();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    await act(async () => preview.close());
    expect(released).toHaveBeenCalledTimes(2);
    expect(test.events.size).toBe(0);
    expect(test.subscriptions.size).toBe(0);
  });

  it("opens without a picker, gives each Preview its own controls, and preserves editor history on close", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const first = await test.open();
    const second = await test.open();
    expect(pickItem).not.toHaveBeenCalled();
    expect(first.contentEl.textContent).toContain(
      m.template_data_explorer_choose_item(),
    );
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await advance();
    expect(first.contentEl.textContent).toContain("Personal space.");
    expect(second.contentEl.textContent).toContain("Personal space.");
    await choose(first, m.workbench_preview_refresh(), "demand");
    await choose(first, m.workbench_preview_mode(), "update");
    await choose(first, m.workbench_preview_format(), "markdown");
    expect(second.contentEl.querySelectorAll("select")[0]?.value).toBe(
      "create",
    );
    expect(second.contentEl.querySelectorAll("select")[1]?.value).toBe("live");
    expect(test.editor.store.getState().preview).toEqual({
      mode: "create",
      live: false,
    });
    await act(
      async () => void test.editor.controller.setManifestKey("name", "Revised"),
    );
    expect(test.editor.controller.canUndo).toBe(true);
    await act(async () => first.close());
    expect(test.subscriptions.size).toBe(1);
    expect(test.events.size).toBe(2);
    await act(async () => void test.editor.controller.undo());
    expect(test.editor.getViewData()).toBe(PROFILE_SOURCE);
    await act(async () => test.editor.scheduler.run());
    await advance(0);
    expect(test.editor.scheduler.getState().result?.creationBody).toContain(
      "Personal space.",
    );
    expect(second.contentEl.textContent).toContain("Personal space.");
  });

  it("runs current source during a save failure and rejects results for older source or a closed Preview", async () => {
    await using test = await setup();
    const actual = await vi.importActual<typeof import("./render")>("./render");
    const held = Promise.withResolvers<void>();
    vi.mocked(renderNativeProfile).mockImplementation(async (deps, request) => {
      if (request.source.includes("Old output.")) await held.promise;
      return actual.renderNativeProfile(deps, request);
    });
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    await choose(preview, m.workbench_preview_refresh(), "demand");
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Old output."),
        false,
      ),
    );
    await run(preview);
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Current output."),
        false,
      ),
    );
    await act(async () => held.resolve());
    expect(preview.contentEl.textContent).not.toContain("Old output.");
    test.editor.requestSave = () => {
      throw new Error("Disk unavailable");
    };
    await act(async () => {
      expect(() =>
        test.editor.controller.setManifestKey("name", "Unsaved draft"),
      ).toThrow("Disk unavailable");
    });
    await run(preview);
    expect(preview.contentEl.textContent).toContain("Current output.");
    expect(
      vi.mocked(renderNativeProfile).mock.calls.at(-1)?.[1].source,
    ).toContain("name: Unsaved draft");
    const closing = Promise.withResolvers<void>();
    vi.mocked(renderNativeProfile).mockImplementationOnce(
      async (deps, request) => {
        await closing.promise;
        return actual.renderNativeProfile(deps, request);
      },
    );
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Closed output."),
        false,
      ),
    );
    await run(preview);
    await act(async () => preview.close());
    closing.resolve();
    await advance(0);
    expect(preview.contentEl.textContent).toBe("");
    expect(test.subscriptions.size).toBe(0);
    expect(test.events.size).toBe(0);
    const calls = vi.mocked(renderNativeProfile).mock.calls.length;
    test.editor.setViewData(PROFILE_SOURCE, true);
    await advance();
    expect(vi.mocked(renderNativeProfile).mock.calls.length).toBe(calls);
  });

  it("keeps the last output visible while invalid source is repaired", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    const calls = vi.mocked(renderNativeProfile).mock.calls.length;
    await act(async () =>
      test.editor.setViewData("An incomplete Profile", false),
    );
    await advance();
    expect(preview.contentEl.querySelector('[role="alert"]')).not.toBeNull();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_stale(),
    );
    expect(vi.mocked(renderNativeProfile).mock.calls.length).toBe(calls);
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Repaired output."),
        false,
      ),
    );
    await advance();
    expect(preview.contentEl.textContent).toContain("Repaired output.");
    expect(preview.contentEl.querySelector('[role="alert"]')).toBeNull();
  });
});
