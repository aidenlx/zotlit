import "./style.css";
// Each Preview owns its inputs, render work, data, and output presentation.
import { ItemView } from "obsidian";
import type { ViewStateResult } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { isChildItemFields, parseIndexedKey } from "@zotlit/db";
import {
  createRenderScheduler,
  TABS,
  PreviewControls,
  ResultColumn,
  PropertiesResult,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useRenderState,
} from "@zotlit/workbench/ui";
import type { RenderScheduler, WorkbenchHost } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { openSettingsTab } from "@/lib/open-settings";
import { pickItem } from "@/services/item-lookup/search-modal";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import { currentProfileSource } from "@/views/profile-editor/source";
import { profileEditorTheme } from "@/views/profile-editor/theme";
import type {
  ProfileEditorView,
  ProfileAuthoringContext,
} from "@/views/profile-editor/view";

import { PreviewAnnotationSelection } from "./annotation-selection";
import { NativeMarkdown } from "./markdown";
import {
  activeProfileEditor,
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveProfileEditor,
} from "./register";
import { nativeResult, renderNativeProfile } from "./render";
import type { NativeRenderDeps, NativeRenderResult } from "./render";
import { createNativePreviewStore, NativePreviewSession } from "./session";

export interface PreviewViewDeps extends NativeRenderDeps {
  settings: SettingsService;
  itemLookup: Pick<ItemLookup, "search">;
  profile: Pick<ProfileService, "getBuiltInSource">;
}

