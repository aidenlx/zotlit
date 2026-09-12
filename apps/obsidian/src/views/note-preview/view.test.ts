import { Menu } from "@mock/obsidian";
import type { ItemView as MockItemView } from "@mock/obsidian";
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
import { createTemplateWorkbenchHost } from "@/views/template-workbench/host";
import { TemplateWorkbenchView } from "@/views/template-workbench/view";
import type { TemplateWorkbenchDeps } from "@/views/template-workbench/view";

import { createRenderFixture, PROFILE_SOURCE } from "./__fixtures__/render";
import {
  activeTemplateWorkbench,
  subscribeActiveTemplateWorkbench,
} from "./register";
import { renderNativeTemplate } from "./render";
import { NotePreviewView } from "./view";
import type { PreviewViewDeps } from "./view";

vi.mock("@zotlit/workbench/ui", async (original) => {
  const actual = await original<typeof import("@zotlit/workbench/ui")>();
  return {
    ...actual,
    createRenderScheduler: vi.fn(actual.createRenderScheduler),
  };
});
vi.mock("@/views/template-workbench/host", async (original) => {
  const actual =
    await original<typeof import("@/views/template-workbench/host")>();
  return {
    ...actual,
    createTemplateWorkbenchHost: vi.fn(actual.createTemplateWorkbenchHost),
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
  subscribeActiveTemplateWorkbench: vi.fn(),
  registerCompanionHistory: vi.fn(() => () => {}),
  openWorkbenchLayout: vi.fn(),
  activeTemplateWorkbench: vi.fn(),
}));
vi.mock("@/services/item-lookup/search-modal", () => ({
  pickItem: vi.fn(async () => null),
}));
vi.mock("@/views/template-workbench/selection", async (original) => ({
  ...(await original<typeof import("@/views/template-workbench/selection")>()),
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
  return {
    ...actual,
    renderNativeTemplate: vi.fn(actual.renderNativeTemplate),
  };
});

class Preview extends NotePreviewView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}
class Editor extends TemplateWorkbenchView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
  if ("clipboard" in navigator)
    delete (navigator as { clipboard?: unknown }).clipboard;
});

const NO_PROFILES: PreviewViewDeps["profile"] = {
  getBuiltInSource: () => DEFAULT_PROFILE_SOURCE,
  profiles: [],
  resolveProfile: () => undefined,
};

async function setup(profile: PreviewViewDeps["profile"] = NO_PROFILES) {
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
    revealLeaf: vi.fn(async () => {}),
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
    templates: fixture.deps.templates,
    nativePreview: fixture.deps,
  } as unknown as TemplateWorkbenchDeps);
  const file = fixture.vault.addFile("templates/paper.md", PROFILE_SOURCE);
  editor.file = file;
  editor.setViewData(PROFILE_SOURCE, true);
  // The editor's compact examples have their own refresh choice.
  editor.preview?.setPreview({ live: false });
  const subscriptions = new Set<(view: TemplateWorkbenchView | null) => void>();
  vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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

