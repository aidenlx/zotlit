// @vitest-environment happy-dom
import type { App, EventRef, TFile, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey } from "@zotlit/db";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";
import { createRenderScheduler } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { pickItem } from "@/services/item-lookup/search-modal";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import type { SettingsService } from "@/services/settings/service";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import { ProfileEditorView } from "@/views/profile-editor/view";
import type { ProfileEditorDeps } from "@/views/profile-editor/view";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import { activeProfileEditor, subscribeActiveProfileEditor } from "./register";
import { renderNativeProfile } from "./render";
import { NotePreviewView } from "./view";
import type { PreviewViewDeps } from "./view";

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
  onCompanionStateRestored: (
    app: App,
    result: import("obsidian").ViewStateResult,
    callback: () => void,
  ) => {
    result.done = () => app.workspace.onLayoutReady(callback);
  },
  subscribeActiveProfileEditor: vi.fn(),
  registerCompanionHistory: vi.fn(() => () => {}),
  openProfileWorkbench: vi.fn(),
  activeProfileEditor: vi.fn(),
}));
vi.mock("@/services/item-lookup/search-modal", () => ({
  pickItem: vi.fn(async () => null),
}));
vi.mock("@/views/profile-editor/selection", async (original) => ({
  ...(await original<typeof import("@/views/profile-editor/selection")>()),
  chooseWorkbenchItem: async (
    _host: unknown,
    deps: Parameters<typeof pickItem>[0],
  ) => {
    const hit = await pickItem(deps, "");
    return hit ? { id: hit.item.indexedKey, title: null } : null;
  },
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

async function setup(
  profile: PreviewViewDeps["profile"] = {
    getBuiltInSource: () => DEFAULT_PROFILE_SOURCE,
  },
) {
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
    onLayoutReady: (callback: () => void) => callback(),
    iterateAllLeaves: vi.fn(),
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
  const file = fixture.vault.addFile("templates/paper.md", PROFILE_SOURCE);
  editor.file = file;
  editor.setViewData(PROFILE_SOURCE, true);
  // The editor's compact examples have their own refresh choice.
  editor.preview?.setPreview({ live: false });
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
  async function open(
    state?: Record<string, unknown>,
    ephemeral?: Record<string, unknown>,
  ) {
    const preview = new Preview({ app } as unknown as WorkspaceLeaf, "zotlit", {
      ...fixture.deps,
      settings: fixture.deps.settings as SettingsService,
      profile,
      itemLookup: { search: vi.fn() },
    });
    // The lightweight ItemView mock leaves this native base property to its test.
    Object.defineProperty(preview, "app", { value: app });
    previews.push(preview);
    if (state) await preview.setState(state, { history: false });
    if (ephemeral) preview.setEphemeralState(ephemeral);
    Object.defineProperties(preview.contentEl, {
      scrollHeight: { value: 1200 },
      clientHeight: { value: 200 },
    });
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
  it.each([null, "ABCD2345"])(
    "chooses an Item in a standalone restored Preview from %s and preserves cancellation",
    async (item) => {
      await using test = await setup();
      vi.useFakeTimers();
      vi.mocked(subscribeActiveProfileEditor).mockImplementation(
        (_app, listener) => {
          listener(null);
          return () => {};
        },
      );
      const saved = { source: { path: "templates/paper.md" }, item };
      const preview = await test.open(saved);
      await advance();
      const choose = () =>
        [...preview.contentEl.querySelectorAll("button")].find(
          (button) =>
            button.textContent === m.template_data_explorer_choose_item(),
        )!;
      expect(choose().disabled).toBe(false);
      vi.mocked(pickItem).mockResolvedValueOnce(null);
      await act(async () => choose().click());
      expect(preview.getState()["item"]).toBe(item);
      using lease = await test.fixture.deps.db.acquireRead();
      const hit = {
        item: getItemsByKey(lease.client, 1, ["MAIN2345"])[0]!,
        score: 1,
        matches: [],
        library: null,
      };
      vi.mocked(pickItem).mockResolvedValueOnce(hit);
      await act(async () => choose().click());
      await advance();
      expect(preview.getState()).toMatchObject({
        source: saved.source,
        item: "MAIN2345",
      });
      expect(preview.contentEl.textContent).toContain("Personal space.");
      expect(test.editor.store.getState().item).toBeNull();
    },
  );

  it("discards standalone Item choices after context changes or closure", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    vi.mocked(subscribeActiveProfileEditor).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const saved = { source: { path: "templates/paper.md" }, item: null };
    const preview = await test.open(saved);
    const choose = () =>
      [...preview.contentEl.querySelectorAll("button")].find(
        (button) =>
          button.textContent === m.template_data_explorer_choose_item(),
      )!;
    using lease = await test.fixture.deps.db.acquireRead();
    const hit = {
      item: getItemsByKey(lease.client, 1, ["MAIN2345"])[0]!,
      score: 1,
      matches: [],
      library: null,
    };
    const changed =
      Promise.withResolvers<Awaited<ReturnType<typeof pickItem>>>();
    vi.mocked(pickItem).mockReturnValueOnce(changed.promise);
    await act(async () => choose().click());
    await act(async () =>
      preview.setState(
        { source: { builtin: true }, item: null },
        { history: false },
      ),
    );
    await act(async () => changed.resolve(hit));
    expect(preview.getState()).toMatchObject({
      source: { builtin: true },
      item: null,
    });
    const closed =
      Promise.withResolvers<Awaited<ReturnType<typeof pickItem>>>();
    vi.mocked(pickItem).mockReturnValueOnce(closed.promise);
    await act(async () => choose().click());
    await act(async () => preview.close());
    await act(async () => closed.resolve(hit));
    expect(preview.getState()["item"]).toBeNull();
    expect(preview.contentEl.textContent).toBe("");
  });

  it("applies an explicit Item choice only to the requesting pinned Preview and preserves cancellation", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const first = await test.open();
    const second = await test.open();
    first.leaf.pinned = true;
    second.leaf.pinned = true;
    vi.mocked(pickItem).mockResolvedValueOnce({
      item: { indexedKey: "MAIN2345" },
    } as NonNullable<Awaited<ReturnType<typeof pickItem>>>);
    const choose = (preview: Preview) =>
      [...preview.contentEl.querySelectorAll("button")].find(
        (button) =>
          button.textContent === m.template_data_explorer_choose_item(),
      )!;
    await act(async () => choose(first).click());
    await advance();
    expect(first.getState()["item"]).toBe("MAIN2345");
    expect(first.contentEl.textContent).toContain("Personal space.");
    expect(second.getState()["item"]).toBeNull();
    vi.mocked(pickItem).mockResolvedValueOnce(null);
    await act(async () => choose(second).click());
    await advance();
    expect(second.getState()["item"]).toBeNull();
    expect(second.contentEl.textContent).toContain(
      m.workbench_preview_choose_item(),
    );
    expect(first.getState()["item"]).toBe("MAIN2345");
  });

  it("keeps the followed editor when native opening applies an empty state after onOpen", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await act(async () => preview.setState({}, { history: false }));
    await advance();
    expect(preview.getState()).toMatchObject({
      source: { path: "templates/paper.md" },
      item: "MAIN2345",
    });
    expect(preview.contentEl.textContent).toContain("Personal space.");
    expect(pickItem).not.toHaveBeenCalled();
  });

  it("rebinds a restored linked Preview to live group context and preserves pinned context", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () => {
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" });
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Current group draft."),
        false,
      );
    });
    const preview = await test.open();
    vi.mocked(activeProfileEditor).mockReturnValue(test.editor);
    const saved = {
      source: { builtin: true },
      item: "ABCD2345",
      mode: "create",
      live: true,
      showMarkdown: true,
    };
    const result: import("obsidian").ViewStateResult = { history: false };
    await act(async () => preview.setState(saved, result));
    expect(preview.getState()).toMatchObject({
      source: { builtin: true },
      item: "ABCD2345",
    });
    preview.leaf.group = "saved-group";
    await act(async () => result.done?.());
    await advance();
    expect(preview.getState()).toMatchObject({
      source: { path: "templates/paper.md" },
      item: "MAIN2345",
      showMarkdown: true,
    });
    expect(preview.contentEl.textContent).toContain("Current group draft.");
    preview.leaf.pinned = true;
    const pinnedResult: import("obsidian").ViewStateResult = { history: false };
    await act(async () => preview.setState(saved, pinnedResult));
    await act(async () => pinnedResult.done?.());
    await advance();
    expect(preview.getState()).toMatchObject({
      source: { builtin: true },
      item: "ABCD2345",
      showMarkdown: true,
    });
    expect(
      preview.contentEl.querySelector("[role=alert]")?.textContent,
    ).toContain("ABCD2345");
    expect(pickItem).not.toHaveBeenCalled();
  });

  it("recreates persisted output choices from disk without an editor or picker", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const first = await test.open();
    await advance();
    await choose(first, m.workbench_preview_format(), "markdown");
    const saved = first.getState();
    expect(saved).toMatchObject({
      source: { path: "templates/paper.md" },
      item: "MAIN2345",
      showMarkdown: true,
    });
    expect(Object.keys(saved)).not.toContain("sourceText");
    await act(async () => first.close());
    vi.mocked(subscribeActiveProfileEditor).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const restored = await test.open(saved);
    await advance();
    expect(restored.contentEl.textContent).toContain("Personal space.");
    expect(
      [...restored.contentEl.querySelectorAll("select")].some(
        (select) => select.value === "markdown",
      ),
    ).toBe(true);
    expect(restored.getState()).toEqual(saved);
    expect(pickItem).not.toHaveBeenCalled();
  });

  it("restores pending result scroll after data mounts, without focus or layout writes", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const first = await test.open();
    await advance();
    first.contentEl.scrollTop = 350;
    const saved = first.getState();
    const ephemeral = first.getEphemeralState();
    vi.mocked(subscribeActiveProfileEditor).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const restored = await test.open(saved, ephemeral);
    expect(restored.contentEl.scrollTop).toBe(0);
    const saveLayout = vi.mocked(
      test.fixture.deps.app.workspace.requestSaveLayout,
    );
    saveLayout.mockClear();
    await advance();
    await advance(0);
    expect(restored.contentEl.scrollTop).toBe(350);
    expect(document.activeElement).toBe(input);
    restored.contentEl.scrollTop = 400;
    restored.contentEl.dispatchEvent(new Event("scroll"));
    expect(saveLayout).not.toHaveBeenCalled();
    expect(restored.getState()).toEqual(saved);
    restored.setEphemeralState({
      zotlitPreview: {
        ...(ephemeral["zotlitPreview"] as object),
        scrollTop: 9000,
        reveal: "removed-heading",
      },
    });
    expect(restored.contentEl.scrollTop).toBe(1000);
    expect(document.activeElement).toBe(input);
    expect(saveLayout).not.toHaveBeenCalled();
    await act(async () =>
      restored.setState({ ...saved, item: "ABCD2345" }, { history: false }),
    );
    restored.setEphemeralState(ephemeral);
    await advance();
    expect(restored.getState()["item"]).toBe("ABCD2345");
    expect(restored.state.getState().presentation.pending).toBe(false);
    expect(
      restored.contentEl.querySelector("[role=alert]")?.textContent,
    ).toContain("ABCD2345");
  });

  it("restores configured built-in frontmatter even when a custom Default document exists", async () => {
    await using source = await profileServiceFixture({
      "templates/zotlit-profile.default.md": `---
id: default
name: Default
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
Custom Default body.
{% managed %}Managed{% endmanaged %}
--- zotlit:annotation ---
Annotation`,
    });
    source.settings.update({
      "note.frontmatter-fields": [
        {
          key: "reading-status",
          expr: "'unread'",
          merge: "keep",
          language: "liquid",
        },
      ],
    });
    expect(await source.profile.getSource("default")).toContain(
      "Custom Default body.",
    );
    await using test = await setup(source.profile);
    vi.useFakeTimers();
    vi.mocked(subscribeActiveProfileEditor).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const restored = await test.open({
      source: { builtin: true },
      item: "MAIN2345",
      showMarkdown: true,
    });
    await advance();
    expect(restored.contentEl.textContent).toContain("reading-status: unread");
    expect(restored.contentEl.textContent).not.toContain(
      "Custom Default body.",
    );
    expect(restored.getState()["source"]).toEqual({ builtin: true });
  });

  it("restores a built-in source and keeps on-demand rendering paused", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    vi.mocked(subscribeActiveProfileEditor).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const restored = await test.open({
      source: { builtin: true },
      item: "MAIN2345",
      mode: "update",
      live: false,
      showManaged: true,
    });
    await advance();
    expect(restored.getState()).toMatchObject({
      source: { builtin: true },
      item: "MAIN2345",
      mode: "update",
      live: false,
      showManaged: true,
    });
    expect(restored.contentEl.querySelectorAll("select")[1]?.value).toBe(
      "demand",
    );
    expect(renderNativeProfile).not.toHaveBeenCalled();
    await run(restored);
    expect(renderNativeProfile).toHaveBeenCalled();
  });

  it("rolls back failed binding resources and can retry the same view", async () => {
    await using test = await setup();
    const released = vi.fn();
    vi.spyOn(test.fixture.deps.db, "on").mockReturnValue(released);
    vi.mocked(createProfileEditorHost).mockImplementationOnce(() => {
      throw new Error("Host unavailable");
    });
    await expect(test.open()).rejects.toThrow("Host unavailable");
    expect(released).toHaveBeenCalledOnce();
    expect(test.events.size).toBe(2);
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
    expect(test.events.size).toBe(2);
    expect(test.subscriptions.size).toBe(0);
  });

  it("keeps an unlinked Preview current after its editor closes and rejects delayed disk source", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await test.open();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await advance(1000);
    const file = test.editor.file!;
    for (const listener of test.subscriptions) listener(null);
    await test.editor.close();
    const { vault, deps } = test.fixture;
    await act(async () => {
      vault.modifyFile(
        file.path,
        PROFILE_SOURCE.replace("Personal space.", "Disk update."),
      );
    });
    await advance(1000);
    expect(preview.contentEl.textContent).toContain("Disk update.");
    const delayed = Promise.withResolvers<string>();
    vault.cachedRead.mockReturnValueOnce(delayed.promise);
    vault.modifyFile(
      file.path,
      PROFILE_SOURCE.replace("Personal space.", "Old disk update."),
    );
    await act(async () => {
      deps.app.workspace.trigger(
        "quick-preview",
        file,
        PROFILE_SOURCE.replace("Personal space.", "Current live source."),
      );
      delayed.resolve(
        PROFILE_SOURCE.replace("Personal space.", "Old disk update."),
      );
    });
    await advance(1000);
    expect(preview.contentEl.textContent).toContain("Current live source.");
    expect(preview.contentEl.textContent).not.toContain("Old disk update.");
    vault.renameFile(file.path, "templates/renamed.md");
    await act(async () => {
      vault.modifyFile(
        file.path,
        PROFILE_SOURCE.replace("Personal space.", "Renamed source."),
      );
    });
    await advance(1000);
    expect(preview.contentEl.textContent).toContain("Renamed source.");
    await act(async () => vault.deleteFile(file.path));
    expect(preview.contentEl.textContent).toContain(
      m.settings_profile_document_missing({ path: "templates/renamed.md" }),
    );
    const foreign = vault.addFile("templates/renamed.md", PROFILE_SOURCE);
    await act(async () =>
      deps.app.workspace.trigger(
        "quick-preview",
        foreign,
        PROFILE_SOURCE.replace("Personal space.", "Unrelated replacement."),
      ),
    );
    await advance(1000);
    expect(preview.contentEl.textContent).not.toContain(
      "Unrelated replacement.",
    );
  });

  it("refreshes a renamed Profile while an older modify read is pending", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await test.open();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await advance(1000);
    const file = test.editor.file!;
    for (const listener of test.subscriptions) listener(null);
    await test.editor.close();
    const { vault, deps } = test.fixture;
    const pending = Promise.withResolvers<string>();
    const read = vi.fn((target: TFile) => vault.cachedRead(target));
    Object.assign(deps.app.vault, { read });
    read.mockReturnValueOnce(pending.promise);
    await act(async () => {
      vault.modifyFile(
        file.path,
        PROFILE_SOURCE.replace("Personal space.", "Renamed current source."),
      );
      vault.renameFile(file.path, "templates/renamed.md");
    });
    await advance(1000);
    expect(preview.contentEl.textContent).toContain("Renamed current source.");
    await act(async () => pending.resolve(PROFILE_SOURCE));
    await advance(1000);
    expect(preview.contentEl.textContent).toContain("Renamed current source.");
    expect(preview.contentEl.textContent).not.toContain("Personal space.");
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
    expect(test.editor.preview?.state.getState().preview).toEqual({
      mode: "create",
      live: false,
    });
    await act(
      async () => void test.editor.controller.setManifestKey("name", "Revised"),
    );
    expect(test.editor.controller.canUndo).toBe(true);
    await act(async () => first.close());
    expect(test.subscriptions.size).toBe(1);
    expect(test.events.size).toBe(5);
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
    expect(test.events.size).toBe(2);
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
  it("holds pinned Item context, retains output after source closure, and disables source actions", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    preview.leaf.pinned = true;
    await act(async () => test.editor.store.getState().setItem(null));
    await advance();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    await act(async () => {
      for (const listener of test.subscriptions) listener(null);
    });
    expect(preview.contentEl.textContent).toContain("Personal space.");
    await act(async () =>
      test.editor.setViewData("An incomplete Profile", false),
    );
    await advance();
    const source = [...preview.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === m.workbench_problems_where_advanced(),
    );
    expect(source?.disabled).toBe(true);
  });
  it("holds a pinned Profile when an earlier group peer joins and adopts that peer on unpin", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    const otherFile = test.fixture.vault.addFile(
      "templates/books.md",
      PROFILE_SOURCE,
    );
    const chooseItem = vi.fn();
    const revealSlice = vi.fn();
    const earlierPeer = {
      leaf: {} as WorkspaceLeaf,
      file: otherFile,
      nativeRenderDeps: test.editor.nativeRenderDeps,
      authoringContext: {
        ...test.editor.authoringContext,
        leaf: {} as WorkspaceLeaf,
        path: otherFile.path,
        item: null,
      },
      getViewData: () =>
        PROFILE_SOURCE.replace("Personal space.", "Books output."),
      chooseItem,
      revealSlice,
    } as unknown as ProfileEditorView;
    preview.leaf.pinned = true;
    await act(async () => {
      for (const listener of test.subscriptions) listener(earlierPeer);
    });
    await advance();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    expect(preview.contentEl.textContent).not.toContain(
      m.workbench_preview_choose_item(),
    );
    await act(async () =>
      test.editor.setViewData("An incomplete Profile", false),
    );
    await advance();
    const source = [...preview.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === m.workbench_problems_where_advanced(),
    )!;
    expect(source.disabled).toBe(true);
    await act(async () => source.click());
    expect(revealSlice).not.toHaveBeenCalled();
    expect(chooseItem).not.toHaveBeenCalled();
    preview.leaf.pinned = false;
    await act(async () => {
      for (const listener of test.subscriptions) listener(earlierPeer);
    });
    await advance();
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_choose_item(),
    );
    expect(preview.contentEl.querySelector('[role="alert"]')).toBeNull();
    const choose = [...preview.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === m.template_data_explorer_choose_item(),
    )!;
    expect(choose.disabled).toBe(false);
    await act(async () => choose.click());
    expect(chooseItem).toHaveBeenCalledOnce();
  });
});
