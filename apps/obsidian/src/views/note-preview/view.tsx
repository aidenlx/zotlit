import "./style.css";
// Each Preview owns its inputs, render work, data, and output presentation.
import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import {
  createRenderScheduler,
  PreviewControls,
  ResultColumn,
  PropertiesResult,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useRenderState,
} from "@zotlit/workbench/ui";
import type { RenderScheduler, WorkbenchHost } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { openSettingsTab } from "@/lib/open-settings";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import { profileEditorTheme } from "@/views/profile-editor/theme";
import type {
  ProfileEditorView,
  ProfileAuthoringContext,
} from "@/views/profile-editor/view";

import { PreviewAnnotationSelection } from "./annotation-selection";
import { NativeMarkdown } from "./markdown";
import { subscribeActiveProfileEditor } from "./register";
import { nativeResult, renderNativeProfile } from "./render";
import type { NativeRenderResult } from "./render";
import { NativePreviewSession } from "./session";

export const NOTE_PREVIEW_VIEW_TYPE = "zotlit-note-preview";
export class NotePreviewView extends ItemView {
  readonly #pluginId: string;
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #editor: ProfileEditorView | null = null;
  #session: NativePreviewSession | null = null;
  #scheduler: RenderScheduler<NativeRenderResult> | null = null;
  #host: (WorkbenchHost & Disposable) | null = null;
  constructor(leaf: WorkspaceLeaf, pluginId: string) {
    super(leaf);
    this.#pluginId = pluginId;
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
    cleanup.defer(() => {
      this.#root = null;
      this.#session = null;
      this.#scheduler = null;
      this.#host = null;
      this.#editor = null;
    });
    const resources = cleanup.use(new DisposableStack());
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
        if (file.path === this.#session?.state.getState().context?.path)
          this.#session?.setSource(source);
      },
    );
    cleanup.defer(() => this.app.workspace.offref(sourceEvent));
    cleanup.defer(
      subscribeActiveProfileEditor(
        this.app,
        (editor) => {
          if (resources.disposed) return;
          this.#editor = editor;
          const deps = editor?.nativeRenderDeps;
          if (editor && deps) {
            if (!this.#scheduler) {
              using binding = new DisposableStack();
              const scheduler = binding.use(
                createRenderScheduler({
                  input: {
                    source: editor.getViewData(),
                    snapshot: null,
                    mode: "create",
                    live: true,
                  },
                  render: (request) => renderNativeProfile(deps, request),
                  failed: nativeResult,
                }),
              );
              const session = binding.use(
                new NativePreviewSession(deps, scheduler),
              );
              const host = binding.use(
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
                    />
                  ),
                }),
              );
              if (resources.disposed) return;
              resources.use(binding.move());
              this.#scheduler = scheduler;
              this.#session = session;
              this.#host = host;
            }
            this.#apply(editor.authoringContext);
          }
          this.#mount();
        },
        this.leaf,
      ),
    );
    this.#cleanup = cleanup.move();
  }
  #apply(context: ProfileAuthoringContext): void {
    const session = this.#session;
    if (!session) return;
    const previous = session.state.getState().context;
    if (previous === null && context.annotationId)
      session.select(context.annotationId);
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
  #mount(): void {
    const session = this.#session;
    const scheduler = this.#scheduler;
    const host = this.#host;
    this.#root?.render(
      session && scheduler && host ? (
        <WorkbenchThemeProvider theme={profileEditorTheme}>
          <WorkbenchHostProvider host={host}>
            <PreviewContent
              session={session}
              scheduler={scheduler}
              chooseItem={() => void this.#editor?.chooseItem()}
              reveal={(slice) => this.#editor?.revealSlice(slice)}
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
}: {
  session: NativePreviewSession;
  scheduler: RenderScheduler<NativeRenderResult>;
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
  return (
    <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:p-3">
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
          <button onClick={() => reveal("advanced")}>
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