function menuItem(view: Preview, title: string) {
  const menu = new Menu();
  view.onPaneMenu(menu as never, "more-options");
  const item = menu.items.find((candidate) => candidate.title === title);
  if (!item) throw new Error(`Missing pane menu item: ${title}`);
  return item;
}
async function pick(view: Preview, title: string) {
  await act(async () => menuItem(view, title).click());
}
const advance = (ms = 300) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Presses the preview's own button whose text is `label`. */
function previewButton(view: Preview, label: string): void {
  const button = Array.from(view.contentEl.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  if (!button) throw new Error(`Missing preview action: ${label}`);
  button.click();
}

/** The editor's Problems area, which owns the detailed explanation. */
function problemsArea(view: Editor): HTMLElement {
  const area = view.contentEl.querySelector<HTMLElement>(
    '[data-part="problems"]',
  );
  if (!area) throw new Error("The Problems area is not open");
  return area;
}

/** Presses the Problems area's own button whose text is `label`. */
function problemsButton(view: Editor, label: string): void {
  const button = Array.from(problemsArea(view).querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  if (!button) throw new Error(`Missing Problems action: ${label}`);
  button.click();
}

/**
 * An editor showing `source` with a preview open on it, both settled. The
 * editor's own content element is in the document, so the Problems area the
 * assertions read is the one a reader sees.
 */
async function failing(
  test: Awaited<ReturnType<typeof setup>>,
  source: string,
): Promise<Preview> {
  await act(async () =>
    test.editor.store
      .getState()
      .setItem({ id: "MAIN2345", title: "Better figures" }),
  );
  document.body.append(test.editor.contentEl);
  await act(async () => test.editor.open());
  const preview = await test.open();
  await advance();
  await act(async () => test.editor.setViewData(source, false));
  await advance();
  return preview;
}

/**
 * The clipboard the host copies through, as a list of what reached it. This
 * runtime supplies none, so the test defines one and takes it away after.
 */
function stubClipboard(): string[] {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => (writes.push(text), Promise.resolve()),
    },
  });
  return writes;
}

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
      vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    vi.mocked(activeTemplateWorkbench).mockReturnValue(test.editor);
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
    await pick(first, m.workbench_show_markdown());
    const saved = first.getState();
    expect(saved).toMatchObject({
      source: { path: "templates/paper.md" },
      item: "MAIN2345",
      showMarkdown: true,
    });
    expect(Object.keys(saved)).not.toContain("sourceText");
    await act(async () => first.close());
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    const restored = await test.open(saved);
    await advance();
    expect(restored.contentEl.textContent).toContain("Personal space.");
    expect(menuItem(restored, m.workbench_show_markdown()).checked).toBe(true);
    expect(
      (restored as unknown as MockItemView).actions.some(
        (action) =>
          action.getAttribute("aria-label") === m.workbench_show_reading_view(),
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
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    expect(menuItem(restored, m.workbench_preview_auto_refresh()).checked).toBe(
      false,
    );
    expect(renderNativeTemplate).not.toHaveBeenCalled();
    await run(restored);
    expect(renderNativeTemplate).toHaveBeenCalled();
  });

  it("rolls back failed binding resources and can retry the same view", async () => {
    await using test = await setup();
    const released = vi.fn();
    vi.spyOn(test.fixture.deps.db, "on").mockReturnValue(released);
    vi.mocked(createTemplateWorkbenchHost).mockImplementationOnce(() => {
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
    expect(renderNativeTemplate).not.toHaveBeenCalled();

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
    await pick(first, m.workbench_preview_auto_refresh());
    await pick(first, m.workbench_show_markdown());
    await pick(first, m.workbench_preview_updated_section());
    expect(menuItem(second, m.workbench_preview_auto_refresh()).checked).toBe(
      true,
    );
    expect(menuItem(second, m.workbench_show_markdown()).checked).toBe(false);
    expect(menuItem(second, m.workbench_preview_as_new_note()).checked).toBe(
      true,
    );
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
    vi.mocked(renderNativeTemplate).mockImplementation(
      async (deps, request) => {
        if (request.source.includes("Old output.")) await held.promise;
        return actual.renderNativeTemplate(deps, request);
      },
    );
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    await pick(preview, m.workbench_preview_auto_refresh());
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
      vi.mocked(renderNativeTemplate).mock.calls.at(-1)?.[1].source,
    ).toContain("name: Unsaved draft");
    const closing = Promise.withResolvers<void>();
    vi.mocked(renderNativeTemplate).mockImplementationOnce(
      async (deps, request) => {
        await closing.promise;
        return actual.renderNativeTemplate(deps, request);
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
    const calls = vi.mocked(renderNativeTemplate).mock.calls.length;
    test.editor.setViewData(PROFILE_SOURCE, true);
    await advance();
    expect(vi.mocked(renderNativeTemplate).mock.calls.length).toBe(calls);
  });

  it("explains a failed note render in the editor and clears it after a repair", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    document.body.append(test.editor.contentEl);
    await act(async () => test.editor.open());
    const preview = await test.open();
    await advance();
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace(
          "Personal space.",
          `{% render "book-details" with zt as zt %}`,
        ),
        false,
      ),
    );
    await advance();

    // The preview names the failure rather than presenting an empty note.
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_problem(),
    );
    expect(preview.contentEl.textContent).toContain(
      m.workbench_diagnostic_missing_partial({ name: "book-details" }),
    );
    // The note that last rendered stands beside the failure, named as the
    // last preview that worked, so the repair is read against it.
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_retained(),
    );
    expect(preview.contentEl.textContent).toContain("Personal space.");
    // Automatic checks stay compact: the suggestion waits to be asked for.
    expect(test.editor.contentEl.textContent).not.toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );

    await act(async () => previewButton(preview, m.workbench_problem_show()));
    const area = test.editor.contentEl.querySelector<HTMLElement>(
      '[data-part="problems"]',
    )!;
    expect(area.textContent).toContain(
      m.workbench_problems_object_partial({ name: "book-details" }),
    );
    expect(area.textContent).toContain(
      m.workbench_diagnostic_missing_partial({ name: "book-details" }),
    );
    expect(area.textContent).toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );

    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Repaired output."),
        false,
      ),
    );
    await advance();
    expect(preview.contentEl.textContent).toContain("Repaired output.");
    expect(preview.contentEl.textContent).not.toContain(
      m.workbench_preview_problem(),
    );
    // A successful check publishes the new output and takes the retained
    // notice with the failure it explained.
    expect(preview.contentEl.textContent).not.toContain(
      m.workbench_preview_retained(),
    );
    // An area the reader opened keeps its space; the repaired failure is gone.
    expect(area.isConnected).toBe(true);
    expect(area.textContent).not.toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );
  });

  it("sends the reader to the call that named the missing partial", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const call = `{% render "book-details" %}`;
    const source = PROFILE_SOURCE.replace("Personal space.", call);
    // Hand-derived: the call stands where the personal paragraph stood.
    const at = {
      from: source.indexOf(call),
      to: source.indexOf(call) + call.length,
    };
    const preview = await failing(test, source);

    await act(async () => previewButton(preview, m.workbench_problem_show()));
    const area = problemsArea(test.editor);
    expect(area.textContent).toContain(
      m.workbench_problems_object_partial({ name: "book-details" }),
    );
    expect(area.textContent).toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );
    // Nothing was read inside a partial that does not exist, so the engine
    // reported no location of its own.
    expect(area.textContent).not.toContain(
      m.workbench_problems_engine_source({ template: "book-details" }),
    );
    expect(area.textContent).not.toContain(
      m.workbench_problems_location_unknown(),
    );

    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_where_call()),
    );
    expect(test.editor.store.getState().presentation.reveal).toEqual(at);
    // Diagnosis navigates and explains; it writes nothing.
    expect(test.fixture.writes.create).not.toHaveBeenCalled();
    expect(test.fixture.writes.modify).not.toHaveBeenCalled();
  });

  it("blames the call, not the citation text the engine failed inside", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const call = `{% render "citation" %}`;
    const source = PROFILE_SOURCE.replace("Personal space.", call);
    const at = {
      from: source.indexOf(call),
      to: source.indexOf(call) + call.length,
    };
    const preview = await failing(test, source);

    await act(async () => previewButton(preview, m.workbench_problem_show()));
    const area = problemsArea(test.editor);
    expect(area.textContent).toContain(m.workbench_problems_object_citation());
    expect(area.textContent).toContain(
      m.workbench_diagnostic_citation_data_mismatch(),
    );
    expect(area.textContent).toContain(
      m.workbench_diagnostic_citation_data_suggestion(),
    );
    // Hand-derived: the built-in citation text pipes `zt.citations` through
    // `pandoc_cite` on its fourth line, and that location stays the engine's
    // own rather than becoming a line of the note being edited.
    expect(area.textContent).toContain(
      m.workbench_problems_engine_source_line({
        template: "citation",
        line: 4,
      }),
    );
    expect(area.textContent).toContain("pandoc_cite requires a Citation Item");
    // The annotation root's rendered citation is no field of a note root, so
    // it is never proposed as the replacement here. The engine's own excerpt
    // under Technical details quotes the failing line as the engine wrote it.
    expect(
      area.querySelector('[data-part="problems-recovery"]')?.textContent,
    ).not.toContain("zt.citation");

    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_where_call()),
    );
    expect(test.editor.store.getState().presentation.reveal).toEqual(at);
  });

  it("opens the property row a failed managed field came from", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await failing(
      test,
      PROFILE_SOURCE.replace("expr: zt.title", "expr: zt.title | bogus_filter"),
    );

    await act(async () => previewButton(preview, m.workbench_problem_show()));
    const area = problemsArea(test.editor);
    expect(area.textContent).toContain(
      m.workbench_problems_object_property({ key: "title" }),
    );
    expect(area.textContent).toContain(
      m.workbench_diagnostic_property_error_suggestion(),
    );

    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_where_entry()),
    );
    // The first Managed Frontmatter entry is the row that produced it.
    expect(test.editor.store.getState().presentation.selected).toBe(1);
  });

  it("keeps an unclassified engine failure honest about what it knows", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await failing(
      test,
      PROFILE_SOURCE.replace(
        "Personal space.",
        "{{ zt.title | bogus_filter }}",
      ),
    );

    await act(async () => previewButton(preview, m.workbench_problem_show()));
    const area = problemsArea(test.editor);
    expect(area.textContent).toContain(
      m.workbench_diagnostic_render_error_suggestion(),
    );
    // The engine's own words survive, and its own location is reported as its
    // own — no call in this source names the template it blamed.
    expect(area.textContent).toContain("undefined filter: bogus_filter");
    expect(area.textContent).toContain(m.workbench_problems_location_unknown());
    expect(
      Array.from(problemsArea(test.editor).querySelectorAll("button")).map(
        (button) => button.textContent,
      ),
    ).not.toContain(m.workbench_problems_where_call());
  });

  it("explains the failure that brought the reader from a refused note operation", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const source = PROFILE_SOURCE.replace(
      "Personal space.",
      `{% render "book-details" %}`,
    );
    // The route in carries the refusal's own code and the partial it named.
    await act(async () =>
      test.editor.explainArrival({
        code: "missing-partial",
        subject: "book-details",
      }),
    );
    await failing(test, source);

    expect(problemsArea(test.editor).textContent).toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );
    // One arrival opens one explanation; a later check leaves it alone.
    expect(test.editor.arrival).toBeNull();
    expect(test.fixture.writes.create).not.toHaveBeenCalled();
    expect(test.fixture.writes.modify).not.toHaveBeenCalled();
    expect(test.fixture.writes.process).not.toHaveBeenCalled();
  });

  it("hides retained output once the preview selection has moved on", async () => {
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
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace(
          "Personal space.",
          `{% render "book-details" with zt as zt %}`,
        ),
        false,
      ),
    );
    await advance();
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_retained(),
    );
    expect(preview.contentEl.textContent).toContain("Personal space.");

    // Reading another field is not another preview: the rendering root, and
    // the output kept for it, are the ones the reader already had.
    const calls = vi.mocked(renderNativeTemplate).mock.calls.length;
    await act(async () =>
      test.editor.setPresentation({ fieldFocus: { field: "title" } }),
    );
    await advance();
    expect(vi.mocked(renderNativeTemplate).mock.calls.length).toBe(calls);
    expect(preview.contentEl.textContent).toContain("Personal space.");

    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "sample:book", title: "Sample book" }),
    );
    await advance();
    // Another paper is another preview, so the first one's note is not read
    // as its comparison.
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_unavailable(),
    );
    expect(preview.contentEl.textContent).not.toContain("Personal space.");
  });

  it("copies the engine evidence from the failed attempt, and keeps it through a repair", async () => {
    const copied = stubClipboard();
    // The fixture's own manifest carries a value the rows cannot parse, which
    // would keep a document problem selected after the repair. This reader's
    // template has only the failure under test.
    const source = PROFILE_SOURCE.replace(
      "value: [review]",
      'value: ["review"]',
    );
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await failing(
      test,
      source.replace(
        "Personal space.",
        `{% render "book-details" with zt as zt %}`,
      ),
    );
    await act(async () => previewButton(preview, m.workbench_problem_show()));

    const area = problemsArea(test.editor);
    const report = () =>
      area.querySelector<HTMLElement>('[data-part="problems-report"]')!
        .textContent!;
    // Technical details shows the report; it is still collapsed, and copying
    // does not wait for the reader to open it.
    const details = area.querySelector("details")!;
    expect(details.open).toBe(false);
    // The engine's own account of the missing partial, as it was thrown. The
    // partial name reaches the report as the location the engine named.
    expect(report()).toContain(
      [
        "Engine message:",
        'Template "book-details" not found',
        "",
        "Problem code: missing-partial",
        "Engine name: MissingTemplateError",
        "Reported location: book-details",
      ].join("\n"),
    );
    // Nothing has established where the failure belongs, and the report says
    // so rather than leaving the reader a blank to read as "none".
    expect(report()).toContain("Engine location: unavailable");
    expect(report()).toContain("Trigger: automatic");
    expect(report()).toContain("Template document: templates/paper.md");
    expect(report()).toContain("Template language: liquid");
    expect(report()).toContain("Rendering root: note");
    expect(report()).toContain("Selection: item=MAIN2345");
    expect(report()).toContain("Host version: Obsidian 1.0.0-test");

    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_copy()),
    );
    expect(copied).toEqual([report()]);
    const inspected = copied[0]!;

    // A later edit fails differently, and that failure brings its own report
    // rather than rewriting the one already captured.
    await act(async () =>
      test.editor.setViewData(
        source.replace(
          "Personal space.",
          `{% render "figure-caption" with zt as zt %}`,
        ),
        false,
      ),
    );
    await advance();
    await act(async () => previewButton(preview, m.workbench_problem_show()));
    expect(report()).toContain('Template "figure-caption" not found');
    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_copy()),
    );
    const second = copied[1]!;
    expect(second).not.toBe(inspected);
    expect(second).toContain("Reported location: figure-caption");

    // Choosing another paper re-renders and reports that attempt's own paper.
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "BOOK2345", title: "Reading between the lines" }),
    );
    await advance();

    // The repair succeeds. The area keeps the failure the reader was reading,
    // and copying it again produces the same text it produced before.
    await act(async () =>
      test.editor.setViewData(
        source.replace("Personal space.", "Repaired output."),
        false,
      ),
    );
    await advance();
    expect(area.textContent).toContain(m.workbench_problems_none());
    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_copy_last()),
    );
    expect(copied.at(-1)).toBe(copied.at(-2));
    expect(copied.at(-1)).toContain("Reported location: figure-caption");
  });

  it("reports a document problem the parser found, with no engine behind it", async () => {
    const copied = stubClipboard();
    await using test = await setup();
    vi.useFakeTimers();
    // The fixture's own manifest carries a list value the rows cannot read,
    // which is a validation problem with no render behind it at all.
    await failing(test, PROFILE_SOURCE);

    const area = problemsArea(test.editor);
    await act(async () =>
      problemsButton(test.editor, m.workbench_problem_show()),
    );
    const report = () =>
      area.querySelector<HTMLElement>('[data-part="problems-report"]')!
        .textContent!;
    // Hand-derived: the value the parser refused is the second entry's, and
    // it stands where the fixture spells it.
    const at = PROFILE_SOURCE.indexOf("[review]");
    expect(report()).toContain(
      [
        "Engine message:",
        m.workbench_problem_invalid_manifest_field({
          field: "frontmatter.1.value",
        }),
        "",
        "Problem code: invalid-manifest",
        "Engine name: unavailable",
        `Reported location: offset ${at}-${at + "[review]".length}`,
        "Engine location: unavailable",
        "Calling template: unavailable",
        "Repair target: unavailable",
        "Document section: entry:2",
      ].join("\n"),
    );
    // No error was ever thrown, and no render ever ran for this one.
    expect(report()).toContain("Stack: unavailable");
    expect(report()).toContain("Attempt: unavailable");
    expect(report()).toContain("Snapshot revision: unavailable");
    // The attempt's own context is captured whole, the same as a render's.
    expect(report()).toContain("Trigger: automatic");
    expect(report()).toContain("Template document: templates/paper.md");
    expect(report()).toContain("Template language: liquid");
    expect(report()).toContain("Rendering root: note");
    expect(report()).toContain("Selection: item=MAIN2345");
    expect(report()).toContain("Host version: Obsidian 1.0.0-test");

    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_copy()),
    );
    const inspected = report();
    expect(copied).toEqual([inspected]);

    // Editing elsewhere leaves the manifest's problem standing, and the report
    // still describes the check that found it rather than the source now open.
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Edited."),
        false,
      ),
    );
    await advance();
    expect(report()).toBe(inspected);
    await act(async () =>
      problemsButton(test.editor, m.workbench_problems_copy()),
    );
    expect(copied).toEqual([inspected, inspected]);
  });

  it("takes a closed preview's findings back out of the editor", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    document.body.append(test.editor.contentEl);
    await act(async () => test.editor.open());
    const preview = await test.open();
    await advance();
    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace(
          "Personal space.",
          `{% render "book-details" with zt as zt %}`,
        ),
        false,
      ),
    );
    await advance();
    await act(async () => previewButton(preview, m.workbench_problem_show()));
    expect(test.editor.contentEl.textContent).toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );

    await act(async () => preview.close());
    expect(test.editor.contentEl.textContent).not.toContain(
      m.workbench_diagnostic_missing_partial_suggestion(),
    );
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
    const calls = vi.mocked(renderNativeTemplate).mock.calls.length;
    await act(async () =>
      test.editor.setViewData("An incomplete Profile", false),
    );
    await advance();
    expect(preview.contentEl.querySelector('[role="alert"]')).not.toBeNull();
    expect(preview.contentEl.textContent).toContain("Personal space.");
    // A document the parser refuses reads as a failure, so the preview names
    // the output it kept rather than a wait it is not in.
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_retained(),
    );
    expect(preview.contentEl.textContent).not.toContain(
      m.workbench_preview_stale(),
    );
    expect(
      [...preview.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === m.workbench_problem_show(),
      ),
    ).toBe(true);
    expect(vi.mocked(renderNativeTemplate).mock.calls.length).toBe(calls);

    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "sample:book", title: "Sample book" }),
    );
    await advance();
    // The kept output answers for the paper the reader has left.
    expect(preview.contentEl.textContent).toContain(
      m.workbench_preview_unavailable(),
    );
    expect(preview.contentEl.textContent).not.toContain("Personal space.");

    await act(async () =>
      test.editor.setViewData(
        PROFILE_SOURCE.replace("Personal space.", "Repaired output."),
        false,
      ),
    );
    await advance();
    expect(preview.contentEl.textContent).toContain("Repaired output.");
    expect(preview.contentEl.querySelector('[role="alert"]')).toBeNull();
    expect(preview.contentEl.textContent).not.toContain(
      m.workbench_preview_unavailable(),
    );
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
      (button) => button.textContent === m.workbench_problem_show(),
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
    const showProblem = vi.fn();
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
      showProblem,
      publishPreviewProblems: vi.fn(),
    } as unknown as TemplateWorkbenchView;
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
      (button) => button.textContent === m.workbench_problem_show(),
    )!;
    expect(source.disabled).toBe(true);
    await act(async () => source.click());
    expect(showProblem).not.toHaveBeenCalled();
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

  it("moves preview settings into the pane menu", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    expect(menuItem(preview, m.workbench_preview_as_new_note())).toMatchObject({
      checked: true,
      section: "zotlit-preview",
    });
    expect(
      menuItem(preview, m.workbench_preview_as_updated_note()),
    ).toMatchObject({
      checked: false,
      disabled: true,
      section: "zotlit-preview",
    });
    expect(
      menuItem(preview, m.workbench_preview_updated_section()),
    ).toMatchObject({
      checked: false,
      section: "zotlit-preview",
    });
    expect(menuItem(preview, m.workbench_preview_auto_refresh())).toMatchObject(
      {
        checked: true,
        section: "zotlit-display",
      },
    );
    expect(menuItem(preview, m.workbench_show_markdown())).toMatchObject({
      checked: false,
      section: "zotlit-display",
    });
    const captionText = () =>
      preview.contentEl.querySelector(".zt-note-preview-heading")
        ?.nextElementSibling?.textContent;
    await pick(preview, m.workbench_preview_updated_section());
    expect(
      menuItem(preview, m.workbench_preview_updated_section()).checked,
    ).toBe(true);
    expect(menuItem(preview, m.workbench_preview_as_new_note()).checked).toBe(
      false,
    );
    expect(captionText()).toContain(m.workbench_result_managed_toggle());
    await pick(preview, m.workbench_preview_auto_refresh());
    expect(captionText()).toBe("Updated section only · On demand");
  });

  it("swaps the format action like the reading-view toggle", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    const action = (preview as unknown as MockItemView).actions.find(
      (element) =>
        element.getAttribute("aria-label") === m.workbench_show_markdown(),
    );
    if (!action) throw new Error("Missing format action");
    await act(async () => void action.dispatchEvent(new MouseEvent("click")));
    expect(preview.state.getState().showMarkdown).toBe(true);
    expect(action.getAttribute("aria-label")).toBe(
      m.workbench_show_reading_view(),
    );
  });

  it("swaps the section action between the note and its updated section", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    const preview = await test.open();
    await advance();
    const action = (preview as unknown as MockItemView).actions.find(
      (element) =>
        element.getAttribute("aria-label") ===
        m.workbench_preview_updated_section(),
    );
    if (!action) throw new Error("Missing section action");
    expect(action.dataset["icon"]).toBe("rows-3");
    await act(async () => void action.dispatchEvent(new MouseEvent("click")));
    expect(preview.state.getState().showManaged).toBe(true);
    expect(action.dataset["icon"]).toBe("file-text");
    expect(action.getAttribute("aria-label")).toBe("Preview as new note");
    expect(
      menuItem(preview, m.workbench_preview_updated_section()).checked,
    ).toBe(true);
    await act(async () => void action.dispatchEvent(new MouseEvent("click")));
    expect(preview.state.getState().showManaged).toBe(false);
    expect(action.getAttribute("aria-label")).toBe(
      "Preview updated section only",
    );
  });

  it("hides Updated section only in the annotation result", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await act(async () => test.editor.store.getState().setRoot("annotation"));
    const preview = await test.open();
    await advance();
    const menu = new Menu();
    preview.onPaneMenu(menu as never, "more-options");
    expect(
      menu.items.find(
        (item) => item.title === m.workbench_preview_updated_section(),
      ),
    ).toBeUndefined();
  });

  it("keeps the note result and its section choice on the Properties tab", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    await act(async () =>
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" }),
    );
    await act(async () => test.editor.store.getState().setTab("properties"));
    const preview = await test.open();
    await advance();
    expect(preview.contentEl.querySelector("h2")?.textContent).toBe(
      m.workbench_result_heading(),
    );
    const menu = new Menu();
    preview.onPaneMenu(menu as never, "more-options");
    expect(
      menu.items.find(
        (item) => item.title === m.workbench_preview_updated_section(),
      ),
    ).toBeDefined();
  });
});