export const NOTE_PREVIEW_VIEW_TYPE = "zotlit-note-preview";
export class NotePreviewView extends ItemView {
  readonly #pluginId: string;
  readonly #deps: PreviewViewDeps;
  readonly state = createNativePreviewStore();
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #editor: ProfileEditorView | null = null;
  #file: TFile | null = null;
  #sourceGeneration = 0;
  #choiceGeneration = 0;
  #session: NativePreviewSession | null = null;
  #scheduler: RenderScheduler<NativeRenderResult> | null = null;
  readonly #rendered = () => this.#restorePresentation();
  #host: (WorkbenchHost & Disposable) | null = null;
  constructor(leaf: WorkspaceLeaf, pluginId: string, deps: PreviewViewDeps) {
    super(leaf);
    this.#pluginId = pluginId;
    this.#deps = deps;
    this.contentEl.addClass("zt-root");
  }
  override getViewType(): string {
    return NOTE_PREVIEW_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return m.profile_preview_name();
  }
  override getIcon(): string {
    return "eye";
  }
  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    cleanup.defer(registerCompanionHistory(this));
    cleanup.defer(() => {
      this.#root = null;
      this.#session = null;
      this.#scheduler = null;
      this.#host = null;
      this.#editor = null;
      this.#file = null;
      this.#sourceGeneration++;
    });
    const resources = cleanup.use(new DisposableStack());
    const deps = this.#deps;
    const scheduler = resources.use(
      createRenderScheduler({
        input: {
          source: this.state.getState().source ?? "",
          snapshot: null,
          ...this.state.getState().preview,
        },
        render: (request) => renderNativeProfile(deps, request),
        failed: nativeResult,
      }),
    );
    const session = resources.use(
      new NativePreviewSession(deps, scheduler, { state: this.state }),
    );
    const host = resources.use(
      createProfileEditorHost(this.app, {
        render: (request) => renderNativeProfile(deps, request),
        matchData: {
          tags: async () => [],
          collections: async () => [],
          libraries: async () => [],
        },
        insertTarget: () => null,
        markdown: (props) => (
          <NativeMarkdown
            {...props}
            app={this.app}
            result={scheduler.getState().result}
            onRendered={this.#rendered}
          />
        ),
      }),
    );
    this.#scheduler = scheduler;
    this.#session = session;
    this.#host = host;
    let persisted = JSON.stringify(this.getState());
    cleanup.defer(
      this.state.subscribe(() => {
        const next = JSON.stringify(this.getState());
        if (next === persisted) return;
        persisted = next;
        this.app.workspace.requestSaveLayout();
      }),
    );
    const scroll = () => {
      if (!this.state.getState().presentation.pending)
        this.state.setState({
          presentation: {
            scrollTop: this.contentEl.scrollTop,
            reveal: null,
            pending: false,
          },
        });
    };
    this.contentEl.addEventListener("scroll", scroll);
    cleanup.defer(() => this.contentEl.removeEventListener("scroll", scroll));
    this.#root = cleanup.adopt(createRoot(this.contentEl), (root) =>
      root.unmount(),
    );
    const contextEvent = this.app.workspace.on(
      "zotlit:authoring-context",
      (context) => {
        if (context.leaf === this.#editor?.leaf) this.#apply(context);
      },
    );
    cleanup.defer(() => this.app.workspace.offref(contextEvent));
    const sourceEvent = this.app.workspace.on(
      "quick-preview",
      (file, source) => {
        if (file === this.#file) {
          this.#sourceGeneration++;
          this.#session?.setSource(source);
        }
      },
    );
    cleanup.defer(() => this.app.workspace.offref(sourceEvent));
    const modify = this.app.vault.on("modify", (file) => {
      if (file === this.#file) void this.#readSource(this.#file);
    });
    cleanup.defer(() => this.app.vault.offref(modify));
    const rename = this.app.vault.on("rename", (file) => {
      const session = this.#session;
      const context = session?.state.getState().context;
      if (file !== this.#file || !session || !context) return;
      session.state.setState({ context: { ...context, path: file.path } });
      void this.#readSource(this.#file);
    });
    cleanup.defer(() => this.app.vault.offref(rename));
    const remove = this.app.vault.on("delete", (file) => {
      if (file !== this.#file) return;
      this.#sourceGeneration++;
      this.#file = null;
      this.#session?.state.setState({
        sourceProblem: m.settings_profile_document_missing({ path: file.path }),
      });
      this.#scheduler?.setInput({ hold: true });
    });
    cleanup.defer(() => this.app.vault.offref(remove));
    cleanup.defer(
      subscribeActiveProfileEditor(
        this.app,
        (editor) => {
          if (resources.disposed) return;
          this.#editor = editor;
          if (editor) this.#apply(editor.authoringContext);
          this.#mount();
        },
        this.leaf,
      ),
    );
    this.#cleanup = cleanup.move();
    if (!this.#editor) await this.#restoreSource();
  }
  override getState(): Record<string, unknown> {
    const state = this.state.getState();
    const context = state.context;
    return {
      source: context
        ? context.path === null
          ? { builtin: true }
          : { path: context.path }
        : null,
      item: state.item?.id ?? null,
      annotationId: state.annotationId,
      root: context?.root ?? "note",
      tab: context?.tab ?? "note",
      advanced: context?.advanced ?? false,
      ...state.preview,
      showMarkdown: state.showMarkdown,
      showManaged: state.showManaged,
    };
  }
  override async setState(
    input: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    const previous = JSON.stringify(this.getState());
    try {
      await this.#restoreState(input, result);
    } finally {
      if (previous !== JSON.stringify(this.getState())) result.history = true;
      onCompanionStateRestored(this.app, result, () => {
        if (!this.#cleanup) return;
        this.#editor = activeProfileEditor(this.app, this.leaf, this.#editor);
        if (this.#editor) this.#apply(this.#editor.authoringContext);
        this.#mount();
      });
    }
  }
  async #restoreState(input: unknown, result: ViewStateResult): Promise<void> {
    if (input && typeof input === "object" && Object.hasOwn(input, "source")) {
      const value = input as Record<string, unknown>;
      const source = value["source"] as {
        path?: unknown;
        builtin?: unknown;
      } | null;
      const path =
        source && typeof source.path === "string" ? source.path : null;
      const item =
        typeof value["item"] === "string"
          ? { id: value["item"], title: null }
          : null;
      const previous = this.state.getState();
      const context: ProfileAuthoringContext | null =
        source && (path !== null || source.builtin === true)
          ? {
              leaf: this.leaf,
              path,
              item,
              root:
                value["root"] === "annotation" || value["root"] === "filename"
                  ? value["root"]
                  : "note",
              tab: TABS.find((tab) => tab === value["tab"]) ?? "note",
              advanced: value["advanced"] === true,
              annotationId:
                typeof value["annotationId"] === "string"
                  ? value["annotationId"]
                  : null,
            }
          : null;
      this.state.setState({
        context,
        annotationId: context?.annotationId ?? null,
        showMarkdown: value["showMarkdown"] === true,
        showManaged: value["showManaged"] === true,
        ...(previous.context?.path !== context?.path ||
        previous.item?.id !== item?.id ||
        previous.annotationId !== context?.annotationId ||
        previous.context?.root !== context?.root ||
        previous.context?.tab !== context?.tab ||
        previous.context?.advanced !== context?.advanced
          ? { presentation: { scrollTop: 0, reveal: null, pending: false } }
          : {}),
      });
      const preview = {
        mode:
          value["mode"] === "update"
            ? ("update" as const)
            : ("create" as const),
        live: value["live"] !== false,
      };
      if (this.#session) {
        this.#session.setPreview(preview);
        this.#session.setItem(item);
        this.#session.select(context?.annotationId ?? null);
      } else this.state.setState({ item, preview });
      await this.#restoreSource();
      this.#mount();
    }
    await super.setState(input, result);
  }
  #presentationContext(): string {
    const { context, item, annotationId } = this.state.getState();
    return JSON.stringify([
      context?.path,
      item?.id,
      annotationId,
      context?.root,
      context?.tab,
      context?.advanced,
    ]);
  }
  override getEphemeralState(): Record<string, unknown> {
    const { presentation } = this.state.getState();
    return {
      zotlitPreview: {
        context: this.#presentationContext(),
        scrollTop: presentation.pending
          ? presentation.scrollTop
          : this.contentEl.scrollTop,
        reveal: presentation.reveal,
      },
    };
  }
  override setEphemeralState(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const value = (input as { zotlitPreview?: Record<string, unknown> })
      .zotlitPreview;
    if (!value || value["context"] !== this.#presentationContext()) return;
    const scrollTop = value["scrollTop"];
    this.state.setState({
      presentation: {
        scrollTop:
          typeof scrollTop === "number" && Number.isFinite(scrollTop)
            ? Math.max(0, scrollTop)
            : 0,
        reveal: typeof value["reveal"] === "string" ? value["reveal"] : null,
        pending: true,
      },
    });
    this.#restorePresentation();
  }
  #restorePresentation(): void {
    const { presentation, status } = this.state.getState();
    const render = this.#scheduler?.getState();
    if (
      !presentation.pending ||
      !this.#root ||
      status !== "ready" ||
      !render?.result ||
      render.stale ||
      !this.contentEl.firstElementChild ||
      this.contentEl.querySelector("[data-zotlit-preview-pending]") ||
      this.contentEl.firstElementChild.getAttribute(
        "data-zotlit-preview-result",
      ) !== render.result.sourceRevision
    )
      return;
    const target = presentation.reveal
      ? [...this.contentEl.querySelectorAll<HTMLElement>("[id]")].find(
          (element) => element.id === presentation.reveal,
        )
      : null;
    const scrollTop = target ? target.offsetTop : presentation.scrollTop;
    this.contentEl.scrollTop = Math.min(
      scrollTop,
      Math.max(0, this.contentEl.scrollHeight - this.contentEl.clientHeight),
    );
    this.state.setState({
      presentation: {
        ...presentation,
        scrollTop: this.contentEl.scrollTop,
        pending: false,
      },
    });
  }
  async #restoreSource(): Promise<void> {
    const context = this.state.getState().context;
    if (!context || !this.#session) return;
    if (context.path === null) {
      this.#file = null;
      this.#sourceGeneration++;
      this.#session.setSource(this.#deps.profile.getBuiltInSource());
      return;
    }
    this.#file = this.app.vault.getFileByPath(context.path);
    if (this.#file) await this.#readSource(this.#file);
    else {
      this.#sourceGeneration++;
      this.state.setState({
        sourceProblem: m.settings_profile_document_missing({
          path: context.path,
        }),
      });
      this.#scheduler?.setInput({ hold: true });
    }
  }
  async #readSource(file: TFile): Promise<void> {
    const generation = ++this.#sourceGeneration;
    try {
      const source =
        currentProfileSource(this.app, file) ??
        (await this.app.vault.read(file));
      if (file === this.#file && generation === this.#sourceGeneration)
        this.#session?.setSource(source);
    } catch (error) {
      if (file !== this.#file || generation !== this.#sourceGeneration) return;
      this.#session?.state.setState({
        sourceProblem: error instanceof Error ? error.message : String(error),
      });
      this.#scheduler?.setInput({ hold: true });
    }
  }
  #apply(context: ProfileAuthoringContext, explicit = false): void {
    const session = this.#session;
    if (!session) return;
    const previous = session.state.getState().context;
    if (this.leaf.pinned && previous && !explicit) return;
    if (previous === null && context.annotationId)
      session.select(context.annotationId);
    if (this.#file !== this.#editor?.file) this.#sourceGeneration++;
    this.#file = this.#editor?.file ?? null;
    if (
      previous?.path !== context.path ||
      session.state.getState().item?.id !== context.item?.id ||
      previous?.root !== context.root ||
      previous?.tab !== context.tab ||
      previous?.advanced !== context.advanced
    )
      session.state.setState({
        presentation: { scrollTop: 0, reveal: null, pending: false },
      });
    session.state.setState({ context });
    session.setItem(context.item);
    if (
      this.#editor &&
      (previous === null ||
        previous.leaf !== context.leaf ||
        previous.path !== context.path ||
        context.path === null)
    )
      session.setSource(this.#editor.getViewData());
  }
  #sourceEditor(): ProfileEditorView | null {
    return this.#editor &&
      this.#session?.state.getState().context?.path ===
        this.#editor.authoringContext.path
      ? this.#editor
      : null;
  }
  async #chooseItem(): Promise<void> {
    const editor = this.#sourceEditor();
    const session = this.#session;
    if (!session) return;
    const generation = ++this.#choiceGeneration;
    if (editor) {
      const accepted = await editor.chooseItem();
      if (
        accepted &&
        this.#session === session &&
        this.#sourceEditor() === editor &&
        generation === this.#choiceGeneration
      )
        this.#apply(editor.authoringContext, true);
      return;
    }
    const context = session.state.getState().context;
    const previousItem = session.state.getState().item;
    if (!context) return;
    const hit = await pickItem(
      {
        app: this.app,
        settings: this.#deps.settings,
        lookup: this.#deps.itemLookup,
      },
      m.template_data_explorer_pick_placeholder(),
    );
    if (
      !hit ||
      this.#session !== session ||
      this.#sourceEditor() ||
      generation !== this.#choiceGeneration ||
      session.state.getState().context !== context ||
      session.state.getState().item !== previousItem ||
      !parseIndexedKey(hit.item.indexedKey) ||
      isChildItemFields(hit.item.fields)
    )
      return;
    const item = {
      id: hit.item.indexedKey,
      title: itemSummary(hit.item, hit.item.fields).formatted,
    };
    session.state.setState({
      context: { ...context, item },
      presentation: { scrollTop: 0, reveal: null, pending: false },
    });
    session.setItem(item);
  }
  #mount(): void {
    const session = this.#session;
    const scheduler = this.#scheduler;
    const host = this.#host;
    this.#root?.render(
      session && scheduler && host && session.state.getState().context ? (
        <WorkbenchThemeProvider theme={profileEditorTheme}>
          <WorkbenchHostProvider host={host}>
            <PreviewContent
              session={session}
              rendered={this.#rendered}
              scheduler={scheduler}
              editorAvailable={this.#sourceEditor() !== null}
              chooseItem={() => void this.#chooseItem()}
              reveal={(slice) => this.#sourceEditor()?.revealSlice(slice)}
            />
          </WorkbenchHostProvider>
        </WorkbenchThemeProvider>
      ) : (
        <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:p-3">
          <p>{m.profile_preview_empty()}</p>
          <button
            onClick={() =>
              openSettingsTab(this.app, this.#pluginId, [
                m.settings_page_profiles(),
              ])
            }
          >
            {m.settings_page_profiles()}
          </button>
        </div>
      ),
    );
  }
  protected override async onClose(): Promise<void> {
    this.#cleanup?.dispose();
    this.#cleanup = null;
  }
}
function PreviewContent({
  session,
  scheduler,
  chooseItem,
  reveal,
  editorAvailable,
  rendered,
}: {
  rendered: () => void;
  session: NativePreviewSession;
  scheduler: RenderScheduler<NativeRenderResult>;
  editorAvailable: boolean;
  chooseItem: () => void;
  reveal: (slice: "advanced" | "annotation" | `entry:${number}`) => void;
}) {
  const { result, busy, stale } = useRenderState(scheduler);
  const {
    context,
    preview,
    status,
    error,
    sourceProblem,
    entries,
    showMarkdown,
    showManaged,
  } = useStore(session.state, (state) => state);
  useEffect(rendered, [result, status, showMarkdown, showManaged, rendered]);
  return (
    <div
      data-zotlit-preview-result={result?.sourceRevision}
      className="zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:p-3"
    >
      <PreviewControls
        preview={preview}
        onChange={(value) => session.setPreview(value)}
        busy={busy}
        disabled={status !== "ready" || sourceProblem !== null}
        onRun={() => scheduler.run()}
      />
      {status === "empty" && (
        <div>
          <p>{m.workbench_example_select_item()}</p>
          <button onClick={chooseItem}>
            {m.template_data_explorer_choose_item()}
          </button>
        </div>
      )}
      {status === "loading" && (
        <p role="status">{m.workbench_loading_item()}</p>
      )}
      {status === "error" && (
        <div role="alert">
          <p>{error ?? m.workbench_example_missing_item()}</p>
          <button onClick={() => session.refresh()}>
            {m.workbench_example_retry()}
          </button>
          <button onClick={chooseItem}>
            {m.template_data_explorer_choose_item()}
          </button>
        </div>
      )}
      {sourceProblem && (
        <div role="alert">
          <p>{sourceProblem}</p>
          <button
            disabled={!editorAvailable}
            onClick={() => reveal("advanced")}
          >
            {m.workbench_problems_where_advanced()}
          </button>
        </div>
      )}
      <PreviewAnnotationSelection session={session} />
      {status === "ready" && (
        <ResultColumn
          result={result}
          annotationResult={result}
          mode={
            context?.root === "annotation"
              ? "annotation"
              : !context?.advanced && context?.tab === "properties"
                ? "properties"
                : "note"
          }
          stale={stale}
          showMarkdown={showMarkdown}
          onShowMarkdown={(value) =>
            session.state.setState({ showMarkdown: value })
          }
          showManaged={showManaged}
          onShowManaged={(value) =>
            session.state.setState({ showManaged: value })
          }
          sourceAvailable={editorAvailable}
          openAnnotation={() => reveal("annotation")}
          goToEntry={(position) => reveal(`entry:${position}`)}
          openSource={() => reveal("advanced")}
          propertiesResult={
            result && (
              <PropertiesResult
                entries={entries}
                properties={result.properties}
                fold={result.fold}
                frontmatterBlock={result.frontmatterBlock}
                showMarkdown={showMarkdown}
              />
            )
          }
        />
      )}
    </div>
  );
}
