import { forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import {
  Menu,
  resetMockPlatform,
  setMockPlatform,
  TextFileView as MockTextFileView,
} from "@mock/obsidian";
import type {
  ItemView as MockItemView,
  MenuItem,
  Scope as MockScope,
} from "@mock/obsidian";
import { Cause, Effect, Exit } from "effect";
import { Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { SuggestModal, TFile } from "obsidian";
import type { App, Scope, ViewState, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatPlainTemplateDocument,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  captureRenderReport,
  emptyRender,
  formatRenderReport,
  renderIdentity,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import { fieldForm } from "@zotlit/workbench/ui";

import { answerConfirmation } from "@/lib/__fixtures__/confirm";
import { dispatchKey, keymapApp } from "@/lib/__fixtures__/keymap";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import { VaultError } from "@/lib/vault-errors";
import { bindProfile } from "@/services/profile/bindings";
import { defaults } from "@/services/settings/schema";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import {
  inProcessReadsService,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";
import { createRenderFixture } from "@/views/template-workbench/preview/__fixtures__/render";

import {
  chooseSample,
  makeWorkbenchHost,
  renderState,
  runRender,
  setViewItem,
  viewState,
} from "./__fixtures__";
import type { WorkbenchHostDeps as TemplateWorkbenchDeps } from "./__fixtures__";
import { createSharedPartialEffect } from "./partial-command";
import { SAMPLE_ITEM_CHOICES } from "./selection-data";
import { windowMigration } from "./test-window-migration";
import {
  TemplateWorkbenchView,
  originatingNoteUpdateNotice,
  unpackedPartialNotices,
} from "./view";

/**
 * Every entry of `menu` and of the submenus under it, each before its own
 * submenu's, as a reader meets them by opening each submenu in turn.
 */
const menuEntries = (menu: Menu | null): MenuItem[] =>
  (menu?.items ?? []).flatMap((item) => [item, ...menuEntries(item.submenu)]);

/** Inserts `node` as the Fields Panel does: in its first form, as the place the caret is in reads it. */
const insertNode = (view: TemplateWorkbenchView, node: DisplayNode) =>
  view.insertField(fieldForm(node, view.fieldInsertion()).snippet);

// The real leaf edges stand in: the layout module imports this view.
vi.mock("./layout", () => ({
  setLeafState: (leaf: WorkspaceLeaf, state: ViewState) =>
    Effect.tryPromise(() => leaf.setViewState(state)),
  WORKBENCH_WINDOW: { width: 1440, height: 900 },
  openWorkbenchLayout: vi.fn(() => Effect.void),
}));

// The create flow is #1046's own, driven end to end by new-partial.test.ts.
// Here it stands in, so a right-click reports the source and the language it
// was handed and the extraction's own edit is what the assertions read.
vi.mock("./partial-command", () => ({
  createSharedPartialEffect: vi.fn(() => Effect.succeed(null)),
}));

// The renderers are the Preview panel's own; here they stand in, so a render reports
// which document kind the view asked for and what the session fed it.
vi.mock("@/views/template-workbench/preview/render", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/views/template-workbench/preview/render")
    >();
  const { failedRender, renderIdentity } =
    await import("@zotlit/workbench/render");
  return {
    ...actual,
    makeNativeRenderer: (
      deps: Parameters<typeof actual.makeNativeRenderer>[0],
    ) => ({
      ...actual.makeNativeRenderer(deps),
      render: (request: import("@zotlit/workbench/render").RenderRequest) =>
        Effect.succeed(
          actual.nativeResult(
            failedRender(renderIdentity(request), { code: "render-error" }),
          ),
        ),
    }),
  };
});

const SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
---
A stable note.
--- zotlit:annotation ---
An annotation.
`;

/** Run a view flow to its end, as a launch or a button does. */
const run = <A, E>(flow: Effect.Effect<A, E>) => Effect.runPromise(flow);

class TestTemplateWorkbenchView extends TemplateWorkbenchView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

/** One device-local store behind every view a test opens, as Obsidian's is. */
const deviceStorage = new Map<string, unknown>();
beforeEach(() => deviceStorage.clear());

const localStorageStub = {
  loadLocalStorage: (key: string) => deviceStorage.get(key) ?? null,
  saveLocalStorage: (key: string, value: unknown) => {
    deviceStorage.set(key, value);
  },
};

function setup(
  deps: Partial<TemplateWorkbenchDeps> = { runtime: testRuntime() },
  sharedApp?: App,
) {
  const setActiveLeaf = vi.fn();
  const modify = vi.fn<(file: TFile, source: string) => Promise<void>>(
    async () => {},
  );
  const requestSaveLayout: App["workspace"]["requestSaveLayout"] =
    Object.assign(
      vi.fn(() => requestSaveLayout),
      {
        cancel: () => requestSaveLayout,
        run: () => undefined,
      },
    );
  const app =
    sharedApp ??
    stubService<App>("App", {
      // The Fields popover holds a Scope on the keymap while it stands.
      ...keymapApp(),
      workspace: stubService<App["workspace"]>("Workspace", {
        requestSaveLayout,
        trigger: vi.fn(),
        on: vi.fn(() => ({})),
        offref: vi.fn(),
        iterateAllLeaves: vi.fn(),
        revealLeaf: vi.fn(async () => {}),
        setActiveLeaf,
        getActiveFile: () => null,
      }),
      ...localStorageStub,
      vault: stubService<App["vault"]>("Vault", { modify }),
    });
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    setViewState: vi.fn(async () => {}),
    updateHeader: vi.fn(),
  });
  Object.defineProperty(leaf, "app", { value: app });
  const host = makeWorkbenchHost({
    app,
    ...stubService<TemplateWorkbenchDeps>("TemplateWorkbenchDeps", {
      settings: stubService<TemplateWorkbenchDeps["settings"]>(
        "PluginSettings",
        {
          current: Effect.succeed(defaults),
          changes: Stream.empty,
        },
      ),
      bridge: stubService<TemplateWorkbenchDeps["bridge"]>("EffectBridge", {
        runSync: Effect.runSync,
      }),
      pluginVersion: "2.1.3",
      noteFeature: undefined,
      query: undefined,
      nativePreview: undefined,
      render: undefined,
      profile: undefined,
      zoteroReads: stubService<TemplateWorkbenchDeps["zoteroReads"]>(
        "ZoteroReads",
        { state: "ready" },
      ),
      zoteroPref: stubService<TemplateWorkbenchDeps["zoteroPref"]>(
        "ZoteroPref",
        {
          dataDir: "/Zotero",
        },
      ),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        loaded: true,
        "compile-status-changed": Stream.empty,
        getPartialNames: () => [],
        getPartialDocuments: () => [],
      }),
      ...deps,
    }),
  });
  const view = new TestTemplateWorkbenchView(leaf, host.deps);
  host.own(() => view.close());
  leaf.view = view;
  const requestSave = vi.fn();
  view.requestSave = requestSave;
  view.setViewData(SOURCE, true);
  return { view, requestSave, leaf, setActiveLeaf, modify, app };
}

describe("TemplateWorkbenchView", () => {
  async function originHarness() {
    const updateNote = vi.fn<
      NonNullable<TemplateWorkbenchDeps["noteFeature"]>["updateNote"]
    >(async () => ({
      bodyUpdated: true,
      duplicateRegionCount: 0,
    }));
    const waitUntilSettled = vi.fn(async () => "settled" as const);
    const profileOf = vi.fn<
      NonNullable<NonNullable<TemplateWorkbenchDeps["profile"]>["profileOf"]>
    >(() =>
      Effect.succeed({
        ok: true,
        profile: bindProfile(defaults, { selector: "default" }),
      }),
    );
    const h = setup({
      runtime: testRuntime(),
      noteFeature: stubService<
        NonNullable<TemplateWorkbenchDeps["noteFeature"]>
      >("NoteFeatureHandle", { updateNote }),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          profileOf,
        },
      ),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        waitUntilSettled,
        loaded: true,
        "compile-status-changed": Stream.empty,
      }),
    });
    const file = Object.assign(new TFile(), {
      path: "Literature/Original.md",
      basename: "Original",
    });
    const template = Object.assign(new TFile(), {
      path: "templates/paper.md",
      basename: "paper",
    });
    const getFileByPath = vi.fn(() => file);
    const getFileCache = vi.fn(() => ({
      frontmatter: { "zotero-key": "AAAAAAAA" },
    }));
    const read = vi.fn(async () => h.view.getViewData());
    Object.assign(h.app.vault, { getFileByPath, read });
    Object.assign(h.app, { metadataCache: { getFileCache } });
    h.view.file = template;
    await run(h.view.setOriginatingNote(file));
    return {
      ...h,
      file,
      template,
      updateNote,
      waitUntilSettled,
      getFileByPath,
      getFileCache,
      read,
      profileOf,
    };
  }

  // Ticket 04's review: a launch whose Profile read finishes last replaced
  // the note a later launch had set.
  it("keeps the later launch's note when an earlier Profile read finishes last", async () => {
    const h = await originHarness();
    const earlierRead = Promise.withResolvers<void>();
    h.profileOf.mockImplementationOnce(() =>
      Effect.promise(() => earlierRead.promise).pipe(
        Effect.as({
          ok: true as const,
          profile: bindProfile(defaults, { selector: "default" }),
        }),
      ),
    );
    const later = Object.assign(new TFile(), {
      path: "Literature/Later.md",
      basename: "Later",
    });
    const earlier = run(h.view.setOriginatingNote(h.file));
    await vi.waitFor(() => expect(h.profileOf).toHaveBeenCalledTimes(2));
    await run(h.view.setOriginatingNote(later));
    expect(h.view.originatingNote).toBe(later);
    earlierRead.resolve();
    expect(await earlier).toBeNull();
    expect(h.view.originatingNote).toBe(later);
  });

  it("updates the originating note after saving, independent of focus and preview selection", async () => {
    const h = await originHarness();
    const saved = Promise.withResolvers<void>();
    using save = vi
      .spyOn(MockTextFileView.prototype, "save")
      .mockReturnValue(saved.promise);
    const other = Object.assign(new TFile(), { path: "Other.md" });
    using _activeFile = vi
      .spyOn(h.app.workspace, "getActiveFile")
      .mockReturnValue(other);
    setViewItem(h.view, { id: "BBBBBBBB", title: "Other paper" });
    const updating = run(h.view.updateOriginatingNote());
    // A second press while the update runs joins it.
    const again = run(h.view.updateOriginatingNote());
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(h.view.registry.get(h.view.model.updating)).toBe(true);
    expect(h.updateNote).not.toHaveBeenCalled();
    saved.resolve();
    expect(await again).toBe(await updating);
    expect(h.view.registry.get(h.view.model.updating)).toBe(false);
    expect(await updating).toMatchObject({
      outcome: "updated",
      name: "Original",
      result: { bodyUpdated: true },
    });
    expect(h.updateNote).toHaveBeenCalledExactlyOnceWith(h.file, {
      indexedKey: "AAAAAAAA",
      scope: "full",
      profile: "default",
      beforeWrite: expect.any(Function),
    });
  });

  it("waits for an automatic save already in progress before applying the latest edit", async () => {
    const h = await originHarness();
    const pending = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    using save = vi
      .spyOn(MockTextFileView.prototype, "save")
      .mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
    const automatic = h.view.save();
    await started.promise;
    const updating = run(h.view.updateOriginatingNote());
    expect(h.updateNote).not.toHaveBeenCalled();
    pending.resolve();
    await automatic;
    await updating;
    expect(save).toHaveBeenCalledTimes(2);
    expect(h.updateNote).toHaveBeenCalledOnce();
  });

  it.each(["rejected", "not-written"])(
    "reports a %s save without updating the note",
    async (failure) => {
      const h = await originHarness();
      using save = vi.spyOn(MockTextFileView.prototype, "save");
      if (failure === "rejected")
        save.mockRejectedValue(new Error("disk full"));
      else h.read.mockResolvedValue("previously saved template");
      expect(await run(h.view.updateOriginatingNote())).toEqual({
        outcome: "save-failed",
        name: "Original",
      });
      expect(h.updateNote).not.toHaveBeenCalled();
    },
  );

  it.each(["deleted", "replaced"])(
    "refuses an origin that is %s while the template compiles",
    async (change) => {
      const h = await originHarness();
      const compilation = Promise.withResolvers<"settled">();
      h.waitUntilSettled.mockReturnValue(compilation.promise);
      const updating = run(h.view.updateOriginatingNote());
      await vi.waitFor(() => expect(h.waitUntilSettled).toHaveBeenCalledOnce());
      h.getFileByPath.mockReturnValue(
        change === "deleted"
          ? null!
          : Object.assign(new TFile(), { path: h.file.path }),
      );
      compilation.resolve("settled");
      expect(await updating).toEqual({
        outcome: "unavailable",
        name: "Original",
      });
      expect(h.updateNote).not.toHaveBeenCalled();
    },
  );

  it("names a successful metadata-only result and retains update failures", async () => {
    const h = await originHarness();
    h.updateNote.mockResolvedValueOnce({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      noManagedBlock: true,
    });
    const result = await run(h.view.updateOriginatingNote());
    expect(result).toMatchObject({
      outcome: "updated",
      name: "Original",
      result: { bodyUpdated: false, noManagedBlock: true },
    });
    expect(originatingNoteUpdateNotice(h.app, result)).toContain("Original");
    expect(originatingNoteUpdateNotice(h.app, result)).toContain(
      m.notice_updated_note_no_managed_block(),
    );
    const error = new Error("write failed");
    h.updateNote.mockRejectedValueOnce(error);
    await expect(run(h.view.updateOriginatingNote())).rejects.toMatchObject({
      _tag: "OriginatingNoteUpdateError",
      note: "Original",
      cause: error,
    });
  });

  // #1819: closing the leaf stops a waiting update quietly, before the write.
  it("stops quietly when the leaf closes before the note's write", async () => {
    const h = await originHarness();
    const waiting = Promise.withResolvers<"settled">();
    h.waitUntilSettled.mockReturnValueOnce(waiting.promise);
    const stopping = Effect.runPromiseExit(h.view.updateOriginatingNote());
    await vi.waitFor(() => expect(h.waitUntilSettled).toHaveBeenCalledOnce());
    await h.view.close();
    const exit = await stopping;
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(h.view.registry.get(h.view.model.updating)).toBe(false);
    expect(h.updateNote).not.toHaveBeenCalled();
  });

  it("waits for the note's write when the leaf closes during it", async () => {
    const h = await originHarness();
    const write = Promise.withResolvers<{
      bodyUpdated: boolean;
      duplicateRegionCount: number;
    }>();
    h.updateNote.mockReturnValueOnce(write.promise);
    const updating = Effect.runPromiseExit(h.view.updateOriginatingNote());
    await vi.waitFor(() => expect(h.updateNote).toHaveBeenCalledOnce());
    let closed = false;
    const closing = h.view.close().then(() => {
      closed = true;
    });
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(closed).toBe(false);
    write.resolve({ bodyUpdated: true, duplicateRegionCount: 0 });
    await closing;
    await updating;
  });

  it("waits for the template's save when the leaf closes during it", async () => {
    const h = await originHarness();
    const saved = Promise.withResolvers<void>();
    using save = vi
      .spyOn(MockTextFileView.prototype, "save")
      .mockReturnValueOnce(saved.promise);
    const updating = Effect.runPromiseExit(h.view.updateOriginatingNote());
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    let closed = false;
    const closing = h.view.close().then(() => {
      closed = true;
    });
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(closed).toBe(false);
    saved.resolve();
    await closing;
    // The save finished; the update stopped after it, before the note.
    expect(Exit.isSuccess(await updating)).toBe(false);
    expect(h.updateNote).not.toHaveBeenCalled();
  });

  it("keeps the existing template diagnostic on a refused update", async () => {
    const h = await originHarness();
    const result = {
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "missing-literature-note-template" as const,
        document: "missing.md",
        hint: "Restore the template",
      },
    };
    h.updateNote.mockResolvedValueOnce(result);
    const outcome = await run(h.view.updateOriginatingNote());
    expect(outcome).toEqual({ outcome: "refused", name: "Original", result });
    expect(originatingNoteUpdateNotice(h.app, outcome)).toBe(
      m.notice_literature_note_template_missing({ document: "missing.md" }),
    );
  });

  it("rejects an edit saved during the final disk read after compilation settled", async () => {
    const h = await originHarness();
    h.read
      .mockImplementationOnce(async () => h.view.getViewData())
      .mockImplementationOnce(async () => {
        h.view.controller.setManifestKey("name", "New edit");
        return h.view.getViewData();
      });
    expect(await run(h.view.updateOriginatingNote())).toEqual({
      outcome: "not-ready",
      name: "Original",
    });
    expect(h.updateNote).not.toHaveBeenCalled();
  });

  it("guards the originating target when the note operation reaches its write boundary", async () => {
    const h = await originHarness();
    h.updateNote.mockImplementationOnce(async (_file, options) => {
      h.getFileByPath.mockReturnValue(
        Object.assign(new TFile(), { path: h.file.path }),
      );
      options.beforeWrite?.();
      return { bodyUpdated: true, duplicateRegionCount: 0 };
    });
    expect(await run(h.view.updateOriginatingNote())).toEqual({
      outcome: "unavailable",
      name: "Original",
    });
  });

  it("sends the user back to Customize when the note's Zotero key changed", async () => {
    const h = await originHarness();
    h.updateNote.mockResolvedValueOnce({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "literature-note-key-changed",
        hint: "",
        indexedKey: "AAAAAAAA",
        path: h.file.path,
      },
    });
    const outcome = await run(h.view.updateOriginatingNote());
    expect(outcome).toEqual({ outcome: "unavailable", name: "Original" });
    expect(originatingNoteUpdateNotice(h.app, outcome)).toBe(
      m.template_workbench_update_unavailable({ name: "Original" }),
    );
  });

  it("updates while the note's metadata cache has not parsed its latest write", async () => {
    const h = await originHarness();
    h.updateNote.mockImplementationOnce(async (_file, options) => {
      h.getFileCache.mockReturnValue(null as never);
      options.beforeWrite?.();
      return { bodyUpdated: true, duplicateRegionCount: 0 };
    });
    expect(await run(h.view.updateOriginatingNote())).toMatchObject({
      outcome: "updated",
      name: "Original",
    });
  });

  it("names a launch note this editor cannot update", async () => {
    const h = await originHarness();
    h.getFileCache.mockReturnValue(null as never);
    expect(await run(h.view.setOriginatingNote(h.file))).toBe("Original");
    expect(h.view.originatingNote).toBeNull();
  });

  it("clears the action when the editor is opened without an originating note", async () => {
    const h = await originHarness();
    await run(h.view.setOriginatingNote(null));
    await run(h.view.updateOriginatingNote());
    expect(h.view.originatingNote).toBeNull();
    expect(h.updateNote).not.toHaveBeenCalled();
  });

  it("clears an arrival after a fresh matching success and retains its report", async () => {
    await using cleanup = new AsyncDisposableStack();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    cleanup.defer(() => copy.mockRestore());
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          creationBody: "Repaired note",
        }),
    });
    const file = new TFile();
    file.path = "templates/paper.md";
    view.file = file;
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () =>
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false }),
    );
    const run = async () => {
      const attempt = renderState(view).attempt;
      await act(async () => {
        runRender(view);
        await vi.waitFor(() =>
          expect(renderState(view).attempt).toBeGreaterThan(attempt),
        );
      });
    };
    await run();
    const diagnostic = {
      code: "missing-partial" as const,
      params: { name: "venue-line" },
      part: "render" as const,
    };
    const report = captureRenderReport({
      diagnostic,
      identity: {
        sourceRevision: "",
        snapshotRevision: SAMPLE_ITEMS[0]!.revision,
      },
      trigger: "explicit",
      sequence: 0,
      capturedAt: "2026-09-13T00:00:00Z",
      context: { document: file.path },
    });
    await act(async () =>
      view.explainArrival({ diagnostic: { ...diagnostic, report } }),
    );
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_object_partial({ name: "venue-line" }),
    );
    // A result from before arrival does not prove a repair.
    expect(view.contentEl.textContent).not.toContain(
      m.workbench_problems_none(),
    );
    await act(async () => chooseSample(view, SAMPLE_ITEMS[1]!));
    await run();
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_object_partial({ name: "venue-line" }),
    );
    await act(async () => chooseSample(view, SAMPLE_ITEMS[0]!));
    await run();
    expect(view.contentEl.textContent).toContain(m.workbench_problems_none());
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_copy_last(),
    );
    const copyLast = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === m.workbench_problems_copy_last(),
    )!;
    await act(async () => copyLast.click());
    expect(copy).toHaveBeenCalledExactlyOnceWith(formatRenderReport(report));
  });

  it("clears a repaired Annotation arrival while a Property failure remains", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          annotation: "Repaired annotation",
          diagnostics: [
            {
              code: "property-error",
              part: "properties",
              params: { key: "title" },
              position: 1,
            },
          ],
        }),
    });
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => {
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false });
      view.explainArrival({
        diagnostic: {
          code: "render-error",
          part: "annotation",
          message: "Old format failure",
        },
      });
    });
    const attempt = renderState(view).attempt;
    await act(async () => {
      runRender(view);
      await vi.waitFor(() =>
        expect(renderState(view).attempt).toBeGreaterThan(attempt),
      );
    });
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_resolved(),
    );
    const next = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === m.workbench_problems_next(),
    )!;
    await act(async () => next.click());
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_object_property({ key: "title" }),
    );
  });

  it("keeps a Note arrival when its render_annotation call still prevents note output", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          diagnostics: [{ code: "render-error", part: "annotation" }],
        }),
    });
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => {
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false });
      view.explainArrival({
        diagnostic: {
          code: "missing-partial",
          part: "render",
          params: { name: "venue-line" },
        },
      });
    });
    const attempt = renderState(view).attempt;
    await act(async () => {
      runRender(view);
      await vi.waitFor(() =>
        expect(renderState(view).attempt).toBeGreaterThan(attempt),
      );
    });
    expect(view.contentEl.textContent).not.toContain(
      m.workbench_problems_resolved(),
    );
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_object_partial({ name: "venue-line" }),
    );
  });

  it("shows only Markdown marker hints alongside Liquid tokens", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    view.setViewData(
      SOURCE.replace(
        "A stable note.",
        "# Heading {{ zt.title }}\n> Quote\n- List\n`{{ zt.title }}`\n```\n{{ zt.title }}\n```",
      ),
      true,
    );
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    await act(() => {
      expect(forceParsing(editor, editor.state.doc.length, 1_000)).toBe(true);
    });
    const tokens = (hook: string) =>
      [...view.contentEl.querySelectorAll(`.${hook}`)].map(
        (node) => node.textContent,
      );
    expect(tokens("zt-template-markdown-marker")).toEqual(["#", ">", "-"]);
    expect(tokens("zt-template-markdown-list-marker")).toEqual(["-"]);
    expect(tokens("zt-template-property")).toEqual(["title", "title", "title"]);
  });

  it.each(["liquid", "eta"])(
    "uses %s in Annotation, filename, and Advanced",
    async (engine) => {
      await using cleanup = new AsyncDisposableStack();
      const { view } = setup();
      const tag =
        engine === "eta" ? "<%= zt.title %>" : "{{ zt.title | downcase }}";
      view.setViewData(
        SOURCE.replace("language: liquid", `language: ${engine}`)
          .replace("filename: paper", `filename: '${tag}'`)
          .replace("An annotation.", `# ${tag}`),
        true,
      );
      cleanup.defer(() => act(async () => view.close()));
      await act(async () => view.open());
      const tokens = (hook: string) =>
        [
          ...(
            view.contentEl.querySelector(
              '[data-workbench-mode="source"]:not([hidden]), [role="tabpanel"]:not([hidden])',
            ) ?? view.contentEl
          ).querySelectorAll(`.${hook}`),
        ].map((node) => node.textContent);
      for (const tab of ["annotation", "name"] as const) {
        await act(async () => view.change.setTab(tab));
        expect(tokens("zt-template-delimiter")).toEqual(
          engine === "eta" ? ["<%=", "%>"] : ["{{", "}}"],
        );
      }
      await act(async () => view.change.setAdvanced(true));
      expect(tokens("zt-template-frontmatter")).toContain("id: paper");
      expect(tokens("zt-template-yaml-key")).toEqual([]);
      expect(tokens("zt-template-delimiter")).toEqual(
        engine === "eta"
          ? ["<%=", "%>", "<%=", "%>"]
          : ["{{", "}}", "{{", "}}"],
      );
      expect(tokens("zt-template-markdown-marker")).toEqual(["#"]);
    },
  );

  it("mounts Note and Annotation editors once as they are visited", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const note = view.contentEl.querySelector<HTMLElement>(".cm-editor")!;
    expect(view.contentEl.querySelectorAll(".cm-editor")).toHaveLength(1);

    await act(async () => view.change.setTab("annotation"));
    const editors = view.contentEl.querySelectorAll<HTMLElement>(".cm-editor");
    expect(editors).toHaveLength(2);
    expect([...editors]).toContain(note);
    const annotation = editors[1]!;

    await act(async () => view.change.setTab("note"));
    expect([...view.contentEl.querySelectorAll(".cm-editor")]).toEqual([
      note,
      annotation,
    ]);
  });

  it("retains visited Basic editors when switching through Source", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const note = view.contentEl.querySelector<HTMLElement>(".cm-editor")!;
    await act(async () => view.change.setTab("annotation"));
    const annotation =
      view.contentEl.querySelectorAll<HTMLElement>(".cm-editor")[1]!;

    await act(async () => view.change.setAdvanced(true));
    const source = view.contentEl.querySelector<HTMLElement>(
      '[data-workbench-mode="source"] .cm-editor',
    )!;
    const sourcePanel = source.closest<HTMLElement>("[data-workbench-mode]")!;
    const annotationPanel =
      annotation.closest<HTMLElement>('[role="tabpanel"]')!;
    expect(sourcePanel.hidden).toBe(false);
    expect(annotationPanel.hidden).toBe(true);
    await act(async () => view.change.setAdvanced(false));

    expect(view.contentEl.contains(note)).toBe(true);
    expect(view.contentEl.contains(annotation)).toBe(true);
    expect(view.contentEl.contains(source)).toBe(true);
    expect(sourcePanel.hidden).toBe(true);
    expect(annotationPanel.hidden).toBe(false);

    await act(async () => view.change.setAdvanced(true));
    expect(
      view.contentEl.querySelector('[data-workbench-mode="source"] .cm-editor'),
    ).toBe(source);
  });

  it("retains the Name and Properties editors across tab switches", async () => {
    await using cleanup = new AsyncDisposableStack();
    const source = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
---
A stable note.
--- zotlit:annotation ---
An annotation.
`;
    const { view } = setup();
    view.setViewData(source, true);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    const filename = () =>
      view.contentEl.querySelector<HTMLElement>(
        '[data-part="filename-editor"] .cm-editor',
      )!;
    await act(async () => view.change.setTab("name"));
    const name = filename();
    expect(name).not.toBeNull();
    await act(async () => view.change.setTab("note"));
    await act(async () => view.change.setTab("name"));
    expect(filename()).toBe(name);

    const expression = () =>
      view.contentEl.querySelector<HTMLElement>(
        '[data-part="expression"] .cm-editor',
      )!;
    await act(async () => view.change.setTab("properties"));
    await act(async () =>
      view.setPresentation({ selected: 1, reveal: null, fieldFocus: null }),
    );
    const expr = expression();
    expect(expr).not.toBeNull();
    await act(async () => view.change.setTab("note"));
    await act(async () => view.change.setTab("properties"));
    expect(expression()).toBe(expr);
  });

  it("keeps Eta wrapping and undo when switching to Advanced", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    const source = SOURCE.replace("language: liquid", "language: eta").replace(
      "A stable note.",
      "title",
    );
    view.setViewData(source, true);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    await act(async () => {
      editor.dispatch({ selection: { anchor: 0, head: 5 } });
      for (const text of ["<", "%"]) {
        const { from, to } = editor.state.selection.main;
        const insert = () =>
          editor.state.update({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: "input.type",
          });
        if (
          !editor.state
            .facet(EditorView.inputHandler)
            .some((handler) => handler(editor, from, to, text, insert))
        )
          editor.dispatch(insert());
      }
    });
    expect(view.getViewData()).toContain("<% title %>");
    expect(editor.state.selection.main.from).toBe(3);
    expect(editor.state.selection.main.to).toBe(8);
    await act(async () => view.change.setAdvanced(true));
    await act(async () => {
      view.controller.undo();
    });
    expect(view.getViewData()).toBe(source);
  });

  it("keeps Liquid colors in a multiline YAML filename", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    view.setViewData(
      SOURCE.replace(
        "filename: paper",
        "filename: |\n  prefix {{ zt.title\n  | downcase }} suffix",
      ),
      true,
    );
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => view.change.setAdvanced(true));
    expect(
      [...view.contentEl.querySelectorAll(".zt-template-delimiter")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["{{", "}}"]);
    expect(
      view.contentEl.querySelector(".zt-template-filter")?.textContent,
    ).toBe("downcase");
  });

  it("selects basic Eta highlighting in the mounted Note pane", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    view.setViewData(
      SOURCE.replace("language: liquid", "language: eta").replace(
        "A stable note.",
        "<%= zt.title %>",
      ),
      true,
    );
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const tokens = (hook: string) =>
      [...view.contentEl.querySelectorAll(`.${hook}`)].map(
        (node) => node.textContent,
      );
    expect(tokens("zt-template-delimiter")).toEqual(["<%=", "%>"]);
    expect(tokens("zt-template-property")).toEqual([]);
  });

  it("updates the CodeMirror root after a native window move and keeps its document history", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    const frame = cleanup.adopt(document.createElement("iframe"), (element) =>
      element.remove(),
    );
    cleanup.defer(() => act(async () => view.close()));
    document.body.append(frame);
    document.body.append(view.contentEl);
    await act(async () => view.open());
    const controller = view.controller;
    await act(async () => {
      controller.setManifestKey("name", "Moved paper");
    });
    const element = view.contentEl.querySelector<HTMLElement>(".cm-editor")!;
    const editor = EditorView.findFromDOM(element)!;
    frame.contentDocument!.body.append(view.contentEl);
    view.onResize();
    expect(editor.root).toBe(frame.contentDocument);
    expect(view.controller).toBe(controller);
    expect(view.getViewData()).toContain("name: Moved paper");
    await act(async () => {
      controller.undo();
    });
    expect(view.getViewData()).toBe(SOURCE);
  });

  it("keeps a file-known Default disabled when opened with invalid source", async () => {
    await using cleanup = new AsyncDisposableStack();
    const path = "templates/zotlit-profile.default.md";
    const { view } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(path),
        },
      ),
    });
    const file = new TFile();
    file.path = path;
    view.file = file;
    view.setViewData("---\nid: [", true);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => view.change.setTab("match"));
    expect(viewState(view).tab).toBe("note");
    const match = [
      ...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === m.workbench_tab_match())!;
    expect(match.disabled).toBe(true);
    await act(async () => view.change.setTab("name"));
    expect(
      [...view.contentEl.querySelectorAll("button")].some(
        (button) => button.textContent === m.workbench_open_settings(),
      ),
    ).toBe(false);
  });

  it("keeps native view actions in sync across edits and document replacement", async () => {
    const { view } = setup();
    await act(async () => view.open());
    const action = (title: string) =>
      (view as unknown as MockItemView).actions.find(
        (element) => element.getAttribute("aria-label") === title,
      )!;
    const undo = action("Undo");
    const redo = action("Redo");
    const source = action("Source");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      view.controller.setManifestKey("name", "Edited");
    });
    expect(undo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => undo.click());
    expect(view.getViewData()).toBe(SOURCE);
    expect(redo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => redo.click());
    expect(view.getViewData()).toContain("name: Edited");
    await act(async () => source.click());
    expect(viewState(view).advanced).toBe(true);
    expect(source.getAttribute("aria-pressed")).toBe("true");
    await act(async () => view.setViewData(SOURCE, true));
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      view.controller.setManifestKey("name", "Second");
    });
    expect(undo.getAttribute("aria-disabled")).toBe("false");
    await act(async () => undo.click());
    expect(view.getViewData()).toBe(SOURCE);
    await act(async () => view.close());
  });

  it("inspects Default without creation or edits, then binds before native save requests", async () => {
    const file = new TFile();
    file.path = "templates/zotlit-profile.default.md";
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const materializeDefault = vi.fn(() =>
      Effect.promise(() => pending.promise),
    );
    const { view, requestSave } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed(SOURCE),
          getBuiltInSource: Effect.succeed(SOURCE),
          materializeDefault: Effect.suspend(materializeDefault),
        },
      ),
    });
    await view.setState({ defaultDraft: true, file: null }, { history: false });
    const controller = view.controller;
    controller.setManifestKey("name", "Typing attempt");
    expect(controller.undo()).toBe(false);
    expect(controller.redo()).toBe(false);
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).not.toHaveBeenCalled();
    const creating = run(view.customizeDefault());
    expect(view.registry.get(view.model.customization) === "pending").toBe(
      true,
    );
    // A second press while the document is written joins that write.
    const again = run(view.customizeDefault());
    await vi.waitFor(() =>
      expect(materializeDefault).toHaveBeenCalledExactlyOnceWith(),
    );
    controller.setManifestKey("name", "Pending attempt");
    pending.resolve({ file, created: true });
    await creating;
    await again;
    expect(materializeDefault).toHaveBeenCalledOnce();
    expect(view.controller).toBe(controller);
    expect(controller.readOnly).toBe(false);
    expect(requestSave).not.toHaveBeenCalled();
    controller.dispatch({
      changes: {
        from: 0,
        to: controller.source.length,
        insert: "invalid source",
      },
    });
    expect(view.getViewData()).toBe("invalid source");
    expect(requestSave).toHaveBeenCalledOnce();
    controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
    controller.redo();
    expect(view.getViewData()).toBe("invalid source");
    expect(requestSave).toHaveBeenCalledTimes(3);
  });

  it("keeps values readable after creation failure and retries only at Customize", async () => {
    const file = new TFile();
    const materializeDefault = vi
      .fn()
      .mockReturnValueOnce(
        Effect.fail(
          new VaultError({
            operation: "create",
            path: "templates/zotlit-profile.default.md",
            message: "Disk full",
            cause: null,
          }),
        ),
      )
      .mockReturnValue(Effect.succeed({ file, created: true }));
    const { view, requestSave } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed(SOURCE),
          getBuiltInSource: Effect.succeed(SOURCE),
          materializeDefault: Effect.suspend(materializeDefault),
        },
      ),
    });
    await view.setState({ defaultDraft: true }, { history: false });
    await run(view.customizeDefault());
    expect(view.registry.get(view.model.customization) === "failed").toBe(true);
    expect(view.registry.get(view.model.customization) === "pending").toBe(
      false,
    );
    view.controller.setManifestKey("name", "Attempt after failure");
    view.controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).toHaveBeenCalledOnce();
    expect(requestSave).not.toHaveBeenCalled();
    await run(view.customizeDefault());
    expect(view.registry.get(view.model.customization) === "failed").toBe(
      false,
    );
    expect(view.isDefaultDraft).toBe(false);
  });

  it("opens competing Default bytes without adding built-in source to Undo", async () => {
    const file = new TFile();
    const { view, leaf, requestSave, modify } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed(SOURCE),
          getBuiltInSource: Effect.succeed(SOURCE),
          materializeDefault: Effect.succeed({ file, created: false }),
        },
      ),
    });
    const existing = SOURCE.replace("name: Paper", "name: Existing Default");
    vi.spyOn(leaf, "setViewState").mockImplementation(async () => {
      view.setViewData(existing, true);
    });
    await view.setState({ defaultDraft: true }, { history: false });
    await run(view.customizeDefault());
    expect(view.getViewData()).toBe(existing);
    expect(view.controller.undo()).toBe(false);
    expect(requestSave).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
  });

  it("shows read-only source and one inline retry after the Customize action fails", async () => {
    const materializeDefault = vi.fn().mockReturnValue(
      Effect.fail(
        new VaultError({
          operation: "create",
          path: "templates/zotlit-profile.default.md",
          message: "Disk full",
          cause: null,
        }),
      ),
    );
    const { view } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed(SOURCE),
          getBuiltInSource: Effect.succeed(SOURCE),
          materializeDefault: Effect.suspend(materializeDefault),
        },
      ),
    });
    document.body.append(view.contentEl);
    await act(async () => {
      await view.setState({ defaultDraft: true }, { history: false });
      await view.open();
    });
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    );
    expect(editor?.state.readOnly).toBe(true);
    const customize = Array.from(
      view.contentEl.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === m.template_workbench_customize(),
    )!;
    await act(async () => {
      customize.click();
      await vi.waitFor(() =>
        expect(view.registry.get(view.model.customization)).toBe("failed"),
      );
    });
    expect(view.contentEl.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.contentEl.textContent).toContain(
      m.settings_citation_engine_retry(),
    );
    expect(view.getViewData()).toBe(SOURCE);
    expect(materializeDefault).toHaveBeenCalledOnce();
    await act(async () => view.close());
    view.contentEl.remove();
  });

  it("keeps a newly opened Profile when Default creation finishes", async () => {
    const file = new TFile();
    const pending = Promise.withResolvers<{ file: TFile; created: boolean }>();
    const { view, modify } = setup({
      runtime: testRuntime(),
      profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
        "Profile",
        {
          defaultDocumentPath: Effect.succeed(
            "templates/zotlit-profile.default.md",
          ),
          getSource: () => Effect.succeed(SOURCE),
          getBuiltInSource: Effect.succeed(SOURCE),
          materializeDefault: Effect.promise(() => pending.promise),
        },
      ),
    });
    await view.setState({ defaultDraft: true }, { history: false });
    const creating = run(view.customizeDefault());
    await view.setState({ file: "other.md" }, { history: false });
    view.setViewData(SOURCE.replace("name: Paper", "name: Other"), true);
    const controller = view.controller;
    pending.resolve({ file, created: true });
    await creating;
    expect(view.controller).toBe(controller);
    expect(view.getViewData()).toContain("name: Other");
    expect(modify).not.toHaveBeenCalled();
  });
  it("keeps an item selected while an older view restoration is loading", async () => {
    const loaded = Promise.withResolvers<void>();
    using _restore = vi
      .spyOn(MockTextFileView.prototype, "setState")
      .mockImplementationOnce(() => loaded.promise);
    const { view } = setup();
    const restoring = view.setState(
      { itemIndexedKey: null },
      { history: false },
    );
    const choice = SAMPLE_ITEM_CHOICES[0]!;
    expect(await run(view.selectItem(choice))).toBe(true);
    loaded.resolve();
    await restoring;
    expect(viewState(view).item).toMatchObject({ id: choice.id });
  });

  it("keeps authoring and restored state available when the database fails", async () => {
    const { view, requestSave } = setup({
      runtime: testRuntime(),
      zoteroReads: stubService<TemplateWorkbenchDeps["zoteroReads"]>(
        "ZoteroReads",
        {
          state: "degraded",
        },
      ),
    });
    await expect(
      view.setState(
        { itemIndexedKey: "0:ABCDEFGH", advanced: true },
        { history: false },
      ),
    ).resolves.toBeUndefined();
    expect(viewState(view).advanced).toBe(true);
    expect(view.registry.get(view.model.unavailable)).toHaveLength(1);
    view.controller.setManifestKey("name", "Offline edit");
    expect(view.getViewData()).toContain("Offline edit");
    expect(requestSave).toHaveBeenCalledOnce();
  });

  it("clears the unavailable citation styles status after recovery", async () => {
    let failed = true;
    const { view } = setup({
      runtime: testRuntime(),
      zoteroPref: stubService<TemplateWorkbenchDeps["zoteroPref"]>(
        "ZoteroPref",
        {
          get dataDir() {
            if (failed) throw new Error("Unavailable");
            return "";
          },
        },
      ),
    });
    await expect(run(view.refreshStyles())).resolves.toBeUndefined();
    expect(view.registry.get(view.model.unavailable)).toHaveLength(1);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.registry.get(view.model.styles).list).toEqual([]);
    failed = false;
    await run(view.refreshStyles());
    expect(view.registry.get(view.model.unavailable)).toEqual([]);
  });

  it("routes the view shortcut to shared history while leaving text inputs their own shortcut", () => {
    const { view } = setup();
    view.controller.setManifestKey("name", "Local");
    const scope = view.scope as unknown as MockScope;
    const undo = scope.handlers.find(
      (handler) => handler.key === "z" && handler.modifiers?.length === 1,
    )!;
    const input = document.createElement("input");
    const typing = new KeyboardEvent("keydown", { key: "z" });
    input.dispatchEvent(typing);
    expect(undo.func(typing)).toBeUndefined();
    expect(view.controller.canUndo).toBe(true);
    expect(undo.func(new KeyboardEvent("keydown", { key: "z" }))).toBe(false);
    expect(view.getViewData()).toBe(SOURCE);
  });

  it("requests the normal save path for an invalid local edit", () => {
    const { view, requestSave } = setup();
    view.controller.dispatch({
      changes: {
        from: 0,
        to: view.controller.state.doc.length,
        insert: "---\nname: [unfinished",
      },
    });
    expect(requestSave).toHaveBeenCalledOnce();
    expect(view.getViewData()).toBe("---\nname: [unfinished");
    expect(view.controller.document).toBeNull();
  });

  it("reconciles external text once, retains the controller, and does not echo a save", () => {
    const { view, requestSave } = setup();
    const controller = view.controller;
    controller.setManifestKey("name", "Local");
    const local = view.getViewData();
    requestSave.mockClear();
    const update = vi.fn();
    controller.subscribe(update);
    view.setViewData(local.replace("A stable note.", "Agent text."), false);
    expect(view.controller).toBe(controller);
    expect(update).toHaveBeenCalledOnce();
    expect(requestSave).not.toHaveBeenCalled();
    controller.undo();
    expect(view.getViewData()).toBe(local);
    expect(requestSave).toHaveBeenCalledOnce();
    controller.undo();
    expect(view.getViewData()).toBe(SOURCE);
  });

  it.each([
    { tab: "annotation", root: "annotation", advanced: false },
    { tab: "name", root: "filename", advanced: false },
    { tab: "note", root: "annotation", advanced: true },
  ] as const)(
    "keeps $tab context when a launch updates only the file and Item (Source: $advanced)",
    async ({ tab, root, advanced }) => {
      const { view } = setup();
      const file = new TFile();
      file.path = "templates/paper.md";
      view.file = file;
      await view.setState(
        { file: file.path, tab, root, advanced },
        { history: false },
      );

      const itemIndexedKey = SAMPLE_ITEM_CHOICES[0]!.id;
      await view.setState(
        { file: file.path, itemIndexedKey },
        { history: false },
      );

      expect(viewState(view)).toMatchObject({
        tab,
        root,
        advanced,
        item: { id: itemIndexedKey },
      });
    },
  );

  it("preserves context for an invalid tab and derives it when a valid tab is restored", async () => {
    const { view } = setup();
    await view.setState(
      { tab: "note", root: "annotation", advanced: true },
      { history: false },
    );
    await view.setState({ tab: "unknown" }, { history: false });
    expect(viewState(view)).toMatchObject({
      tab: "note",
      root: "annotation",
    });

    await view.setState({ tab: "name" }, { history: false });
    expect(viewState(view)).toMatchObject({
      tab: "name",
      root: "filename",
    });
    await view.setState(
      { tab: "note", root: "annotation" },
      { history: false },
    );
    expect(viewState(view)).toMatchObject({
      tab: "note",
      root: "annotation",
    });
  });

  it("restores editor authoring state beside the file path", async () => {
    const { view } = setup();
    const file = new TFile();
    file.path = "templates/paper.md";
    view.file = file;
    const state = {
      file: file.path,
      tab: "annotation",
      root: "annotation",
      advanced: true,
    };
    const result = { history: false };
    await view.setState(state, result);
    expect(result.history).toBe(true);
    result.history = false;
    await view.setState(state, result);
    expect(result.history).toBe(false);
    expect(view.getState()).toEqual({
      file: file.path,
      tab: "annotation",
      advanced: true,
      itemIndexedKey: null,
      annotationId: null,
      variant: "main",
      citationExample: "one-item",
      panels: {
        fields: { pinned: false, hidden: false, width: 320 },
        preview: { shown: false, width: 400, height: 40 },
      },
      preview: {
        mode: "create",
        live: true,
        showMarkdown: false,
        showManaged: false,
      },
    });
  });
  it("labels a built-in annotation sample export as selected paper data", () => {
    const { view } = setup();
    setViewItem(view, { id: "PAPER001g42", title: "Paper" });
    view.change.setRoot("annotation");
    Object.defineProperty(view.workbench, "examples", {
      value: Atom.make({
        current: [],
        example: { id: "builtin", root: { indexedKey: "EXAMP001" } },
      }),
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    expect(view.templateDataTarget()).toEqual({
      indexedKey: "PAPER001g42",
      root: "note",
    });
    expect(menuEntries(menu).map((item) => item.title)).toContain(
      "Export selected paper data",
    );
  });

  it("keeps a real selected annotation export on its exact Indexed Key", () => {
    const { view } = setup();
    setViewItem(view, { id: "PAPER001g42", title: "Paper" });
    view.change.setRoot("annotation");
    const annotation = { id: "real", root: { indexedKey: "ANNO0001g42" } };
    Object.defineProperty(view.workbench, "examples", {
      value: Atom.make({ current: [annotation], example: annotation }),
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    expect(view.templateDataTarget()).toEqual({
      indexedKey: "ANNO0001g42",
      root: "annotation",
    });
    expect(menuEntries(menu).map((item) => item.title)).toContain(
      "Save template data as JSON",
    );
  });
  it("inserts at the remembered slice selection and returns focus after sidebar use", async () => {
    const { view, leaf, requestSave, setActiveLeaf } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      const sidebar = document.createElement("button");
      document.body.append(sidebar);
      await act(() => sidebar.focus());
      expect(editor.hasFocus).toBe(false);
      await act(() => {
        expect(view.insertField("{{ zt.title }}")).toBe(true);
      });
      expect(view.getViewData()).toBe(
        SOURCE.replace("A stable note.", "A s{{ zt.title }}table note."),
      );
      expect(editor.hasFocus).toBe(true);
      expect(setActiveLeaf).toHaveBeenCalledWith(leaf, {
        focus: false,
      });
      expect(requestSave).toHaveBeenCalledOnce();
      await act(() => {
        view.controller.undo();
      });
      expect(view.getViewData()).toBe(SOURCE);
      sidebar.remove();
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });

  it("inserts a field in the editor's current language", async () => {
    const { view, requestSave } = setup();
    const node = {
      kind: "value",
      path: ["title"],
      key: "title",
      label: "title",
      valueType: "string",
      value: "Paper",
      expandable: false,
    } as const;
    document.body.append(view.contentEl);
    try {
      await act(async () => view.open());
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      await act(() => {
        view.controller.setManifestKey("language", "eta");
      });
      requestSave.mockClear();
      await act(() => {
        expect(insertNode(view, node)).toBe(true);
      });
      expect(view.getViewData()).toContain("A s<%= zt.title %>table note.");
      expect(requestSave).toHaveBeenCalledOnce();
      await act(() => {
        view.controller.undo();
      });
      expect(view.getViewData()).toContain("A stable note.");
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
    expect(insertNode(view, node)).toBe(false);
  });

  // A pane that only came on screen reports where its caret starts; the
  // start of the note is no place the reader chose.
  it("refuses an insertion before the reader places the caret", async () => {
    const { view } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => view.open());
      const before = view.getViewData();
      expect(view.registry.get(view.fields.canInsert)).toBe(false);
      await act(() => {
        expect(view.insertField("{{ zt.title }}")).toBe(false);
      });
      expect(view.getViewData()).toBe(before);
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
  });

  it("offers the Fields panel's insert while the editor takes edits", async () => {
    const { view } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => view.open());
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      const canInsert = () => view.registry.get(view.fields.canInsert);
      expect(canInsert()).toBe(true);
      await act(() => view.controller.setReadOnly(true));
      expect(canInsert()).toBe(false);
      await act(() => view.controller.setReadOnly(false));
      expect(canInsert()).toBe(true);
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
  });

  it("keeps the caret target mapped when external text moves an unchanged focused slice", async () => {
    const { view } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      const external = SOURCE.replace(
        "name: Paper",
        "name: A considerably longer title",
      );
      await act(() => {
        view.setViewData(external, false);
      });
      expect(editor.hasFocus).toBe(true);
      await act(() => {
        view.insertField("{{ zt.title }}");
      });
      expect(view.getViewData()).toBe(
        external.replace("A stable note.", "A s{{ zt.title }}table note."),
      );
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });
  it("rejects insertion after the remembered filename slice is removed", async () => {
    const { view } = setup();
    view.change.setTab("name");
    document.body.append(view.contentEl);
    try {
      await act(async () => {
        await view.open();
      });
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(
          '[role="tabpanel"]:not([hidden]) .cm-editor',
        )!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 2 } });
      });
      expect(view.insertTarget?.slice).toBe("filename");
      const external = SOURCE.replace("filename: paper\n", "");
      await act(() => {
        view.setViewData(external, false);
      });
      await act(() => {
        expect(view.insertField("{{ zt.title }}")).toBe(false);
      });
      expect(view.getViewData()).toBe(external);
    } finally {
      await act(async () => {
        await view.close();
      });
      view.contentEl.remove();
    }
  });
});

function sharedWorkspace() {
  const setActiveLeaf = vi.fn();
  const listeners = new Set<(file: TFile, source: string) => void>();
  const leaves: WorkspaceLeaf[] = [];
  const read = vi.fn<(file: TFile) => Promise<string>>(async () => SOURCE);
  function on(
    name: "quick-preview",
    callback: (file: TFile, source: string) => unknown,
    ctx?: unknown,
  ): object;
  function on(
    name: string,
    callback: (...data: never[]) => unknown,
    ctx?: unknown,
  ): object;
  function on(
    name: string,
    callback: (...data: never[]) => unknown,
    _ctx?: unknown,
  ): object {
    if (name === "quick-preview")
      listeners.add(callback as (file: TFile, source: string) => void);
    return {};
  }
  const trigger = vi.fn((name: string, file: TFile, source: string) => {
    if (name === "quick-preview")
      for (const listener of listeners) listener(file, source);
  });
  const requestSaveLayout: App["workspace"]["requestSaveLayout"] =
    Object.assign(
      vi.fn(() => requestSaveLayout),
      {
        cancel: () => requestSaveLayout,
        run: () => undefined,
      },
    );
  const app = stubService<App>("App", {
    scope: stubService<App["scope"]>("Scope", {}),
    workspace: stubService<App["workspace"]>("Workspace", {
      requestSaveLayout,
      setActiveLeaf,
      on,
      offref: vi.fn(),
      trigger,
      iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void) {
        leaves.forEach(callback);
      },
    }),
    ...localStorageStub,
    vault: stubService<App["vault"]>("Vault", { read }),
  });
  const file = new TFile();
  file.path = "profiles/paper.md";
  function editor() {
    const result = setup({ runtime: testRuntime() }, app);
    result.view.file = file;
    result.view.lastSavedData = SOURCE;
    leaves.push(result.leaf);
    return result;
  }
  return { app, file, read, trigger, editor, setActiveLeaf };
}

describe("native Profile source exchange", () => {
  it("exchanges one event per edit and keeps controllers, context, selection and history independent", () => {
    const { editor, trigger, setActiveLeaf } = sharedWorkspace();
    const first = editor();
    const second = editor();
    const firstController = first.view.controller;
    const secondController = second.view.controller;
    setViewItem(first.view, { id: "AAAA0001", title: "First" });
    setViewItem(second.view, { id: "BBBB0002", title: "Second" });
    second.view.change.setAdvanced(true);
    const cursor = SOURCE.indexOf("stable") + 2;
    secondController.dispatch({ selection: { anchor: cursor } });
    firstController.setManifestKey("name", "Longer name");
    const edited = SOURCE.replace("name: Paper", "name: Longer name");
    expect(second.view.getViewData()).toBe(edited);
    expect(secondController.state.selection.main.head).toBe(cursor + 6);
    expect(
      trigger.mock.calls.filter(([name]) => name === "quick-preview"),
    ).toHaveLength(1);
    expect(first.requestSave).toHaveBeenCalledTimes(1);
    expect(second.requestSave).not.toHaveBeenCalled();
    expect(second.view.dirty).toBe(true);
    expect(first.view.controller).toBe(firstController);
    expect(second.view.controller).toBe(secondController);
    expect(secondController).not.toBe(firstController);
    expect(viewState(first.view).item?.id).toBe("AAAA0001");
    expect(viewState(second.view).item?.id).toBe("BBBB0002");
    expect(viewState(second.view).advanced).toBe(true);
    expect(viewState(first.view).advanced).toBe(false);
    expect(secondController.undo()).toBe(true);
    expect(first.view.getViewData()).toBe(SOURCE);
    expect(second.view.getViewData()).toBe(SOURCE);
    expect(secondController.redo()).toBe(true);
    expect(first.view.getViewData()).toBe(edited);
    expect(setActiveLeaf).not.toHaveBeenCalled();
  });

  it("accepts invalid native source, ignores same-path foreign identities and equal events", () => {
    const { editor, app, file } = sharedWorkspace();
    const { view, requestSave } = editor();
    const foreign = new TFile();
    foreign.path = file.path;
    app.workspace.trigger("quick-preview", foreign, "unrelated");
    expect(view.getViewData()).toBe(SOURCE);
    app.workspace.trigger("quick-preview", file, "---\nname: [unfinished");
    app.workspace.trigger("quick-preview", file, "---\nname: [unfinished");
    expect(view.controller.document).toBeNull();
    expect(view.getViewData()).toBe("---\nname: [unfinished");
    expect(requestSave).not.toHaveBeenCalled();
    expect(view.controller.undo()).toBe(true);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.controller.undo()).toBe(false);
  });

  it("initializes from a current peer after the last edit, retaining the native disk baseline", async () => {
    const { editor, read } = sharedWorkspace();
    const first = editor();
    first.view.controller.setManifestKey("name", "Unsaved");
    const second = editor();
    await second.view.loadFileInternal(second.view.file!, true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second.view.getViewData()).toBe(
      SOURCE.replace("name: Paper", "name: Unsaved"),
    );
    expect(second.view.lastSavedData).toBe(SOURCE);
    expect(second.view.controller.canUndo).toBe(false);
    expect(second.requestSave).not.toHaveBeenCalled();
  });

  it("retains source received during initial disk loading without adding an initial Undo entry", async () => {
    const { editor, read, app, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, true);
    app.workspace.trigger(
      "quick-preview",
      file,
      "Current native Markdown source",
    );
    pending.resolve(SOURCE);
    await loading;
    expect(view.getViewData()).toBe("Current native Markdown source");
    expect(view.lastSavedData).toBe(SOURCE);
    expect(view.controller.canUndo).toBe(false);
  });

  it("rejects a delayed read before baseline mutation after live input and a completed save", async () => {
    const { editor, read, app, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, false);
    const saved = SOURCE.replace("A stable note.", "Current saved note.");
    app.workspace.trigger("quick-preview", file, saved);
    // A native save completes while the older read is waiting.
    view.lastSavedData = saved;
    view.dirty = false;
    read.mockResolvedValue(saved);
    pending.resolve("Stale disk text");
    await loading;
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.lastSavedData).toBe(saved);
    expect(view.getViewData()).toBe(saved);
    expect(view.controller.undo()).toBe(true);
    expect(view.getViewData()).toBe(SOURCE);
    expect(view.controller.undo()).toBe(false);
  });

  it("does not let an older read supersede a newer read or a rebound file", async () => {
    const { editor, read, file } = sharedWorkspace();
    const { view } = editor();
    const old = Promise.withResolvers<string>();
    read
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce("New disk text");
    const older = view.loadFileInternal(file, false);
    await view.loadFileInternal(file, false);
    old.resolve("Old disk text");
    await older;
    expect(view.getViewData()).toBe("New disk text");
    expect(view.lastSavedData).toBe("New disk text");
    expect(read).toHaveBeenCalledTimes(2);
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const previousFile = view.loadFileInternal(file, false);
    view.file = new TFile();
    view.setViewData("Other document", true);
    view.lastSavedData = "Other document";
    pending.resolve("Previous document");
    await previousFile;
    expect(view.getViewData()).toBe("Other document");
    expect(view.lastSavedData).toBe("Other document");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("lets native close read the final source and ignores a read that completes after closing", async () => {
    const { editor, read, file } = sharedWorkspace();
    const { view } = editor();
    const pending = Promise.withResolvers<string>();
    read.mockReturnValueOnce(pending.promise);
    const loading = view.loadFileInternal(file, false);
    view.controller.setManifestKey("name", "Final edit");
    let closingSource = "";
    using _nativeClose = vi
      .spyOn(
        MockTextFileView.prototype as unknown as { onClose(): Promise<void> },
        "onClose",
      )
      .mockImplementation(async () => {
        closingSource = view.getViewData();
      });
    await view.close();
    pending.resolve("Old file");
    await loading;
    expect(closingSource).toBe(
      SOURCE.replace("name: Paper", "name: Final edit"),
    );
    expect(view.lastSavedData).toBe(SOURCE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("clears a view without publishing empty source into its peers", () => {
    const { editor, trigger } = sharedWorkspace();
    const first = editor();
    const second = editor();
    first.view.clear();
    expect(first.view.getViewData()).toBe("");
    expect(second.view.getViewData()).toBe(SOURCE);
    expect(
      trigger.mock.calls.filter(([name]) => name === "quick-preview"),
    ).toHaveLength(0);
  });
});

it("recreates persisted editor choices and restores namespaced presentation after mount without focus or layout writes", async () => {
  await using cleanup = new AsyncDisposableStack();
  const original = setup();
  cleanup.defer(() => act(async () => original.view.close()));
  document.body.append(original.view.contentEl);
  cleanup.defer(() => original.view.contentEl.remove());
  await act(async () => original.view.open());
  await act(async () => original.view.change.setAdvanced(true));
  const editor = EditorView.findFromDOM(
    original.view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  const scroll = original.view.contentEl.querySelector<HTMLElement>(
    "[data-workbench-scroll=advanced]",
  )!;
  await act(async () => {
    editor.dispatch({ selection: { anchor: 25, head: 7 } });
    scroll.scrollTop = 43;
    scroll.dispatchEvent(new Event("scroll"));
  });
  const persisted = original.view.getState();
  const ephemeral = original.view.getEphemeralState();
  expect(ephemeral).not.toHaveProperty("cursor");
  expect(ephemeral).not.toHaveProperty("scroll");
  expect(persisted).not.toHaveProperty("presentation");
  expect(persisted).not.toHaveProperty("root");
  const restored = setup();
  cleanup.defer(() => act(async () => restored.view.close()));
  document.body.append(restored.view.contentEl);
  cleanup.defer(() => restored.view.contentEl.remove());
  const typing = document.createElement("input");
  document.body.append(typing);
  cleanup.defer(() => typing.remove());
  typing.focus();
  await act(async () => restored.view.setState(persisted, { history: false }));
  restored.view.setEphemeralState(ephemeral);
  await act(async () => restored.view.open());
  const restoredEditor = EditorView.findFromDOM(
    restored.view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(restoredEditor.state.selection.main.anchor).toBe(25);
  expect(restoredEditor.state.selection.main.head).toBe(7);
  expect(
    restored.view.contentEl.querySelector<HTMLElement>(
      "[data-workbench-scroll=advanced]",
    )!.scrollTop,
  ).toBe(43);
  expect(document.activeElement).toBe(typing);
  expect(restored.view.getState()).toEqual(persisted);
  const saves = vi.mocked(restored.app.workspace.requestSaveLayout);
  saves.mockClear();
  await act(async () => {
    restoredEditor.dispatch({ selection: { anchor: 5 } });
    restored.view.contentEl
      .querySelector<HTMLElement>("[data-workbench-scroll=advanced]")!
      .dispatchEvent(new Event("scroll"));
  });
  expect(saves).not.toHaveBeenCalled();
  expect(restored.view.getState()).toEqual(persisted);
});

it("clamps stale restored ranges, ignores removed Properties, and discards a different Item's presentation", async () => {
  await using cleanup = new AsyncDisposableStack();
  const { view } = setup();
  cleanup.defer(() => act(async () => view.close()));
  await act(async () => {
    await view.open();
    view.change.setAdvanced(true);
  });
  const saved = view.getEphemeralState() as {
    zotlitTemplateWorkbench: Record<string, unknown>;
  };
  saved.zotlitTemplateWorkbench.selection = {
    slice: "advanced",
    range: { from: -8, to: 99999 },
  };
  saved.zotlitTemplateWorkbench.selected = 55;
  await act(async () => view.setEphemeralState(saved));
  const editor = EditorView.findFromDOM(
    view.contentEl.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  expect(editor.state.selection.main.from).toBe(0);
  expect(editor.state.selection.main.to).toBe(SOURCE.length);
  expect(viewState(view).presentation.selected).toBeNull();
  await act(async () => setViewItem(view, { id: "OTHER001", title: "Other" }));
  await act(async () => editor.dispatch({ selection: { anchor: 3 } }));
  await act(async () => view.setEphemeralState(saved));
  expect(editor.state.selection.main.head).toBe(3);
});

it("unloads and saves a named Profile before restoring a file-free built-in descriptor", async () => {
  await using cleanup = new AsyncDisposableStack();
  const builtin = SOURCE.replace("id: paper", "id: default").replace(
    "A stable note.",
    "Built-in note.",
  );
  const { view, app } = setup({
    runtime: testRuntime(),
    profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
      "Profile",
      {
        getBuiltInSource: Effect.succeed(builtin),
      },
    ),
  });
  cleanup.defer(() => act(async () => view.close()));
  const file = new TFile();
  file.path = "templates/paper.md";
  view.file = file;
  const writes: { file: TFile | null; source: string }[] = [];
  const save = vi.spyOn(view, "save").mockImplementation(async () => {
    writes.push({ file: view.file, source: view.getViewData() });
  });
  cleanup.defer(() => save.mockRestore());
  const publish = vi.spyOn(app.workspace, "trigger");
  cleanup.defer(() => publish.mockRestore());
  await act(async () =>
    view.setState(
      { defaultDraft: true, tab: "match", advanced: false },
      { history: false },
    ),
  );
  expect(writes).toEqual([{ file, source: SOURCE }]);
  expect(view.file).toBeNull();
  expect(view.getState()).toEqual({
    file: null,
    defaultDraft: true,
    tab: "note",
    advanced: false,
    itemIndexedKey: null,
    annotationId: null,
    variant: "main",
    citationExample: "one-item",
    panels: {
      fields: { pinned: false, hidden: false, width: 320 },
      preview: { shown: false, width: 400, height: 40 },
    },
    preview: {
      mode: "create",
      live: true,
      showMarkdown: false,
      showManaged: false,
    },
  });
  expect(view.controller.readOnly).toBe(true);
  expect(view.getViewData()).toBe(builtin);
  expect(publish).not.toHaveBeenCalledWith("quick-preview", file, builtin);
});

describe("the Template Document kind picks the tabs and the tab title", () => {
  const CITATION_SOURCE = `---
language: liquid
---
{% if zt.variant == "alt" %}{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}{% else %}{{ zt.citations | pandoc_cite }}{% endif %}
`;

  const PARTIAL_SOURCE = `---
language: liquid
---
{{ zt.authors | join: ", " }}
`;

  function openKind(path: string, source: string) {
    const harness = setup({
      runtime: testRuntime(),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        "compile-status-changed": Stream.empty,
        loaded: false,
        materializeCitationTemplate: vi.fn(),
      }),
    });
    const file = new TFile();
    file.path = path;
    harness.view.file = file;
    harness.view.setViewData(source, true);
    return harness;
  }

  const tabLabels = (view: TemplateWorkbenchView) =>
    [...view.contentEl.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );

  /** The Basic and Source view action, which only a Profile document offers. */
  const sourceAction = (view: TemplateWorkbenchView) =>
    (view as unknown as { actions: HTMLElement[] }).actions.find(
      (action) => action.getAttribute("aria-label") === m.workbench_advanced(),
    )!;

  it("opens the Citation Template on a lone Citation tab titled Citation text", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(m.template_workbench_title_citation());
    expect(tabLabels(view)).toEqual([m.workbench_tab_citation()]);
    expect(viewState(view)).toMatchObject({
      tab: "citation",
      root: "citation",
      advanced: false,
    });
    expect(sourceAction(view).style.display).toBe("none");
  });

  it("names the Citation example set in the item row as an example", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const row = view.contentEl.querySelector("[data-workbench-item-row]");
    expect(row?.textContent).toContain(
      m.workbench_example_title({
        name: m.workbench_citation_example_one_item(),
      }),
    );
  });

  it("reveals a Citation Template problem in the one editor it opens with", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    // The companion preview asks for the advanced slice, which a Profile holds
    // behind its own view; a plain document has nowhere else to open.
    await act(async () => view.revealSlice("advanced"));

    expect(viewState(view)).toMatchObject({
      tab: "citation",
      root: "citation",
      advanced: false,
    });
    expect(tabLabels(view)).toEqual([m.workbench_tab_citation()]);
    expect(view.contentEl.querySelector(".cm-editor")).not.toBeNull();
  });

  it("explains a document problem with no preview companion, and keeps the source in place", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    document.body.append(view.contentEl);
    cleanup.defer(() => view.contentEl.remove());
    await act(async () => view.open());
    await act(async () =>
      view.setViewData(SOURCE.replace("--- zotlit:annotation ---", ""), false),
    );

    const area = view.contentEl.querySelector<HTMLElement>(
      '[data-part="problems"]',
    )!;
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    // An automatic check stays compact until the reader asks for the rest.
    expect(area.textContent).toContain(
      m.workbench_problem_missing_annotation_section(),
    );
    expect(area.textContent).not.toContain(
      m.workbench_problem_missing_annotation_section_recovery(),
    );

    const show = [...area.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_problem_show(),
    )!;
    await act(async () => show.click());
    expect(area.textContent).toContain(m.workbench_annotation_label());
    expect(area.textContent).toContain(
      m.workbench_problem_missing_annotation_section_recovery(),
    );
    expect(area.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);

    const collapse = [...area.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_problems_return(),
    )!;
    await act(async () => collapse.click());
    expect(area.textContent).not.toContain(
      m.workbench_problem_missing_annotation_section_recovery(),
    );
    expect(view.contentEl.querySelector(".cm-editor")).not.toBeNull();
    expect(editor.contentDOM).toBe(document.activeElement);
  });

  it("returns the reader to the place in the source the reading left", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    document.body.append(view.contentEl);
    cleanup.defer(() => view.contentEl.remove());
    await act(async () => view.open());
    await act(async () =>
      view.setViewData(SOURCE.replace("--- zotlit:annotation ---", ""), false),
    );

    // Where the reader was editing, which every pane reports as it moves.
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    await act(async () => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 4 } });
    });
    const left = view.insertTarget!;
    // The pane reports master offsets, so the caret's own slice places it.
    const caret = view.controller.sliceRange(left.slice).from + 4;
    expect(left.range).toMatchObject({ from: caret, to: caret });

    const area = view.contentEl.querySelector<HTMLElement>(
      '[data-part="problems"]',
    )!;
    const press = (label: string) =>
      act(async () =>
        [...area.querySelectorAll("button")]
          .find(
            (button) =>
              (button.getAttribute("aria-label") ?? button.textContent) ===
              label,
          )!
          .click(),
      );
    await press(m.workbench_problem_show());
    expect(area.dataset.state).toBe("open");

    await press(m.workbench_problems_return());
    // The area gives the editor back whole, and the caret is where it was.
    expect(area.dataset.state).toBe("compact");
    expect(viewState(view).presentation.reveal).toMatchObject({
      from: caret,
      to: caret,
      slice: left.slice,
    });
    expect(editor.state.selection.main.head).toBe(4);
    expect(editor.contentDOM).toBe(document.activeElement);
  });

  it("reclaims the reading space and opens the Annotation tab for a missing section", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    document.body.append(view.contentEl);
    cleanup.defer(() => view.contentEl.remove());
    await act(async () => view.open());
    await act(async () =>
      view.setViewData(SOURCE.replace("--- zotlit:annotation ---", ""), false),
    );

    const area = view.contentEl.querySelector<HTMLElement>(
      '[data-part="problems"]',
    )!;
    const press = (selector: string) =>
      act(async () =>
        view.contentEl.querySelector<HTMLElement>(selector)!.click(),
      );
    await press('[data-part="problems-toggle"]');
    expect(area.dataset.state).toBe("open");

    await press('[data-part="problems-open"]');
    expect(area.dataset.state).toBe("compact");
    // The section is added from the Annotation tab, as on the web.
    expect(viewState(view)).toMatchObject({
      advanced: false,
      tab: "annotation",
      root: "annotation",
    });
    expect(
      view.contentEl.querySelector('[data-part="section-bar"]'),
    ).not.toBeNull();
  });

  it("keeps a Profile document on its six tabs, titled by its name", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-profile.paper.md", SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(
      m.template_workbench_title_profile({ label: "Paper" }),
    );
    expect(tabLabels(view)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
      m.workbench_tab_match(),
      m.workbench_tab_profile(),
    ]);
    expect(sourceAction(view).style.display).not.toBe("none");
  });

  it("returns a leaf that held the Citation Template to the Profile tabs", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    expect(viewState(view)).toMatchObject({
      tab: "citation",
      root: "citation",
    });

    const profile = new TFile();
    profile.path = "templates/zotlit-profile.paper.md";
    await act(async () => {
      view.file = profile;
      view.setViewData(SOURCE, true);
    });

    // The Citation tab names no panel a Profile document has, so the six
    // Profile tabs open on the first of them rather than on none.
    expect(viewState(view)).toMatchObject({ tab: "note", root: "note" });
    expect(tabLabels(view)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
      m.workbench_tab_match(),
      m.workbench_tab_profile(),
    ]);
    expect(
      view.contentEl.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe(m.workbench_tab_note());
  });

  it("offers Customize citation text on every kind, and the language switch on the Citation Template", async () => {
    await using cleanup = new AsyncDisposableStack();
    const profile = openKind("templates/zotlit-profile.paper.md", SOURCE);
    cleanup.defer(() => act(async () => profile.view.close()));
    const citation = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    cleanup.defer(() => act(async () => citation.view.close()));

    const titles = (view: TemplateWorkbenchView) => {
      const menu = new Menu();
      view.onPaneMenu(menu as never, "more-options");
      return menuEntries(menu).map((item) => item.title);
    };
    expect(titles(profile.view)).toContain(
      m.command_customize_citation_text_name(),
    );
    // The view already stands in its Workbench window: no entry opens it.
    expect(titles(profile.view)).not.toContain(
      m.template_workbench_open_layout(),
    );
    expect(titles(profile.view)).not.toContain(
      m.template_workbench_change_language(),
    );
    expect(titles(citation.view)).toContain(
      m.command_customize_citation_text_name(),
    );
    expect(titles(citation.view)).toContain(
      m.template_workbench_change_language(),
    );
    // The annotation example belongs to a Profile's own Annotation Section.
    expect(titles(citation.view)).not.toContain(
      m.workbench_choose_annotation(),
    );
  });

  it("lists the vault's partials in the pane menu and ends with New partial", () => {
    const { view } = setup({
      runtime: testRuntime(),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        "compile-status-changed": Stream.empty,
        loaded: true,
        getPartialNames: () => ["authors", "venue-line"],
        getPartialDocuments: () => [
          {
            name: "authors",
            path: "templates/zotlit-partial.authors.md",
            language: "liquid",
          },
          {
            name: "venue-line",
            path: "templates/zotlit-partial.venue-line.md",
            language: "liquid",
          },
        ],
      }),
    });
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");

    const partials = menu.items.find(
      (item) => item.title === m.template_workbench_partials(),
    )!;
    expect(partials.submenu?.items.map((item) => item.title)).toEqual([
      "authors",
      "venue-line",
      m.workbench_partial_new(),
    ]);
  });

  it("reports the partials a shared Profile still carries, and unpacks them", async () => {
    const bundled = SOURCE.replace(
      "filename: paper",
      [
        "filename: paper",
        "partials:",
        "  - name: authors",
        "    language: liquid",
        "    source: Authors",
        "  - name: venue-line",
        "    language: liquid",
        "    source: Venue",
      ].join("\n"),
    );
    const unpacked: string[] = [];
    const { view } = setup({
      runtime: testRuntime(),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        "compile-status-changed": Stream.empty,
        loaded: true,
        getPartialNames: () => [],
        getPartialDocuments: () => [],
        planPartialUnpack: (
          partials: readonly { name: string; source: string }[],
        ) =>
          partials.map(({ name, source }) => ({
            name,
            // The vault holds a venue-line of the reader's own already.
            verdict: name === "venue-line" ? "conflict" : "write",
            document: source,
          })),
        unpackPartials: async (
          plan: readonly { name: string; verdict: string }[],
        ) => {
          unpacked.push(...plan.map(({ name }) => name));
          const written = plan
            .filter(({ verdict }) => verdict === "write")
            .map(({ name }) => name);
          return {
            written,
            kept: ["venue-line"],
            dropped: plan.map(({ name }) => name),
            refused: [],
            otherCase: [],
          };
        },
      }),
    });
    view.setViewData(bundled, true);
    expect(view.controller.problems[0]).toMatchObject({
      code: "bundled-partial",
      params: { names: "authors, venue-line" },
    });

    // Unpacking writes files, so the reader reaches it among the ordinary
    // partial operations rather than inside the reading of a problem
    // (ADR 0056). It is offered only while this document carries any.
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const partials = menu.items.find(
      (item) => item.title === m.template_workbench_partials(),
    )!;
    expect(partials.submenu?.items.map((item) => item.title)).toEqual([
      m.workbench_partial_new(),
      m.workbench_problem_bundled_partial_unpack(),
    ]);

    // Both entries go — the written one and the one the reader's own file
    // answers — so the problem clears and neither name has two homes left.
    await run(view.unpackBundledPartials());
    expect(unpacked).toEqual(["authors", "venue-line"]);
    expect(view.getViewData()).not.toContain("partials:");
    expect(view.getViewData()).toContain("filename: paper");
    expect(view.controller.problems).toEqual([]);

    const repaired = new Menu();
    view.onPaneMenu(repaired as never, "more-options");
    expect(
      repaired.items
        .find((item) => item.title === m.template_workbench_partials())!
        .submenu?.items.map((item) => item.title),
    ).toEqual([m.workbench_partial_new()]);
  });

  it.each([true, false])(
    "restores the built-in Default once the reader confirms: %s",
    async (confirmed) => {
      using _answer = answerConfirmation(confirmed);
      const restoreDefault = vi.fn(() => Effect.void);
      const { view, leaf } = setup({
        runtime: testRuntime(),
        profile: stubService<NonNullable<TemplateWorkbenchDeps["profile"]>>(
          "Profile",
          {
            restoreDefault: Effect.suspend(restoreDefault),
            getSource: () => Effect.succeed("Built-in Default"),
          },
        ),
      });

      const setViewState = vi.spyOn(leaf, "setViewState");

      await run(view.restoreDefault());

      expect(restoreDefault).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(setViewState).toHaveBeenCalledTimes(confirmed ? 1 : 0);
      expect(view.isDefaultDraft).toBe(confirmed);
      expect(view.getViewData()).toBe(confirmed ? "Built-in Default" : SOURCE);
    },
  );

  it("names each kind of unpacked partial in a notice of its own", () => {
    expect(
      unpackedPartialNotices({
        written: ["authors", "title"],
        kept: ["venue-line"],
        otherCase: [],
        refused: ["pages"],
      }),
    ).toEqual([
      m.notice_partials_unpacked({ names: "authors, title" }),
      m.notice_partials_kept({ names: "venue-line" }),
      m.notice_partials_refused({ names: "pages" }),
    ]);
  });

  it("names no partial while the template service is still scanning the folder", () => {
    const { view } = setup({
      runtime: testRuntime(),
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        "compile-status-changed": Stream.empty,
        loaded: false,
        getPartialNames: () => {
          throw new Error(
            "TemplateService.getPartialNames(): service is not ready",
          );
        },
        getPartialDocuments: () => [],
      }),
    });

    // The placeholder reads this during render, before the folder scan ends.
    expect(view.partialNames).toEqual([]);
  });

  it("writes an Explorer field into the Citation Template's one editor", async () => {
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    await using cleanup = new AsyncDisposableStack();
    document.body.append(view.contentEl);
    cleanup.defer(() => view.contentEl.remove());
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const editor = EditorView.findFromDOM(
      view.contentEl.querySelector(".cm-editor")!,
    )!;
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0 } });
    });
    await act(() => {
      expect(
        insertNode(view, {
          kind: "value",
          path: ["variant"],
          key: "variant",
          label: "variant",
          valueType: "string",
          value: "main",
          expandable: false,
        }),
      ).toBe(true);
    });
    expect(view.getViewData()).toBe(
      CITATION_SOURCE.replace("{% if", "{{ zt.variant }}{% if"),
    );
  });

  it("opens a Shared Partial on a lone Partial tab titled by its name", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.getDisplayText()).toBe(
      m.template_workbench_title_partial({ name: "authors" }),
    );
    expect(tabLabels(view)).toEqual([m.workbench_tab_partial()]);
    expect(viewState(view)).toMatchObject({
      tab: "partial",
      root: "note",
      advanced: false,
    });
    expect(view.partialContext).toBe("note");
    expect(sourceAction(view).style.display).toBe("none");
  });

  it("offers the language switch and the annotation chooser on a partial", () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const titles = menuEntries(menu).map((item) => item.title);

    expect(titles).toContain(m.template_workbench_change_language());
    expect(titles).toContain(m.workbench_choose_annotation());
  });

  it("follows a chosen caller with the completion root and the saved state", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    expect(view.controller.templateRegions[0]!.root).toBe("note");

    await act(async () =>
      view.setPartialSelection({ context: "annotation", profile: "reading1" }),
    );

    expect(viewState(view).root).toBe("annotation");
    expect(view.controller.templateRegions[0]!.root).toBe("annotation");
    expect(view.partialProfile).toBe("reading1");
    const saved = view.getState();
    expect(saved).toMatchObject({
      partialContext: "annotation",
      partialProfile: "reading1",
    });

    // The workspace hands the same descriptor back when the file reopens.
    const reopened = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      reopened.view.setState(
        { ...saved, file: "templates/zotlit-partial.authors.md" },
        { history: false },
      ),
    );
    expect(reopened.view.partialContext).toBe("annotation");
    expect(reopened.view.partialProfile).toBe("reading1");
    expect(reopened.view.controller.templateRegions[0]!.root).toBe(
      "annotation",
    );
  });

  it("shows the caller again when the partial is reopened in a new leaf", async () => {
    const first = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      first.view.setPartialSelection({
        context: "citation",
        profile: "reading1",
      }),
    );
    await act(async () => first.view.close());

    // A new leaf, so the workspace has no saved state to carry the choice.
    // `openTemplateWorkbench` hands it a descriptor of the file alone.
    const reopened = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      reopened.view.setState(
        { file: "templates/zotlit-partial.authors.md" },
        { history: false },
      ),
    );

    expect(reopened.view.partialContext).toBe("citation");
    expect(reopened.view.partialProfile).toBe("reading1");
    expect(reopened.view.getState()).toMatchObject({
      partialContext: "citation",
      partialProfile: "reading1",
    });
  });

  it("opens another partial on the default caller, not the last one's", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      view.setPartialSelection({ context: "annotation", profile: "reading1" }),
    );

    // The same leaf moves to a second partial, which was never chosen for.
    const other = new TFile();
    other.path = "templates/zotlit-partial.venue.md";
    await act(async () => {
      view.file = other;
      view.setViewData(PARTIAL_SOURCE, true);
    });

    expect(view.partialContext).toBe("note");
    expect(view.partialProfile).toBeNull();
    expect(view.controller.templateRegions[0]!.root).toBe("note");
    expect(view.getState()).toMatchObject({
      partialContext: "note",
      partialProfile: null,
    });
  });

  it("returns a leaf that held a partial to the Profile tabs", async () => {
    const { view } = openKind(
      "templates/zotlit-partial.authors.md",
      PARTIAL_SOURCE,
    );
    await act(async () =>
      view.setPartialSelection({ context: "citation", profile: null }),
    );

    const profile = new TFile();
    profile.path = "templates/zotlit-profile.paper.md";
    await act(async () => {
      view.file = profile;
      view.setViewData(SOURCE, true);
    });

    expect(viewState(view)).toMatchObject({ tab: "note", root: "note" });
  });

  it("switches the rendering language on the manifest key alone", () => {
    const { view } = openKind("templates/zotlit-citation.md", CITATION_SOURCE);
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const language = menuEntries(menu).find(
      (item) => item.title === m.template_workbench_change_language(),
    )!;
    language
      .submenu!.items.find(
        (item) => item.title === m.workbench_name_language_eta(),
      )!
      .click();

    expect(view.getViewData()).toBe(
      CITATION_SOURCE.replace("language: liquid", "language: eta"),
    );
    expect(view.controller.plainDocument?.manifest.language).toBe("eta");
  });
});

describe("Extract to partial", () => {
  const EXTRACT_SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: liquid
filename: paper
---
{{ zt.authors }}
{{ zt.publicationTitle }}
{{ zt.date }}
--- zotlit:annotation ---
An annotation.
`;

  /** The three lines the reader selects, hand-counted off EXTRACT_SOURCE. */
  const SELECTION =
    "{{ zt.authors }}\n{{ zt.publicationTitle }}\n{{ zt.date }}";

  /** The Liquid call the extraction leaves in its place. */
  const CALL = '{% render "authors" with zt as zt %}';

  /** Every row the menu carries, in order; the extraction is the last one. */
  const MENU_TITLES = [
    m.template_workbench_cut(),
    m.template_workbench_copy(),
    m.template_workbench_paste(),
    m.template_workbench_extract_partial(),
  ];

  async function openProfile(
    language: "liquid" | "eta",
    source = EXTRACT_SOURCE,
  ) {
    const harness = setup();
    harness.view.setViewData(
      language === "eta"
        ? source.replace("language: liquid", "language: eta")
        : source,
      true,
    );
    document.body.append(harness.view.contentEl);
    await act(async () => harness.view.open());
    const editor = EditorView.findFromDOM(
      harness.view.contentEl.querySelector(".cm-editor")!,
    )!;
    return { ...harness, editor };
  }

  /** The right-click gesture, answering with the menu it opened or none. */
  function rightClick(editor: EditorView): Menu | null {
    const opened = Menu.instances.length;
    editor.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    return Menu.instances[opened] ?? null;
  }

  async function extract(editor: EditorView, head: number) {
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head } });
    });
    const menu = rightClick(editor);
    expect(menu?.items.map((item) => item.title)).toEqual(MENU_TITLES);
    await act(async () => {
      menu!.items.at(-1)!.click();
      await Promise.resolve();
    });
  }

  it("keeps the document and selection when the partial prompt is cancelled", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.succeed(null),
    );
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, SELECTION.length);

    expect(createSharedPartialEffect).toHaveBeenCalledOnce();
    expect(view.getViewData()).toBe(EXTRACT_SOURCE);
    expect(editor.state.selection.main.anchor).toBe(0);
    expect(editor.state.selection.main.head).toBe(SELECTION.length);
  });

  it("leaves a Liquid render tag over the three lines it moved out", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.succeed("authors"),
    );
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, SELECTION.length);

    expect(vi.mocked(createSharedPartialEffect).mock.lastCall?.[1]).toEqual({
      source: SELECTION,
      language: "liquid",
      open: "split",
      from: view.leaf,
    });
    expect(view.getViewData()).toBe(EXTRACT_SOURCE.replace(SELECTION, CALL));
  });

  it("keeps a selection that opens with a rule out of the manifest", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.succeed("authors"),
    );
    // A Markdown rule on the first line reads as a manifest opener where the
    // create flow writes the raw source.
    const ruled = `---\n${SELECTION}`;
    const { view, editor } = await openProfile(
      "liquid",
      EXTRACT_SOURCE.replace(SELECTION, ruled),
    );
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, ruled.length);

    const options = vi.mocked(createSharedPartialEffect).mock.lastCall![1]!;
    expect(options).toEqual({
      source: ruled,
      language: "liquid",
      open: "split",
      from: view.leaf,
    });
    expect(
      parsePlainTemplateDocument(
        formatPlainTemplateDocument(options.source!, options.language!),
      ).source,
    ).toBe(ruled);
  });

  it("writes an Eta include and asks the create flow for an Eta partial", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.succeed("authors"),
    );
    const { view, editor } = await openProfile("eta");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await extract(editor, SELECTION.length);

    expect(vi.mocked(createSharedPartialEffect).mock.lastCall?.[1]).toEqual({
      source: SELECTION,
      language: "eta",
      open: "split",
      from: view.leaf,
    });
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace("language: liquid", "language: eta").replace(
        SELECTION,
        '<%~ include("authors", zt) %>',
      ),
    );
  });

  it("keeps the keystrokes around it out of its undo step", async () => {
    await using cleanup = new AsyncDisposableStack();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.succeed("authors"),
    );
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    const type = (from: number, insert: string) =>
      act(() => {
        editor.focus();
        editor.dispatch({ changes: { from, insert }, userEvent: "input.type" });
      });
    await type(SELECTION.length, " · 2020");

    await extract(editor, SELECTION.length);
    await type(CALL.length, "!");
    await act(() => {
      view.controller.undo();
    });

    // One undo takes back the keystroke alone, and the next one the extraction
    // alone: neither joins the other.
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${CALL} · 2020`),
    );
    await act(() => {
      view.controller.undo();
    });
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${SELECTION} · 2020`),
    );
  });

  it("keeps a changed template rather than writing the call", async () => {
    await using cleanup = new AsyncDisposableStack();
    const prompt = Promise.withResolvers<string | null>();
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return prompt.promise;
      }),
    );
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head: SELECTION.length } });
    });
    await act(async () => {
      rightClick(editor)!.items.at(-1)!.click();
      await Promise.resolve();
    });

    // The reader edits the template while the name prompt is still open.
    await act(() => {
      editor.dispatch({
        changes: { from: SELECTION.length, insert: " · 2020" },
        userEvent: "input.type",
      });
    });
    await act(async () => {
      prompt.resolve("authors");
      await prompt.promise;
      await Promise.resolve();
    });

    // The stale answer itself is extract-partial.test.ts's; here the claim is
    // that the reader's own edit survives the gesture whole.
    expect(view.getViewData()).toBe(
      EXTRACT_SOURCE.replace(SELECTION, `${SELECTION} · 2020`),
    );
  });

  it("cuts the selection out to the clipboard", async () => {
    await using cleanup = new AsyncDisposableStack();
    // The gesture takes the Electron menu's place, so the menu owns cut itself.
    const writeText = vi.fn(async () => {});
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    cleanup.defer(() => {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    });
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());
    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 0, head: SELECTION.length } });
    });

    const menu = rightClick(editor);
    expect(menu?.items.map((item) => item.title)).toEqual(MENU_TITLES);
    await act(async () => {
      menu!.items[0]!.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(SELECTION);
    expect(view.getViewData()).toBe(EXTRACT_SOURCE.replace(SELECTION, ""));
    expect(createSharedPartialEffect).not.toHaveBeenCalled();
  });

  it("offers no action over an empty selection", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view, editor } = await openProfile("liquid");
    cleanup.defer(() => act(async () => view.close()));
    cleanup.defer(() => view.contentEl.remove());

    await act(() => {
      editor.focus();
      editor.dispatch({ selection: { anchor: 4 } });
    });

    expect(rightClick(editor)).toBeNull();
    expect(createSharedPartialEffect).not.toHaveBeenCalled();
  });
});