describe("the Citation Template preview", () => {
  const CITATION_DOCUMENT = `---
language: liquid
---
{% if zt.variant == "alt" %}
  {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
{% else %}
  {{ zt.citations | pandoc_cite }}
{% endif %}
`;

  async function openCitationPreview(test: Awaited<ReturnType<typeof setup>>) {
    const file = test.fixture.vault.addFile(
      "templates/zotlit-citation.md",
      CITATION_DOCUMENT,
    );
    test.editor.file = file;
    test.editor.setViewData(CITATION_DOCUMENT, true);
    const preview = await test.open();
    await advance();
    return preview;
  }

  const caption = (preview: Preview) =>
    [...preview.contentEl.querySelectorAll("p")].map((p) => p.textContent);

  it("renders the selected example under the checked Citation Variant", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openCitationPreview(test);

    // The default citation text brackets the main gesture and leaves the
    // alternate one author-in-text; the one-item example cites one Sample Item.
    expect(preview.contentEl.textContent).toContain("[@ioannidisWhyMost2005]");
    expect(caption(preview)).toContain(m.workbench_citation_variant_main());
    expect(
      menuItem(preview, m.template_workbench_preview_main_citation()).checked,
    ).toBe(true);

    await pick(preview, m.template_workbench_preview_alt_citation());
    await advance();

    expect(preview.contentEl.textContent).toContain("@ioannidisWhyMost2005");
    expect(preview.contentEl.textContent).not.toContain(
      "[@ioannidisWhyMost2005]",
    );
    expect(caption(preview)).toContain(m.workbench_citation_variant_alt());
    expect(
      menuItem(preview, m.template_workbench_preview_alt_citation()).checked,
    ).toBe(true);
    expect(preview.getState()).toMatchObject({
      kind: "citation",
      variant: "alt",
      citationExample: "one-item",
    });
  });

  it("offers the six example sets and re-renders the chosen one", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openCitationPreview(test);

    const examples = menuItem(preview, m.template_workbench_use_example())
      .submenu!.items;
    expect(examples.map((item) => item.title)).toEqual([
      m.workbench_citation_example_one_item(),
      m.workbench_citation_example_two_items(),
      m.workbench_citation_example_item_with_page(),
      m.workbench_citation_example_suppressed_author(),
      m.workbench_citation_example_prefix_and_suffix(),
      m.workbench_citation_example_annotation_citation(),
    ]);
    expect(examples[0]!.checked).toBe(true);

    await act(async () =>
      examples
        .find(
          (item) => item.title === m.workbench_citation_example_two_items(),
        )!
        .click(),
    );
    await advance();

    expect(preview.contentEl.textContent).toContain(
      "[@ioannidisWhyMost2005; @Kahneman2011]",
    );
    expect(preview.getState()["citationExample"]).toBe("two-items");
  });

  it("hands the Citation set to an Item the reader chooses", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openCitationPreview(test);
    expect(preview.getState()["citationExample"]).toBe("one-item");

    vi.mocked(pickItem).mockResolvedValueOnce({
      item: { indexedKey: "MAIN2345" },
    } as NonNullable<Awaited<ReturnType<typeof pickItem>>>);
    await pick(preview, m.workbench_choose_item());
    await advance();

    // The chosen Item is the set now, so no example stays checked and the
    // caption names the paper rather than an example.
    expect(preview.getState()).toMatchObject({
      item: "MAIN2345",
      citationExample: null,
    });
    expect(
      menuItem(preview, m.template_workbench_use_example()).submenu!.items.some(
        (item) => item.checked,
      ),
    ).toBe(false);
    expect(preview.contentEl.textContent).toContain("@");
  });

  it("leaves the note choices to a Profile document", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openCitationPreview(test);

    const titles = () => {
      const menu = new Menu();
      preview.onPaneMenu(menu as never, "more-options");
      return menu.items.map((item) => item.title);
    };
    expect(titles()).not.toContain(m.workbench_preview_as_new_note());
    expect(titles()).not.toContain(m.workbench_preview_as_updated_note());
    expect(titles()).not.toContain(m.workbench_choose_annotation());
    expect(titles()).toContain(m.workbench_choose_item());
  });
});

