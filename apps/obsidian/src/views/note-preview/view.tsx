import "./style.css";
// Each Preview owns its inputs, render work, data, and output presentation.
import { ItemView, setIcon } from "obsidian";
import type { Menu, ViewStateResult } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { useEffect } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import {
  CITATION_EXAMPLE_IDS,
  DEFAULT_CITATION_EXAMPLE,
  isCitationExampleId,
} from "@zotlit/workbench/render";
import {
  citationExampleLabel,
  citationVariantLabel,
  createRenderScheduler,
  TABS,
  ResultBody,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useRenderState,
} from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  WorkbenchHost,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { openSettingsTab } from "@/lib/open-settings";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import { createTemplateWorkbenchHost } from "@/views/template-workbench/host";
import {
  chooseWorkbenchItem,
  chooseWorkbenchAnnotation,
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
  selectionName,
  selectionViewTitle,
  updateSelectionTitle,
} from "@/views/template-workbench/selection";
import { currentProfileSource } from "@/views/template-workbench/source";
import {
  templateWorkbenchButton,
  templateWorkbenchTheme,
  selectionBar,
  selectionControl,
  selectionHint,
} from "@/views/template-workbench/theme";
import type {
  TemplateWorkbenchView,
  TemplateAuthoringContext,
} from "@/views/template-workbench/view";

import { NativeMarkdown } from "./markdown";
import {
  activeTemplateWorkbench,
  registerCompanionHistory,
  onCompanionStateRestored,
  subscribeActiveTemplateWorkbench,
} from "./register";
import { nativeResult, renderNativeTemplate } from "./render";
import type { NativeRenderDeps, NativeRenderResult } from "./render";
import { createNativePreviewStore, NativePreviewSession } from "./session";
import type { NativePreviewState } from "./session";

export interface PreviewViewDeps extends NativeRenderDeps {
  settings: SettingsService;
  itemLookup: Pick<ItemLookup, "search">;
  profile: Pick<ProfileService, "getBuiltInSource">;
}

/** Which result the preview shows for the editor's current authoring context. */
function resultMode(
  context: TemplateAuthoringContext,
): "note" | "annotation" | "citation" {
  if (context.kind === "citation") return "citation";
  return context.root === "annotation" ? "annotation" : "note";
}

/** The Properties tab reads the sheet's own Properties block, so it opens there. */
function propertiesTabOpen(context: TemplateAuthoringContext | null): boolean {
  return context !== null && !context.advanced && context.tab === "properties";
}

/** The host sheet, which opens its Properties block while the editor is on Properties. */
function PreviewSheet({
  session,
  ...props
}: ComponentProps<typeof NativeMarkdown> & { session: NativePreviewSession }) {
  const context = useStore(session.state, (state) => state.context);
  return (
    <NativeMarkdown {...props} expandProperties={propertiesTabOpen(context)} />
  );
}