describe("the native preview session of a plain Template Document", () => {
  const CITATION_SOURCE = `---
language: liquid
---
{{ zt.citations | pandoc_cite }}
`;

  async function openCitation() {
    const fixture = await createRenderFixture();
    const harness = setup({
      runtime: testRuntime(),
      nativePreview: fixture.deps,
      templates: stubService<TemplateWorkbenchDeps["templates"]>("Templates", {
        "compile-status-changed": Stream.empty,
        loaded: true,
        getPartialNames: () => [],
        getPartialDocuments: () => [],
        materializeCitationTemplate: vi.fn(),
      }),
    });
    const file = new TFile();
    file.path = "templates/zotlit-citation.md";
    harness.view.file = file;
    harness.view.setViewData(CITATION_SOURCE, true);
    return { ...harness, fixture };
  }

  it("follows the document context and the source the editor holds", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view, fixture } = await openCitation();
    cleanup.use(fixture);
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());

    expect(view.registry.get(view.model.document)).toMatchObject({
      path: "templates/zotlit-citation.md",
    });
    expect(view.registry.get(view.workbench.document.kind)).toBe("citation");
    expect(view.registry.get(view.workbench.document.source)).toBe(
      CITATION_SOURCE,
    );
    expect(view.registry.get(view.workbench.input).hold).toBe(false);

    const edited = CITATION_SOURCE.replace("pandoc_cite", "pandoc_cite: 'alt'");
    await act(async () => view.setViewData(edited, false));

    expect(view.registry.get(view.workbench.document.source)).toBe(edited);
  });
});