describe("a Shared Partial preview", () => {
  // One source that shows which root answered: only the note root carries a
  // title, only the Annotation root a text, and only a Citation set a variant.
  const PARTIAL_DOCUMENT = `---
language: liquid
---
[{{ zt.title }}|{{ zt.text }}|{{ zt.variant }}]
`;

  async function openPartialPreview(
    test: Awaited<ReturnType<typeof setup>>,
    options: { item?: boolean } = {},
  ) {
    const file = test.fixture.vault.addFile(
      "templates/zotlit-partial.authors.md",
      PARTIAL_DOCUMENT,
    );
    test.editor.file = file;
    test.editor.setViewData(PARTIAL_DOCUMENT, true);
    if (options.item !== false)
      test.editor.store
        .getState()
        .setItem({ id: "MAIN2345", title: "Better figures" });
    const preview = await test.open();
    await advance();
    return preview;
  }

  const caption = (preview: Preview) =>
    [...preview.contentEl.querySelectorAll("p")].map((p) => p.textContent);

  it("renders the partial with the selected Item under Note", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openPartialPreview(test);

    expect(preview.contentEl.textContent).toContain("[Better figures||]");
    expect(caption(preview)).toContain(m.workbench_partial_context_note());
    expect(
      menuItem(preview, m.template_workbench_preview_as_note()).checked,
    ).toBe(true);
    expect(preview.getState()).toMatchObject({
      kind: "partial",
      root: "note",
      partialProfile: null,
    });
  });

  it("re-renders under the Annotation root and moves the editor with it", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openPartialPreview(test);

    await pick(preview, m.template_workbench_preview_as_annotation());
    await advance();

    expect(preview.contentEl.textContent).toContain(
      "[|Use readable figures.|]",
    );
    expect(caption(preview)).toContain(
      m.workbench_partial_context_annotation(),
    );
    expect(
      menuItem(preview, m.template_workbench_preview_as_annotation()).checked,
    ).toBe(true);
    // The editor and every companion that follows it read the one choice.
    expect(test.editor.store.getState().root).toBe("annotation");
    expect(test.editor.controller.templateRegions[0]!.root).toBe("annotation");
    expect(preview.getState()["root"]).toBe("annotation");
  });

  it("re-renders under the Citation set the reader chose", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openPartialPreview(test);

    await pick(preview, m.template_workbench_preview_as_citation());
    await advance();

    expect(preview.contentEl.textContent).toContain("[||main]");
    expect(test.editor.store.getState().root).toBe("citation");
    // A partial read as called from a Citation takes the Citation Template's
    // own two choices, so both reach its menu.
    expect(
      menuItem(preview, m.template_workbench_preview_alt_citation()),
    ).toBeDefined();
    await pick(preview, m.template_workbench_preview_alt_citation());
    await advance();
    expect(preview.contentEl.textContent).toContain("[||alt]");
  });

  it("leaves the Profile unasked where the vault holds one", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const preview = await openPartialPreview(test);
    const menu = new Menu();
    preview.onPaneMenu(menu as never, "more-options");

    expect(menu.items.map((item) => item.title)).not.toContain(
      m.template_workbench_use_profile(),
    );
  });

  // `ProfileService.profiles` holds the custom Profiles alone, so one entry
  // already means the vault holds two Profiles: the default one and this.
  it("offers a Profile choice where the vault holds the default and one more", async () => {
    await using test = await setup({
      ...NO_PROFILES,
      profiles: [
        { id: "reading12345", label: "Reading" },
      ] as unknown as PreviewViewDeps["profile"]["profiles"],
    });
    vi.useFakeTimers();
    const preview = await openPartialPreview(test);
    const choice = menuItem(preview, m.template_workbench_use_profile());
    expect(choice.submenu!.items.map((item) => item.title)).toEqual([
      m.settings_profile_default_name(),
      "Reading",
    ]);
    expect(choice.submenu!.items[0]!.checked).toBe(true);

    await act(async () => choice.submenu!.items[1]!.click());
    expect(preview.getState()["partialProfile"]).toBe("reading12345");
    expect(test.editor.authoringContext.partial).toMatchObject({
      profile: "reading12345",
    });
  });

  it("restores the caller a reopened partial was left on", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
      (_app, listener) => {
        listener(null);
        return () => {};
      },
    );
    test.fixture.vault.addFile(
      "templates/zotlit-partial.authors.md",
      PARTIAL_DOCUMENT,
    );
    const preview = await test.open({
      source: { path: "templates/zotlit-partial.authors.md" },
      kind: "partial",
      root: "annotation",
      item: "MAIN2345",
      partialProfile: null,
    });
    await advance();

    expect(preview.getState()).toMatchObject({
      kind: "partial",
      root: "annotation",
    });
    expect(preview.contentEl.textContent).toContain(
      "[|Use readable figures.|]",
    );
  });

  it("re-renders an open Profile preview when a partial it calls is saved", async () => {
    await using test = await setup();
    vi.useFakeTimers();
    const partial = test.fixture.vault.createFile(
      "templates/zotlit-partial.authors.md",
      "Alpha",
    );
    // The folder watcher debounces; the registry answers once it has settled.
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    const calling = PROFILE_SOURCE.replace(
      "Personal space.",
      `Personal space. {% render 'authors' %}`,
    );
    test.editor.setViewData(calling, true);
    const preview = await test.open();
    test.editor.store
      .getState()
      .setItem({ id: "MAIN2345", title: "Better figures" });
    await advance();
    expect(preview.contentEl.textContent).toContain("Alpha");

    test.fixture.vault.modifyFile(partial.path, "Beta");
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    await advance();

    expect(preview.contentEl.textContent).toContain("Beta");
    expect(preview.contentEl.textContent).not.toContain("Alpha");
  });
});