export const NOTE_PREVIEW_VIEW_TYPE = "zotlit-note-preview";
export class NotePreviewView extends ItemView {
  readonly #pluginId: string;
  readonly #deps: PreviewViewDeps;
  readonly state = createNativePreviewStore();
  #root: Root | null = null;
  #cleanup: DisposableStack | null = null;
  #editor: TemplateWorkbenchView | null = null;
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
    const state = this.state.getState();
    if (state.context?.kind === "citation") {
      // A Citation Template renders an example set, so the tab names the set
      // rather than the note of an Item.
      const name = state.citationExample
        ? citationExampleLabel(m, state.citationExample)
        : (state.item?.title ?? state.snapshot?.item.title ?? null);
      return name === null
        ? m.workbench_citation_result_heading()
        : m.workbench_selection_title({
            name,
            view: m.workbench_view_preview(),
          });
    }
    return selectionViewTitle({
      item: state.item && {
        ...state.item,
        title: state.item.title ?? state.snapshot?.item.title ?? null,
      },
      annotation: state.example,
      annotationMode: state.context?.root === "annotation",
      view: "preview",
    });
  }
  override getIcon(): string {
    return "eye";
  }
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const state = this.state.getState();
    const mode = state.context ? resultMode(state.context) : "note";
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_choose_item())
        .setIcon("search")
        .onClick(() => void this.#chooseItem()),
    );
    if (mode === "citation") this.#addExampleMenu(menu, state);
    else
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.workbench_choose_annotation())
          .setIcon("highlighter")
          .onClick(() => void this.#chooseAnnotation()),
      );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.workbench_refresh_item())
        .setIcon("refresh-cw")
        .onClick(() => this.#session?.refresh()),
    );
    const result = this.#scheduler?.getState().result ?? null;
    if (mode === "citation") this.#addVariantMenu(menu, state);
    if (mode !== "annotation" && mode !== "citation") {
      menu.addItem((item) =>
        item
          .setSection("zotlit-preview")
          .setTitle(m.workbench_preview_as_new_note())
          .setIcon("file-plus")
          .setChecked(
            state.preview.mode === "create" &&
              !(mode === "note" && state.showManaged),
          )
          .onClick(() => {
            this.#session?.setPreview(
              { mode: "create" },
              { showManaged: false },
            );
          }),
      );
      menu.addItem((item) =>
        item
          .setSection("zotlit-preview")
          .setTitle(m.workbench_preview_as_updated_note())
          .setIcon("file-pen")
          .setChecked(
            state.preview.mode === "update" &&
              !(mode === "note" && state.showManaged),
          )
          // A Sample Item, or an Item with no note in the vault yet, has no
          // existing note to update; until a result lands the choice stays open.
          .setDisabled(result !== null && !result.sourcePath)
          .onClick(() => {
            this.#session?.setPreview(
              { mode: "update" },
              { showManaged: false },
            );
          }),
      );
      if (mode === "note")
        menu.addItem((item) =>
          item
            .setSection("zotlit-preview")
            .setTitle(m.workbench_preview_updated_section())
            .setIcon("rows-3")
            .setChecked(state.showManaged)
            .onClick(() => {
              const session = this.#session;
              if (!session) return;
              session.state.setState({ showManaged: true });
            }),
        );
    }
    menu.addItem((item) =>
      item
        .setSection("zotlit-display")
        .setTitle(m.workbench_preview_auto_refresh())
        .setIcon("zap")
        .setChecked(state.preview.live)
        .onClick(() => {
          const session = this.#session;
          if (!session) return;
          session.setPreview({ live: !session.state.getState().preview.live });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit-display")
        .setTitle(m.workbench_show_markdown())
        .setIcon("code")
        .setChecked(state.showMarkdown)
        .onClick(() => {
          const session = this.#session;
          if (!session) return;
          session.state.setState({
            showMarkdown: !session.state.getState().showMarkdown,
          });
        }),
    );
  }
  /**
   * The built-in Citation example sets, one checked. Choosing one makes it the
   * set the preview renders, whichever Item the editor has selected.
   */
  #addExampleMenu(menu: Menu, state: NativePreviewState): void {
    menu.addItem((item) => {
      item
        .setSection("zotlit")
        .setTitle(m.template_workbench_use_example())
        .setIcon("list");
      const submenu = item.setSubmenu();
      for (const id of CITATION_EXAMPLE_IDS)
        submenu.addItem((entry) =>
          entry
            .setTitle(citationExampleLabel(m, id))
            .setChecked(state.citationExample === id)
            .onClick(() => this.#setCitation({ citationExample: id })),
        );
    });
  }

  /**
   * The checked pair naming which gesture the preview renders. One store value
   * answers for the menu's check, the caption, and the render alike.
   */
  #addVariantMenu(menu: Menu, state: NativePreviewState): void {
    for (const [variant, title, icon] of [
      ["main", m.template_workbench_preview_main_citation(), "quote"],
      ["alt", m.template_workbench_preview_alt_citation(), "quote"],
    ] as const)
      menu.addItem((item) =>
        item
          .setSection("zotlit-preview")
          .setTitle(title)
          .setIcon(icon)
          .setChecked(state.variant === variant)
          .onClick(() => this.#setCitation({ variant })),
      );
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
        render: (request) => renderNativeTemplate(deps, request),
        failed: nativeResult,
      }),
    );
    const session = resources.use(
      new NativePreviewSession(deps, scheduler, { state: this.state }),
    );
    const host = resources.use(
      createTemplateWorkbenchHost(this.app, {
        render: (request) => renderNativeTemplate(deps, request),
        matchData: {
          tags: async () => [],
          collections: async () => [],
          libraries: async () => [],
        },
        insertTarget: () => null,
        markdown: (props) => (
          <PreviewSheet
            {...props}
            app={this.app}
            session={session}
            result={scheduler.getState().result}
            onRendered={this.#rendered}
          />
        ),
      }),
    );
    this.#scheduler = scheduler;
    this.#session = session;
    this.#host = host;
    // Added first, so it sits nearest More options; Obsidian prepends actions.
    const sectionAction = this.addAction(
      "rows-3",
      m.workbench_preview_updated_section(),
      () => {
        const session = this.#session;
        if (session)
          session.state.setState({
            showManaged: !session.state.getState().showManaged,
          });
      },
    );
    const formatAction = this.addAction(
      "code",
      m.workbench_show_markdown(),
      () => {
        const session = this.#session;
        if (session)
          session.state.setState({
            showMarkdown: !session.state.getState().showMarkdown,
          });
      },
    );
    const chooseAction = this.addAction(
      "search",
      m.workbench_choose_item(),
      () => {
        if (this.state.getState().context?.root === "annotation")
          void this.#chooseAnnotation();
        else void this.#chooseItem();
      },
    );
    let syncedMarkdown: boolean | null = null;
    const syncFormatAction = () => {
      const showMarkdown = this.state.getState().showMarkdown;
      if (showMarkdown === syncedMarkdown) return;
      syncedMarkdown = showMarkdown;
      setIcon(formatAction, showMarkdown ? "book-open" : "code");
      formatAction.setAttribute(
        "aria-label",
        showMarkdown
          ? m.workbench_show_reading_view()
          : m.workbench_show_markdown(),
      );
    };
    syncFormatAction();
    // Swaps icon and label like the format action: each names the note the
    // next press shows. Outside the note result the action has no meaning.
    let syncedSection: string | null = null;
    const syncSectionAction = () => {
      const state = this.state.getState();
      const shown = state.context
        ? resultMode(state.context) === "note"
        : false;
      const label = !state.showManaged
        ? m.workbench_preview_updated_section()
        : state.preview.mode === "update"
          ? m.workbench_preview_as_updated_note()
          : m.workbench_preview_as_new_note();
      const key = `${shown}:${label}`;
      if (key === syncedSection) return;
      syncedSection = key;
      sectionAction.toggle(shown);
      setIcon(sectionAction, state.showManaged ? "file-text" : "rows-3");
      sectionAction.setAttribute("aria-label", label);
    };
    syncSectionAction();
    cleanup.defer(
      subscribeWorkbenchSelection(this, {
        editor: () => this.#sourceEditor()?.leaf ?? null,
        apply: (selection) => {
          if (selection.kind === "item") this.#setItem(selection.item);
          else if (selection.kind === "annotation")
            session.select(selection.annotationId);
          else
            session.setCitation({
              variant: selection.variant,
              citationExample: selection.example,
            });
        },
      }),
    );
    let persisted = JSON.stringify(this.getState());
    cleanup.defer(
      this.state.subscribe(() => {
        updateSelectionTitle(this);
        chooseAction.setAttribute(
          "aria-label",
          this.state.getState().context?.root === "annotation"
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item(),
        );
        syncFormatAction();
        syncSectionAction();
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
      session.setContext({ ...context, path: file.path });
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
      subscribeActiveTemplateWorkbench(
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
    updateSelectionTitle(this);
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
      kind: context?.kind ?? "profile",
      advanced: context?.advanced ?? false,
      variant: state.variant,
      citationExample: state.citationExample,
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
        this.#editor = activeTemplateWorkbench(
          this.app,
          this.leaf,
          this.#editor,
        );
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
      const citation = {
        variant:
          value["variant"] === "alt" ? ("alt" as const) : ("main" as const),
        citationExample:
          typeof value["citationExample"] === "string" &&
          isCitationExampleId(value["citationExample"])
            ? value["citationExample"]
            : value["citationExample"] === null
              ? null
              : DEFAULT_CITATION_EXAMPLE,
      };
      const context: TemplateAuthoringContext | null =
        source && (path !== null || source.builtin === true)
          ? {
              leaf: this.leaf,
              path,
              item,
              kind: value["kind"] === "citation" ? "citation" : "profile",
              root:
                value["root"] === "annotation" ||
                value["root"] === "filename" ||
                value["root"] === "citation"
                  ? value["root"]
                  : "note",
              tab: TABS.find((tab) => tab === value["tab"]) ?? "note",
              advanced: value["advanced"] === true,
              annotationId:
                typeof value["annotationId"] === "string"
                  ? value["annotationId"]
                  : null,
              citation:
                value["kind"] === "citation"
                  ? {
                      variant: citation.variant,
                      example: citation.citationExample,
                    }
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
        this.#session.setCitation(citation);
        this.#session.setItem(item);
        this.#session.select(context?.annotationId ?? null);
      } else this.state.setState({ item, preview, ...citation });
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
  #apply(context: TemplateAuthoringContext, explicit = false): void {
    const session = this.#session;
    if (!session) return;
    const previous = session.state.getState().context;
    if (this.leaf.pinned && previous && !explicit) return;
    if (previous?.annotationId !== context.annotationId)
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
    session.setContext(context);
    session.setItem(context.item);
    // An Item the reader picked is the Citation set they asked to see, so the
    // built-in example that outranks it stands down.
    if (explicit && context.kind === "citation")
      session.setCitation({ citationExample: null });
    if (
      this.#editor &&
      (previous === null ||
        previous.leaf !== context.leaf ||
        previous.path !== context.path ||
        context.path === null)
    )
      session.setSource(this.#editor.getViewData());
  }
  #sourceEditor(): TemplateWorkbenchView | null {
    return this.#editor &&
      this.#session?.state.getState().context?.path ===
        this.#editor.authoringContext.path
      ? this.#editor
      : null;
  }
  async #chooseItem(): Promise<void> {
    const editor = this.#sourceEditor();
    const session = this.#session;
    const host = this.#host;
    if (!session || !host) return;
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
    const previousItem = session.state.getState().item;
    const previousContext = session.state.getState().context;
    const choice = await chooseWorkbenchItem(
      host,
      {
        app: this.app,
        settings: this.#deps.settings,
        lookup: this.#deps.itemLookup,
      },
      previousItem ?? undefined,
    );
    if (
      !choice ||
      this.#session !== session ||
      generation !== this.#choiceGeneration ||
      session.state.getState().context !== previousContext ||
      session.state.getState().item !== previousItem
    )
      return;
    this.#setItem(choice);
    publishWorkbenchSelection(
      this,
      { kind: "item", item: choice },
      this.#sourceEditor()?.leaf ?? null,
    );
  }
  #setItem(item: WorkbenchItemChoice): void {
    const session = this.#session;
    if (!session) return;
    const context = session.state.getState().context;
    session.state.setState({
      ...(context ? { context: { ...context, item } } : {}),
      presentation: { scrollTop: 0, reveal: null, pending: false },
    });
    session.setItem(item);
    // An Item the reader picked is the Citation set they asked to see. This
    // also serves a published Item choice, which a receiver never echoes, so
    // the set changes here and is published nowhere.
    if (context?.kind === "citation")
      session.setCitation({ citationExample: null });
  }
  /**
   * The Citation set and Variant this reader chose, published so the editor
   * and the Template data explorer that follow it show the same set.
   */
  #setCitation(
    value: Partial<Pick<NativePreviewState, "variant" | "citationExample">>,
  ): void {
    const session = this.#session;
    if (!session) return;
    session.setCitation(value);
    const { variant, citationExample } = session.state.getState();
    publishWorkbenchSelection(
      this,
      { kind: "citation", variant, example: citationExample },
      this.#sourceEditor()?.leaf ?? null,
    );
  }
  async #chooseAnnotation(): Promise<void> {
    const session = this.#session;
    const host = this.#host;
    if (!session || !host) return;
    const generation = ++this.#choiceGeneration;
    const state = session.state.getState();
    const id = await chooseWorkbenchAnnotation(
      host,
      state.current,
      state.example?.id ?? null,
    );
    if (
      id !== null &&
      this.#session === session &&
      generation === this.#choiceGeneration &&
      state.item === session.state.getState().item
    ) {
      session.select(id);
      publishWorkbenchSelection(
        this,
        { kind: "annotation", annotationId: id },
        this.#sourceEditor()?.leaf ?? null,
      );
    }
  }
  #mount(): void {
    const session = this.#session;
    const scheduler = this.#scheduler;
    const host = this.#host;
    this.#root?.render(
      session && scheduler && host && session.state.getState().context ? (
        <WorkbenchThemeProvider theme={templateWorkbenchTheme}>
          <WorkbenchHostProvider host={host}>
            <PreviewContent
              session={session}
              rendered={this.#rendered}
              scheduler={scheduler}
              editorAvailable={this.#sourceEditor() !== null}
              chooseItem={() => void this.#chooseItem()}
              chooseAnnotation={() => void this.#chooseAnnotation()}
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
const sidebarBar = selectionBar({ placement: "sidebar" });

function PreviewContent({
  session,
  scheduler,
  chooseItem,
  chooseAnnotation,
  reveal,
  editorAvailable,
  rendered,
}: {
  rendered: () => void;
  session: NativePreviewSession;
  scheduler: RenderScheduler<NativeRenderResult>;
  editorAvailable: boolean;
  chooseItem: () => void;
  chooseAnnotation: () => void;
  reveal: (slice: "advanced" | "annotation" | `entry:${number}`) => void;
}) {
  const { result, busy, stale, staleReason } = useRenderState(scheduler);
  const {
    context,
    preview,
    status,
    error,
    sourceProblem,
    showMarkdown,
    showManaged,
    example,
    item,
    snapshot,
    variant,
    citationExample,
  } = useStore(session.state, (state) => state);
  useEffect(rendered, [result, status, showMarkdown, showManaged, rendered]);
  const mode = context ? resultMode(context) : "note";
  const citationMode = mode === "citation";
  const annotationMode = !citationMode && context?.root === "annotation";
  // A Citation example carries its own data, so its preview is ready the moment
  // the reader has one selected — no Item Snapshot to wait on.
  const ready =
    status === "ready" ||
    (annotationMode && example !== null) ||
    (citationMode && citationExample !== null);
  const choose = annotationMode ? chooseAnnotation : chooseItem;
  const name = citationMode
    ? citationExample === null
      ? (item?.title ?? snapshot?.item.title ?? null)
      : citationExampleLabel(m, citationExample)
    : selectionName({
        item: item && {
          ...item,
          title: item.title ?? snapshot?.item.title ?? null,
        },
        annotation: example,
        annotationMode,
      });
  const heading = citationMode
    ? m.workbench_citation_result_heading()
    : mode === "annotation"
      ? m.workbench_annotation_example()
      : m.workbench_result_heading();
  const caption = [
    ...(citationMode ? [citationVariantLabel(m, variant)] : []),
    ...(!citationMode && mode !== "annotation"
      ? [
          mode === "note" && showManaged
            ? m.workbench_result_managed_toggle()
            : preview.mode === "update"
              ? m.workbench_preview_existing_note()
              : m.workbench_preview_new_note(),
        ]
      : []),
    ...(!preview.live ? [m.workbench_preview_on_demand()] : []),
  ].join(m.workbench_selection_separator());
  return (
    <div
      data-zotlit-preview-result={result?.sourceRevision}
      className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3 zt:p-3"
    >
      <div className={sidebarBar.row()}>
        {name && <p className={sidebarBar.caption()}>{name}</p>}
        <button className={sidebarBar.trigger()} onClick={choose}>
          <Icon name="search" />
          <span>
            {annotationMode
              ? m.workbench_choose_annotation()
              : m.workbench_choose_item()}
          </span>
        </button>
      </div>
      {status === "empty" && !ready && (
        <div className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-2">
          <p className={selectionHint}>
            {annotationMode
              ? m.workbench_preview_choose_annotation()
              : m.workbench_preview_choose_item()}
          </p>
          <button
            className={selectionControl({ kind: "trigger" })}
            onClick={choose}
          >
            <Icon name="search" />
            <span>
              {annotationMode
                ? m.workbench_choose_annotation()
                : m.workbench_choose_item()}
            </span>
          </button>
        </div>
      )}
      {status === "loading" && (
        <p role="status" className={selectionHint}>
          {m.workbench_loading_item()}
        </p>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5"
        >
          <p className={selectionHint}>
            {error ?? m.workbench_example_missing_item()}
          </p>
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2">
            <button
              className={templateWorkbenchButton}
              onClick={() => session.refresh()}
            >
              {m.workbench_example_retry()}
            </button>
            <button className={templateWorkbenchButton} onClick={chooseItem}>
              {m.template_data_explorer_choose_item()}
            </button>
          </div>
        </div>
      )}
      {sourceProblem && (
        <div
          role="alert"
          className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5"
        >
          <p className={selectionHint}>{sourceProblem}</p>
          <button
            className={templateWorkbenchButton}
            disabled={!editorAvailable}
            onClick={() => reveal("advanced")}
          >
            {m.workbench_problems_where_advanced()}
          </button>
        </div>
      )}
      {ready && (
        <>
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-baseline zt:justify-between zt:gap-x-3 zt:gap-y-1">
            <h2 className="zt-note-preview-heading">{heading}</h2>
            {caption && <p className={selectionHint}>{caption}</p>}
          </div>
          <ResultBody
            result={result}
            annotationResult={result}
            mode={mode}
            stale={stale}
            staleReason={staleReason}
            showMarkdown={showMarkdown}
            showManaged={showManaged}
            sourceAvailable={editorAvailable}
            openAnnotation={() => reveal("annotation")}
            goToEntry={(position) => reveal(`entry:${position}`)}
            openSource={() => reveal("advanced")}
            onRun={() => scheduler.run()}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