describe("Template Workbench Item choice", () => {
  const FIRST = "FIRST234";
  const LATER = "LATER234";

  /** A ZoteroReads fake whose Item reads hold until they are interrupted. */
  function heldReads() {
    const started: string[] = [];
    const interrupted: string[] = [];
    const zoteroReads = stubService<TemplateWorkbenchDeps["zoteroReads"]>(
      "ZoteroReads",
      {
        state: "ready",
        reads: stubService<TemplateWorkbenchDeps["zoteroReads"]["reads"]>(
          "ZoteroReadsApi",
          {
            ItemsByIndexedKeys: ({ indexedKeys }) =>
              Effect.callback<never>(() => {
                const key = indexedKeys[0]!;
                started.push(key);
                return Effect.sync(() => interrupted.push(key));
              }),
          },
        ),
      },
    );
    return { zoteroReads, started, interrupted };
  }

  it("interrupts the older Item read when a newer selection starts", async () => {
    const reads = heldReads();
    const { view } = setup({
      runtime: testRuntime(),
      zoteroReads: reads.zoteroReads,
    });
    const first = run(view.selectItem({ id: FIRST, title: "First" }));
    await vi.waitFor(() => expect(reads.started).toEqual([FIRST]));
    // The later read holds until the leaf closes, which interrupts it.
    void Effect.runPromiseExit(view.selectItem({ id: LATER, title: "Later" }));
    await vi.waitFor(() => expect(reads.started).toEqual([FIRST, LATER]));
    await expect(first).resolves.toBe(false);
    // The later read still runs.
    expect(reads.interrupted).toEqual([FIRST]);
  });

  it("interrupts every pending command when the view closes", async () => {
    const reads = heldReads();
    const prompts: string[] = [];
    vi.mocked(createSharedPartialEffect).mockReturnValueOnce(
      Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => prompts.push("closed"))),
      ),
    );
    const { view } = setup({
      runtime: testRuntime(),
      zoteroReads: reads.zoteroReads,
    });
    const selecting = Effect.runPromiseExit(
      view.selectItem({ id: FIRST, title: "First" }),
    );
    // An extraction run from outside the leaf still runs on it.
    const extracting = Effect.runPromiseExit(view.extractPartial("venue"));
    await vi.waitFor(() => expect(reads.started).toEqual([FIRST]));
    await view.close();
    await vi.waitFor(() => expect(reads.interrupted).toEqual([FIRST]));
    expect(prompts).toEqual(["closed"]);
    const extracted = await extracting;
    expect(
      Exit.isFailure(extracted) && Cause.hasInterruptsOnly(extracted.cause),
    ).toBe(true);
    // The selection stops quietly: unapplied, or interrupted with the leaf.
    const exit = await selecting;
    expect(
      Exit.isSuccess(exit) ? exit.value : !Cause.hasInterruptsOnly(exit.cause),
    ).toBe(false);
  });

  it("keeps a later selection over a chosen Item whose read still runs", async () => {
    // The read that confirms the chosen Item holds until the test lets it go.
    const firstRead = Promise.withResolvers<void>();
    const firstReading = Promise.withResolvers<void>();
    let gated = false;
    await using zoteroReads = inProcessReadsService(
      memoryOpener(() =>
        seedWorksSql([
          { itemID: 1, key: FIRST, title: "First paper" },
          { itemID: 2, key: LATER, title: "Later paper" },
        ]),
      ).open,
      {
        wrap: (client) => ({
          ...client,
          ItemsByIndexedKeys: ((
            payload: { readonly indexedKeys: readonly string[] },
            options?: object,
          ) => {
            const read = (
              client.ItemsByIndexedKeys as unknown as (
                payload: object,
                options?: object,
              ) => Effect.Effect<unknown>
            )(payload, options);
            return gated && payload.indexedKeys.includes(FIRST)
              ? Effect.andThen(
                  Effect.promise(() => {
                    firstReading.resolve();
                    return firstRead.promise;
                  }),
                  read,
                )
              : read;
          }) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
        }),
      },
    );
    const { reads } = zoteroReads;
    const items = await Effect.runPromise(
      reads.ItemsByIndexedKeys({ indexedKeys: [FIRST] }),
    );
    const first = items.get(FIRST)!;
    gated = true;
    const { view } = setup({
      runtime: testRuntime(),
      services: { zoteroReads },
      itemLookup: stubService<TemplateWorkbenchDeps["itemLookup"]>(
        "ItemLookup",
        {
          // The chooser lists the first paper among the recently updated Items.
          search: async () => [
            {
              item: first,
              matches: [],
              library: null,
              cited: false,
            },
          ],
          openSession: () => ({
            search: async () => [],
            close: () => {},
            [Symbol.dispose]() {},
          }),
        },
      ),
    });
    using open = vi.spyOn(SuggestModal.prototype, "open");

    const chosen = run(view.chooseItem());
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const modal = open.mock.contexts[0] as SuggestModal<{ id: string }>;
    const rows = await modal.getSuggestions("");
    modal.selectSuggestion(
      rows.find((row) => row.id === FIRST)!,
      new KeyboardEvent("keydown", { key: "Enter" }),
    );
    modal.close();
    // The reader picks the later paper while the first choice still reads.
    await firstReading.promise;
    await expect(
      run(view.selectItem({ id: LATER, title: "Later paper" })),
    ).resolves.toBe(true);
    firstRead.resolve();

    // The chooser's Item was the choice; the later one replaced it.
    await expect(chosen).resolves.toBe(true);
    expect(viewState(view).item).toMatchObject({ id: LATER });
    await vi.waitFor(() =>
      expect(view.registry.get(view.model.read).status).toBe("ready"),
    );
    expect(view.registry.get(view.model.title)).toContain("Later paper");
  });
  it("closes the Zotero search when the view closes while it is open", async () => {
    const { view } = setup({
      runtime: testRuntime(),
      itemLookup: stubService<TemplateWorkbenchDeps["itemLookup"]>(
        "ItemLookup",
        {
          search: async () => [],
          openSession: () => ({
            search: async () => [],
            close: () => {},
            [Symbol.dispose]() {},
          }),
        },
      ),
    });
    using open = vi.spyOn(SuggestModal.prototype, "open");
    using close = vi.spyOn(SuggestModal.prototype, "close");
    const chosen = Effect.runPromiseExit(view.chooseItem());
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const chooser = open.mock.contexts[0] as SuggestModal<{ id: string }>;
    chooser.selectSuggestion(
      (await chooser.getSuggestions("")).find(
        (row) => row.id === "search-zotero",
      )!,
      new KeyboardEvent("keydown", { key: "Enter" }),
    );
    // The Zotero search opens in its own picker.
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    const picker = open.mock.contexts[1];
    await view.close();
    await vi.waitFor(() => expect(close.mock.contexts).toContain(picker));
    const exit = await chosen;
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
  });
});

// #1945: the Preview is a side panel of the one view, which the reader shows,
// hides and widens, and which the workspace saves with the view.
describe("the side panels of the Template Workbench View", () => {
  const actionOf = (view: TemplateWorkbenchView, title: string) =>
    (view as unknown as MockItemView).actions.find(
      (element) => element.getAttribute("aria-label") === title,
    )!;
  // A region names itself through `aria-labelledby`: Obsidian draws an
  // `aria-label` as a hover tooltip over the whole region.
  const region = (view: TemplateWorkbenchView, name: string) =>
    [...view.contentEl.querySelectorAll<HTMLElement>("[role=region]")].find(
      (element) => {
        const nameId = element.getAttribute("aria-labelledby");
        return (
          !element.hasAttribute("aria-label") &&
          nameId !== null &&
          element.querySelector(`[id="${nameId}"]`)?.textContent === name
        );
      },
    ) ?? null;
  const handleOf = (view: TemplateWorkbenchView, name: string) =>
    [...view.contentEl.querySelectorAll<HTMLElement>("[role=separator]")].find(
      (element) => element.getAttribute("aria-label") === name,
    )!;
  const press = (element: HTMLElement, key: string) =>
    act(async () => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });

  it("shows and hides the Preview panel from its pressed view action", async () => {
    const { view } = setup();
    await act(async () => view.open());
    const show = actionOf(view, m.workbench_show_preview());
    // The eye names what the action shows; its pressed state says it is shown.
    expect(show.dataset.icon).toBe("eye");
    expect(show.getAttribute("aria-pressed")).toBe("false");
    expect(region(view, m.workbench_view_preview())).toBeNull();
    await act(async () => show.click());
    expect(show.getAttribute("aria-pressed")).toBe("true");
    expect(region(view, m.workbench_view_preview())).not.toBeNull();
    await act(async () => show.click());
    expect(show.getAttribute("aria-pressed")).toBe("false");
    expect(region(view, m.workbench_view_preview())).toBeNull();
    await act(async () => view.close());
  });

  it("resizes the Preview panel from the keyboard within its limits", async () => {
    const { view } = setup();
    await act(async () => view.open());
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    const handle = handleOf(view, m.workbench_preview_resize());
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    const width = () => Number(handle.getAttribute("aria-valuenow"));
    const initial = width();
    // The Preview sits on the right, so moving its edge left widens it.
    await press(handle, "ArrowLeft");
    expect(width()).toBeGreaterThan(initial);
    // A window splitter's Home is the smallest panel and End the largest.
    await press(handle, "Home");
    expect(width()).toBe(Number(handle.getAttribute("aria-valuemin")));
    await press(handle, "End");
    expect(width()).toBe(Number(handle.getAttribute("aria-valuemax")));
    await act(async () => view.close());
  });

  it("restores the panel's visibility and width with the view state", async () => {
    const original = setup();
    await act(async () => original.view.open());
    await act(async () =>
      actionOf(original.view, m.workbench_show_preview()).click(),
    );
    await press(
      handleOf(original.view, m.workbench_preview_resize()),
      "ArrowLeft",
    );
    const width = handleOf(
      original.view,
      m.workbench_preview_resize(),
    ).getAttribute("aria-valuenow");
    const saved = original.view.getState();
    await act(async () => original.view.close());
    const restored = setup();
    await act(async () => restored.view.setState(saved, { history: false }));
    await act(async () => restored.view.open());
    expect(region(restored.view, m.workbench_view_preview())).not.toBeNull();
    expect(
      handleOf(restored.view, m.workbench_preview_resize()).getAttribute(
        "aria-valuenow",
      ),
    ).toBe(width);
    expect(
      actionOf(restored.view, m.workbench_show_preview()).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(restored.view.getState()).toEqual(saved);
    await act(async () => restored.view.close());
  });

  // A ResizeObserver hears only the window it was made in, so a tab moved to
  // another window watches its size from there (#1952).
  it("measures the leaf from the window its tab moves to", async () => {
    using migration = windowMigration();
    const { view } = setup();
    await act(async () => view.open());
    // The box under the item row, which the panels and the editor share.
    const box = view.contentEl.querySelector("[data-workbench-panels]")!;
    expect(box).not.toBeNull();
    const size = { width: 1200, height: 800 };
    for (const [name, axis] of [
      ["clientWidth", "width"],
      ["clientHeight", "height"],
    ] as const)
      Object.defineProperty(box, name, {
        configurable: true,
        get: () => size[axis],
      });
    let resized: (() => void) | null = null;
    const observed: Element[] = [];
    class PopoutResizeObserver {
      constructor(listener: () => void) {
        resized = listener;
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() {}
    }
    // The window the tab lands in brings its own observer.
    vi.stubGlobal("ResizeObserver", PopoutResizeObserver);
    await act(async () => migration.move(window));
    vi.unstubAllGlobals();
    expect(observed).toEqual([box]);
    size.width = 520;
    await act(async () => resized?.());
    expect(view.registry.get(view.viewSize)).toMatchObject({
      width: 520,
      height: 800,
    });
    await act(async () => view.close());
  });

  // #1954: the leaf's size places the Preview; it never changes what shows.
  it("puts the Preview under a narrow leaf and beside a wide one, keeping the saved panels", async () => {
    const { view } = setup();
    await act(async () => view.open());
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    const saved = view.getState();
    await act(async () =>
      view.registry.set(view.viewSize, { width: 560, height: 800 }),
    );
    const split = handleOf(view, m.workbench_preview_resize());
    expect(split.getAttribute("aria-orientation")).toBe("horizontal");
    expect(region(view, m.workbench_view_preview())).not.toBeNull();
    await act(async () =>
      view.registry.set(view.viewSize, { width: 1200, height: 800 }),
    );
    expect(
      handleOf(view, m.workbench_preview_resize()).getAttribute(
        "aria-orientation",
      ),
    ).toBe("vertical");
    expect(view.getState()).toEqual(saved);
    await act(async () => view.close());
  });

  it("restores the Preview's height under the editor with the view state", async () => {
    const original = setup();
    await act(async () => original.view.open());
    await act(async () =>
      actionOf(original.view, m.workbench_show_preview()).click(),
    );
    await act(async () =>
      original.view.registry.set(original.view.viewSize, {
        width: 560,
        height: 800,
      }),
    );
    await press(
      handleOf(original.view, m.workbench_preview_resize()),
      "ArrowUp",
    );
    const saved = original.view.getState();
    await act(async () => original.view.close());
    const restored = setup();
    await act(async () => restored.view.setState(saved, { history: false }));
    await act(async () => restored.view.open());
    await act(async () =>
      restored.view.registry.set(restored.view.viewSize, {
        width: 560,
        height: 800,
      }),
    );
    expect(
      handleOf(restored.view, m.workbench_preview_resize()).getAttribute(
        "aria-valuenow",
      ),
    ).toBe("45");
    await act(async () => restored.view.close());
  });
  const paneMenuOf = (view: TemplateWorkbenchView) => {
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    return menu;
  };
  const paneMenu = (view: TemplateWorkbenchView) => paneMenuOf(view).items;
  /** The entry `title` of the pane menu, or of a submenu under it. */
  const entry = (view: TemplateWorkbenchView, title: string) =>
    menuEntries(paneMenuOf(view)).find((item) => item.title === title);

  // #1962: the most-used entries lead, the rare ones wait in a submenu, and
  // every view action is in the menu for a reader who hides the header.
  it("leads the pane menu with the view's own actions, and folds the rare ones away", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () => view.togglePreview());
    setViewItem(view, { id: "PAPER001g42", title: "Paper" });
    await act(async () =>
      view.registry.set(view.viewSize, { width: 1200, height: 800 }),
    );
    const items = paneMenu(view);
    expect(
      items
        .filter((item) => item.section === MENU_SECTION.pane)
        .map((item) => item.title),
    ).toEqual([
      m.workbench_show_fields(),
      m.workbench_show_preview(),
      m.workbench_choose_item(),
      m.workbench_choose_annotation(),
      m.workbench_view_preview(),
      m.workbench_advanced(),
      m.workbench_undo(),
      m.workbench_redo(),
    ]);
    expect(
      items
        .filter((item) => item.section === MENU_SECTION.action)
        .map((item) => item.title),
      // The pane edges size the panels, so the menu holds no sizes.
    ).toEqual([
      m.template_data_explorer_menu_export_json(),
      m.workbench_help(),
    ]);
    // Nothing is left to undo in a document just opened.
    expect(entry(view, m.workbench_undo())?.disabled).toBe(true);
    const preview = entry(view, m.workbench_view_preview())!;
    expect(preview.submenu?.items.map((item) => item.title)).toEqual([
      m.workbench_preview_as_new_note(),
      m.workbench_preview_as_updated_note(),
      m.workbench_preview_updated_section(),
      m.workbench_preview_auto_refresh(),
      m.workbench_show_markdown(),
      m.workbench_refresh_item(),
    ]);
    // The Help submenu lists what the Help view action opens.
    expect(
      entry(view, m.workbench_help())?.submenu?.items.map((item) => item.title),
    ).toEqual([
      m.workbench_docs_guide(),
      m.workbench_docs_note(),
      m.workbench_docs_data(),
      m.workbench_problems_community(),
    ]);
    // The Source entry is the view action's own toggle.
    expect(entry(view, m.workbench_advanced())?.checked).toBe(false);
    await act(async () => entry(view, m.workbench_advanced())!.click());
    expect(viewState(view).advanced).toBe(true);
    expect(entry(view, m.workbench_advanced())?.checked).toBe(true);
  });

  it("opens the docs from the Help view action", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    const actions = (view as unknown as MockItemView).actions.map((element) =>
      element.getAttribute("aria-label"),
    );
    // The item row holds the item's chooser; the header holds Help.
    expect(actions).toContain(m.workbench_help());
    expect(actions).not.toContain(m.workbench_choose_item());
    const before = Menu.instances.length;
    await act(async () => actionOf(view, m.workbench_help()).click());
    const menu = Menu.instances[before]!;
    expect(menu.items.map((item) => item.title)).toEqual([
      m.workbench_docs_guide(),
      m.workbench_docs_note(),
      m.workbench_docs_data(),
      m.workbench_problems_community(),
    ]);
    expect(menu.position).not.toBeNull();
  });

  it("shows the editor's own render of the chosen Item in the Preview panel", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          creationBody: "A rendered paper note",
        }),
    });
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () =>
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false }),
    );
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    await act(async () => entry(view, m.workbench_show_markdown())!.click());
    const attempt = renderState(view).attempt;
    await act(async () => {
      runRender(view);
      await vi.waitFor(() =>
        expect(renderState(view).attempt).toBeGreaterThan(attempt),
      );
    });
    const panel = region(view, m.workbench_view_preview())!;
    expect(panel.querySelector("h2")?.textContent).toBe(
      m.workbench_result_heading(),
    );
    // The view's one item row names the Item; the panel's head holds only
    // what is the Preview's own.
    const title = SAMPLE_ITEMS[0]!.item.title!;
    expect(panel.textContent).not.toContain(title);
    expect(
      view.contentEl.textContent.split(
        m.workbench_example_title({ name: title }),
      ),
    ).toHaveLength(2);
    expect(panel.textContent).toContain(m.workbench_preview_on_demand());
    expect(panel.textContent).toContain("A rendered paper note");
  });

  // #1962: the Preview pane has its own actions, as a view header has.
  it("switches the Preview between reading view and Markdown from its header, and opens its settings there", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          creationBody: "A rendered paper note",
        }),
    });
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () =>
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false }),
    );
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    const header = () =>
      region(view, m.workbench_view_preview())!.querySelector<HTMLElement>(
        "[data-workbench-preview-header]",
      )!;
    const action = (label: string) =>
      [...header().querySelectorAll<HTMLElement>("[aria-label]")].find(
        (element) => element.getAttribute("aria-label") === label,
      );
    // The header row names its pane, and leaves the tooltips to its actions.
    expect(header().hasAttribute("aria-label")).toBe(false);
    // The toggle names what a press does, as Obsidian's own does.
    expect(
      action(m.workbench_show_markdown())!.querySelector(".lucide-code"),
    ).not.toBeNull();
    await act(async () => action(m.workbench_show_markdown())!.click());
    expect(view.registry.get(view.workbench.preview).showMarkdown).toBe(true);
    expect(action(m.workbench_show_markdown())).toBeUndefined();
    expect(
      action(m.workbench_show_reading_view())!.querySelector(
        ".lucide-book-open",
      ),
    ).not.toBeNull();
    await act(async () => action(m.workbench_show_reading_view())!.click());
    expect(view.registry.get(view.workbench.preview).showMarkdown).toBe(false);
    // More options lists the settings the view's Preview submenu holds.
    const before = Menu.instances.length;
    await act(async () => action(m.workbench_pane_more_options())!.click());
    const menu = Menu.instances[before]!;
    expect(menu.position).not.toBeNull();
    expect(menu.items.map((item) => item.title)).toEqual(
      entry(view, m.workbench_view_preview())?.submenu?.items.map(
        (item) => item.title,
      ),
    );
    expect(menu.items.map((item) => item.title)).toContain(
      m.workbench_show_markdown(),
    );
  });

  it("offers the Preview's settings in the pane menu while the panel shows, and saves them", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    expect(entry(view, m.workbench_preview_auto_refresh())).toBeUndefined();
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    expect(entry(view, m.workbench_show_preview())?.checked).toBe(true);
    const choices = [
      m.workbench_preview_as_new_note(),
      m.workbench_preview_as_updated_note(),
      m.workbench_preview_updated_section(),
      m.workbench_preview_auto_refresh(),
      m.workbench_show_markdown(),
    ];
    // In the Preview submenu, which sits among the display choices.
    expect(entry(view, m.workbench_view_preview())?.section).toBe("pane");
    expect(
      entry(view, m.workbench_view_preview())?.submenu?.items.map(
        (item) => item.title,
      ),
    ).toEqual(expect.arrayContaining(choices));
    expect(entry(view, m.workbench_preview_as_new_note())?.checked).toBe(true);
    expect(entry(view, m.workbench_preview_auto_refresh())?.checked).toBe(true);
    await act(async () =>
      entry(view, m.workbench_preview_as_updated_note())!.click(),
    );
    await act(async () =>
      entry(view, m.workbench_preview_auto_refresh())!.click(),
    );
    expect(entry(view, m.workbench_preview_as_updated_note())?.checked).toBe(
      true,
    );
    expect(entry(view, m.workbench_preview_auto_refresh())?.checked).toBe(
      false,
    );
    const saved = view.getState();
    const restored = setup();
    cleanup.defer(() => act(async () => restored.view.close()));
    await act(async () => restored.view.setState(saved, { history: false }));
    expect(restored.view.registry.get(restored.view.workbench.preview)).toEqual(
      {
        mode: "update",
        live: false,
        showMarkdown: false,
        showManaged: false,
      },
    );
  });

  it("restores the reader's choices from a view an older build saved", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup();
    cleanup.defer(() => act(async () => view.close()));
    // The shape the build before one owner for the choices wrote.
    await act(async () =>
      view.setState(
        {
          file: "Templates/Profile.md",
          tab: "note",
          itemIndexedKey: null,
          annotationId: "example:underline",
          variant: "alt",
          citationExample: null,
          advanced: false,
          preview: {
            mode: "update",
            live: false,
            showMarkdown: true,
            showManaged: false,
          },
        },
        { history: false },
      ),
    );
    expect(view.registry.get(view.workbench.choices)).toMatchObject({
      annotationId: "example:underline",
      variant: "alt",
      citationExample: null,
      preview: {
        mode: "update",
        live: false,
        showMarkdown: true,
        showManaged: false,
      },
    });
    expect(view.registry.get(view.workbench.examples).example?.id).toBe(
      "example:underline",
    );
  });

  // Story 17: what the Preview's render finds is the editor's own problem.
  it("opens the editor's Problems area on a failed Run from the Preview panel", async () => {
    await using cleanup = new AsyncDisposableStack();
    const { view } = setup({
      runtime: testRuntime(),
      render: (request) =>
        Effect.succeed({
          ...emptyRender(renderIdentity(request)),
          diagnostics: [
            {
              code: "missing-partial",
              part: "render",
              params: { name: "venue-line" },
            },
          ],
        }),
    });
    cleanup.defer(() => act(async () => view.close()));
    await act(async () => view.open());
    await act(async () =>
      chooseSample(view, SAMPLE_ITEMS[0]!, { live: false }),
    );
    await act(async () => actionOf(view, m.workbench_show_preview()).click());
    const toggle = () =>
      [...view.contentEl.querySelectorAll<HTMLElement>("[aria-expanded]")].find(
        (button) =>
          button.getAttribute("aria-label") === m.workbench_problem_show() ||
          button.getAttribute("aria-label") === m.workbench_problems_return(),
      )!;
    const run = [
      ...region(view, m.workbench_view_preview())!.querySelectorAll("button"),
    ].find((button) => button.textContent === m.workbench_preview_run())!;
    const attempt = renderState(view).attempt;
    await act(async () => {
      run.click();
      await vi.waitFor(() =>
        expect(renderState(view).attempt).toBeGreaterThan(attempt),
      );
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(view.contentEl.textContent).toContain(
      m.workbench_problems_object_partial({ name: "venue-line" }),
    );
  });
});

// #1943: Fields is the left side panel of the one view. It reads the view's
// own Item and root, and inserts a field straight into the editor.
describe("the Fields panel of the Template Workbench View", () => {
  // The panel's key hint names Mod+Enter as the platform does.
  beforeEach(() => setMockPlatform({ isMacOS: false }));
  afterEach(resetMockPlatform);
  const actionOf = (view: TemplateWorkbenchView, title: string) =>
    (view as unknown as MockItemView).actions.find(
      (element) => element.getAttribute("aria-label") === title,
    )!;
  /** The Fields popover, which stands on the body while it is open. */
  const fields = (_view: TemplateWorkbenchView) =>
    document.querySelector<HTMLElement>('.zt-pinned-popover [role="dialog"]');
  const openFields = (view: TemplateWorkbenchView) =>
    view.registry.set(view.workbench.fieldsPanel, "open");
  /**
   * Opens the view in the document with its actions: the Fields popover
   * opens from the Fields action, which Obsidian keeps in the view header.
   */
  const openView = async (view: ReturnType<typeof setup>["view"]) => {
    await view.open();
    document.body.append(
      view.contentEl,
      ...(view as unknown as MockItemView).actions,
    );
  };

  it("opens and closes the Fields popover from its view action and the pane menu, at every width", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    const show = actionOf(view, m.workbench_view_fields());
    expect(show.getAttribute("aria-haspopup")).toBe("dialog");
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(fields(view)).toBeNull();
    for (const width of [320, 1200]) {
      await act(async () =>
        view.registry.set(view.viewSize, { width, height: 800 }),
      );
      await act(async () => show.click());
      expect(show.getAttribute("aria-expanded")).toBe("true");
      const popover = fields(view)!;
      // A popover, not a modal: the view under it stays in reach.
      expect(popover.hasAttribute("aria-modal")).toBe(false);
      expect(view.contentEl.querySelector("[inert]")).toBeNull();
      expect(show.getAttribute("aria-controls")).toBe(popover.id);
      await act(async () => show.click());
      expect(fields(view)).toBeNull();
    }
    await act(async () => show.click());
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    const entry = menu.items.find(
      (item) => item.title === m.workbench_show_fields(),
    );
    expect(entry?.checked).toBe(true);
    await act(async () => entry?.click());
    expect(fields(view)).toBeNull();
    expect(show.getAttribute("aria-expanded")).toBe("false");
    // The popover is view state, never saved.
    expect(JSON.stringify(view.getState())).not.toContain("fieldsPanel");
    await act(async () => view.close());
  });

  it("pins the Fields Panel beside the editor, and restores its pin, hidden state and width with the view state", async () => {
    const original = setup();
    await act(async () => openView(original.view));
    /** The docked panel's region, which its visible title names. */
    const docked = (view: TemplateWorkbenchView) => {
      const region = view.contentEl.querySelector<HTMLElement>(
        '[data-panel="fields"][role="region"]',
      );
      const title = region?.getAttribute("aria-labelledby");
      return region &&
        title &&
        view.contentEl.ownerDocument.getElementById(title)?.textContent ===
          m.workbench_view_fields()
        ? region
        : null;
    };
    const edge = (view: TemplateWorkbenchView) =>
      [
        ...view.contentEl.querySelectorAll<HTMLElement>("[role=separator]"),
      ].find(
        (element) =>
          element.getAttribute("aria-label") === m.workbench_fields_resize(),
      ) ?? null;
    await act(async () =>
      original.view.registry.set(original.view.viewSize, {
        width: 1200,
        height: 800,
      }),
    );
    const show = actionOf(original.view, m.workbench_view_fields());
    await act(async () => show.click());
    const pin = [...fields(original.view)!.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_fields_pin(),
    )!;
    await act(async () => pin.click());
    expect(fields(original.view)).toBeNull();
    expect(docked(original.view)).not.toBeNull();
    expect(show.getAttribute("aria-expanded")).toBe("true");
    expect(show.getAttribute("aria-controls")).toBe(docked(original.view)!.id);
    // The edge of a column at the leading edge widens it with ArrowRight.
    const handle = edge(original.view)!;
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("336");
    const pinned = original.view.getState();
    // The action hides the docked panel and keeps its pin.
    await act(async () => show.click());
    expect(docked(original.view)).toBeNull();
    expect(show.getAttribute("aria-expanded")).toBe("false");
    const hidden = original.view.getState();
    await act(async () => original.view.close());

    const restored = setup();
    await act(async () => restored.view.setState(pinned, { history: false }));
    await act(async () => openView(restored.view));
    expect(docked(restored.view)).not.toBeNull();
    expect(edge(restored.view)!.getAttribute("aria-valuenow")).toBe("336");
    expect(restored.view.getState()).toEqual(pinned);
    await act(async () => restored.view.close());

    const again = setup();
    await act(async () => again.view.setState(hidden, { history: false }));
    await act(async () => openView(again.view));
    expect(docked(again.view)).toBeNull();
    await act(async () =>
      actionOf(again.view, m.workbench_view_fields()).click(),
    );
    expect(docked(again.view)).not.toBeNull();
    expect(edge(again.view)!.getAttribute("aria-valuenow")).toBe("336");
    await act(async () => again.view.close());
  });

  it("hands focus to the Fields action when a narrower leaf takes the docked panel that held it", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    await act(async () =>
      view.registry.set(view.viewSize, { width: 1200, height: 800 }),
    );
    const show = actionOf(view, m.workbench_view_fields());
    await act(async () => show.click());
    const pin = [...fields(view)!.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_fields_pin(),
    )!;
    await act(async () => pin.click());
    const dock = view.contentEl.querySelector<HTMLElement>(
      '[data-panel="fields"]',
    )!;
    expect(dock.contains(document.activeElement)).toBe(true);
    await act(async () =>
      view.registry.set(view.viewSize, { width: 560, height: 800 }),
    );
    expect(view.contentEl.querySelector('[data-panel="fields"]')).toBeNull();
    expect(document.activeElement).toBe(show);
    await act(async () => view.close());
  });

  it("closes the Fields popover on Escape", async () => {
    const { view, app } = setup();
    await act(async () => openView(view));
    const show = actionOf(view, m.workbench_view_fields());
    await act(async () => show.click());
    expect(fields(view)).not.toBeNull();
    const { scopes } = app as unknown as { scopes: Scope[] };
    await act(async () => {
      dispatchKey(scopes.at(-1)!, { key: "Escape" }, fields(view)!);
    });
    expect(fields(view)).toBeNull();
    expect(show.getAttribute("aria-expanded")).toBe("false");
    await act(async () => view.close());
  });

  it("closes the Fields popover on a press outside it", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    const show = actionOf(view, m.workbench_view_fields());
    await act(async () => show.click());
    await act(async () => {
      view.contentEl.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(fields(view)).toBeNull();
    expect(show.getAttribute("aria-expanded")).toBe("false");
    await act(async () => view.close());
  });

  const insertButtons = (panel: HTMLElement) =>
    [...panel.querySelectorAll<HTMLElement>('[role="button"]')].filter(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_fields_put_in_note(),
    );

  it("shows the fields of the Item the editor chose, and follows a new choice", async () => {
    const { view } = setup();
    const [first, second] = SAMPLE_ITEMS;
    await act(async () => openView(view));
    await act(async () => openFields(view));
    await act(async () => chooseSample(view, first!));
    await vi.waitFor(() =>
      expect(fields(view)?.textContent).toContain(first!.item.title),
    );
    await act(async () => chooseSample(view, second!));
    await vi.waitFor(() =>
      expect(fields(view)?.textContent).toContain(second!.item.title),
    );
    expect(fields(view)?.textContent).not.toContain(first!.item.title);
    await act(async () => view.close());
  });

  it("follows the editor's root, and keeps the root the reader moved to until the editor's root changes", async () => {
    const { view } = setup();
    // The conference paper carries annotations of its own.
    const paper = SAMPLE_ITEMS[1]!;
    await act(async () => openView(view));
    await act(async () => openFields(view));
    await act(async () => chooseSample(view, paper));
    const back = () =>
      [...fields(view)!.querySelectorAll<HTMLElement>("[aria-label]")].find(
        (button) =>
          button.getAttribute("aria-label") ===
          m.template_data_explorer_back_to_note_root(),
      );
    await vi.waitFor(() =>
      expect(fields(view)?.textContent).toContain(paper.item.title),
    );
    expect(back()).toBeUndefined();
    await act(async () => view.change.setRoot("annotation"));
    await vi.waitFor(() => expect(back()).toBeDefined());
    await act(async () => back()!.click());
    expect(back()).toBeUndefined();
    // The editor keeps its own root.
    expect(viewState(view).root).toBe("annotation");
    // A new editor root drops the root the reader moved to, for good.
    await act(async () => view.change.setRoot("filename"));
    expect(view.registry.get(view.fields.root)).toBe("filename");
    await act(async () => view.change.setRoot("annotation"));
    expect(view.registry.get(view.fields.root)).toBe("annotation");
    expect(back()).toBeDefined();
    // So does a new Item.
    await act(async () => back()!.click());
    expect(view.registry.get(view.fields.root)).toBe("note");
    await act(async () => chooseSample(view, SAMPLE_ITEMS[0]!));
    expect(view.registry.get(view.fields.root)).toBe("annotation");
    await act(async () => view.close());
  });

  it("shows the annotation the editor chose on its Annotation root", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    await act(async () => openFields(view));
    await act(async () => chooseSample(view, SAMPLE_ITEMS[1]!));
    await act(async () => view.change.setRoot("annotation"));
    await vi.waitFor(() =>
      expect(fields(view)?.textContent).toContain("CNPAN26A"),
    );
    const { current } = view.registry.get(view.workbench.examples);
    await act(async () =>
      view.registry.update(view.workbench.choices, (picks) => ({
        ...picks,
        annotationId: current[1]!.id,
      })),
    );
    await vi.waitFor(() =>
      expect(fields(view)?.textContent).toContain("CNPVL26A"),
    );
    expect(fields(view)?.textContent).not.toContain("CNPAN26A");
    await act(async () => view.close());
  });

  it("lists the Citation example set and Variant the editor chose on the Citation root", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    await act(async () => view.change.setRoot("citation"));
    const data = () => view.registry.get(view.fields.state).data;
    await act(async () =>
      view.registry.update(view.workbench.choices, (picks) => ({
        ...picks,
        variant: "alt" as const,
        citationExample: "two-items" as const,
      })),
    );
    expect(data()).toMatchObject({ variant: "alt" });
    expect(data()!["citations"]).toHaveLength(2);
    // With no example set, the chosen Item's own one-item set stands.
    await act(async () => {
      view.registry.update(view.workbench.choices, (picks) => ({
        ...picks,
        citationExample: null,
      }));
      chooseSample(view, SAMPLE_ITEMS[0]!);
    });
    await vi.waitFor(() => expect(data()!["citations"]).toHaveLength(1));
    expect(data()).toMatchObject({ variant: "alt" });
    await act(async () => view.close());
  });

  it("names an unavailable Item with its message", async () => {
    const { view } = setup();
    await act(async () => openView(view));
    await act(async () =>
      setViewItem(view, { id: "sample:missing", title: null }),
    );
    await vi.waitFor(() =>
      expect(view.registry.get(view.fields.state)).toMatchObject({
        status: "error",
        error: m.workbench_example_missing_item(),
      }),
    );
    await act(async () => view.close());
  });

  // #1962: the Fields pane has its own More options, beside its pin.
  it("opens the Fields pane's own More options from its header", async () => {
    await using zoteroReads = inProcessReadsService(
      memoryOpener(() =>
        seedWorksSql([{ itemID: 1, key: "FIRST234", title: "First paper" }]),
      ).open,
    );
    const { view } = setup({
      runtime: testRuntime(),
      services: { zoteroReads },
      pluginVersion: "2.1.3",
    });
    document.body.append(view.contentEl);
    try {
      await act(async () => openView(view));
      await act(async () => openFields(view));
      const more = () =>
        [...fields(view)!.querySelectorAll<HTMLElement>("[aria-label]")].find(
          (element) =>
            element.getAttribute("aria-label") ===
            m.workbench_pane_more_options(),
        );
      const open = async () => {
        const before = Menu.instances.length;
        await act(async () => more()!.click());
        const menu = Menu.instances[before]!;
        expect(menu.position).not.toBeNull();
        return menu;
      };
      // With no Item yet, the menu offers to choose one.
      expect((await open()).items.map((item) => item.title)).toEqual([
        m.workbench_choose_item(),
      ]);
      await act(async () =>
        setViewItem(view, { id: "FIRST234", title: "First paper" }),
      );
      await vi.waitFor(async () => {
        const menu = await open();
        expect(menu.sections).toEqual([MENU_SECTION.action, MENU_SECTION.info]);
        expect(menu.items.map((item) => [item.section, item.title])).toEqual([
          [MENU_SECTION.action, m.workbench_choose_item()],
          [MENU_SECTION.action, m.template_data_explorer_menu_export_json()],
          [MENU_SECTION.info, m.command_copy_item_key_name()],
        ]);
      });
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
  });

  it("exports the root the panel shows", async () => {
    await using zoteroReads = inProcessReadsService(
      memoryOpener(() =>
        seedWorksSql([{ itemID: 1, key: "FIRST234", title: "First paper" }]),
      ).open,
    );
    const { view } = setup({
      runtime: testRuntime(),
      services: { zoteroReads },
      pluginVersion: "2.1.3",
    });
    document.body.append(view.contentEl);
    try {
      await act(async () => openView(view));
      await act(async () => {
        openFields(view);
        setViewItem(view, { id: "FIRST234", title: "First paper" });
        view.change.setRoot("annotation");
      });
      const back = () =>
        [...fields(view)!.querySelectorAll<HTMLElement>("[aria-label]")].find(
          (button) =>
            button.getAttribute("aria-label") ===
            m.template_data_explorer_back_to_note_root(),
        );
      await vi.waitFor(() => expect(back()).toBeDefined());
      const exportEntry = () => {
        const menu = new Menu();
        view.onPaneMenu(menu as never, "more-options");
        return menuEntries(menu).find((item) => item.icon === "file-json");
      };
      // The paper has no annotations, so its own data stands in.
      await vi.waitFor(() =>
        expect(exportEntry()?.title).toBe(
          m.template_data_explorer_export_selected_paper(),
        ),
      );
      await act(async () => back()!.click());
      expect(viewState(view).root).toBe("annotation");
      using set = vi.spyOn(view.registry, "set");
      const entry = exportEntry()!;
      expect(entry.title).toBe(m.template_data_explorer_menu_export_json());
      entry.click();
      expect(set).toHaveBeenCalledWith(expect.anything(), {
        indexedKey: "FIRST234",
        root: "note",
        pluginVersion: "2.1.3",
      });
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
  });

  it("inserts a field from its row at the editor's caret, and closes the Fields popover", async () => {
    const { view } = setup();
    document.body.append(view.contentEl);
    try {
      await act(async () => openView(view));
      await act(async () => chooseSample(view, SAMPLE_ITEMS[0]!));
      // The reader places the caret, then opens the Fields popover.
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      await act(async () => openFields(view));
      await vi.waitFor(() =>
        expect(fields(view)?.textContent).toContain(
          SAMPLE_ITEMS[0]!.item.title,
        ),
      );
      const title = insertButtons(fields(view)!).find(
        (button) =>
          button
            .closest("[data-workbench-field]")
            ?.getAttribute("data-workbench-field") === "title",
      );
      expect(title).toBeDefined();
      await act(async () => title!.click());
      expect(view.getViewData()).toContain("A s{{ zt.title }}table note.");
      // The insert closes the Fields popover.
      expect(fields(view)).toBeNull();
    } finally {
      await act(async () => view.close());
      view.contentEl.remove();
    }
  });

  it("keeps the Fields popover, its Insert button and the focus on a Shift insert", async () => {
    const { view } = setup();
    try {
      await act(async () => openView(view));
      await act(async () => chooseSample(view, SAMPLE_ITEMS[0]!));
      const editor = EditorView.findFromDOM(
        view.contentEl.querySelector(".cm-editor")!,
      )!;
      await act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      await act(async () => openFields(view));
      const title = () =>
        insertButtons(fields(view)!).find(
          (button) =>
            button
              .closest("[data-workbench-field]")
              ?.getAttribute("data-workbench-field") === "title",
        );
      await vi.waitFor(() => expect(title()).toBeDefined());
      const button = title()!;
      await act(async () => button.focus());
      await act(async () => {
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: true }),
        );
      });
      expect(view.getViewData()).toContain("A s{{ zt.title }}table note.");
      // The row keeps its Insert button, and the button keeps the focus.
      expect(fields(view)).not.toBeNull();
      expect(title()).toBe(button);
      expect(document.activeElement).toBe(button);
      // The next field goes after the first.
      await act(async () => {
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: true }),
        );
      });
      expect(view.getViewData()).toContain(
        "A s{{ zt.title }}{{ zt.title }}table note.",
      );
    } finally {
      await act(async () => view.close());
    }
  });
});
