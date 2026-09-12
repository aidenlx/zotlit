import "./style.css";
// Each Preview owns its inputs, render work, data, and output presentation.
import { ItemView, setIcon } from "obsidian";
import type { Menu, ViewStateResult } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { useEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { DEFAULT_CITATION_VARIANT, isCitationVariant } from "@zotlit/db";
import {
  CITATION_EXAMPLE_IDS,
  DEFAULT_CITATION_EXAMPLE,
  DEFAULT_PARTIAL_CONTEXT,
  isCitationExampleId,
  isPartialContext,
} from "@zotlit/workbench/render";
import type {
  PartialChoice,
  PartialContext,
  RenderDiagnostic,
} from "@zotlit/workbench/render";
import {
  citationExampleLabel,
  citationVariantLabel,
  createRenderScheduler,
  partialContextLabel,
  renderDiagnosis,
  TABS,
  ResultBody,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useRenderState,
} from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  ResultMode,
  WorkbenchHost,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { openSettingsTab } from "@/lib/open-settings";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import {
  templateFolderOf,
  templatePartialName,
} from "@/views/template-workbench/document-kind";
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
  profile: Pick<
    ProfileService,
    "getBuiltInSource" | "profiles" | "resolveProfile"
  >;
}

/** Which result the preview shows for the editor's current authoring context. */
function resultMode(context: TemplateAuthoringContext): ResultMode {
  if (context.kind === "citation") return "citation";
  if (context.kind === "partial") return "partial";
  return context.root === "annotation" ? "annotation" : "note";
}

/** The caller a Shared Partial preview renders as; Note for every other kind. */
function partialContextOf(
  context: TemplateAuthoringContext | null,
): PartialContext {
  return context?.partial?.context ?? DEFAULT_PARTIAL_CONTEXT;
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
/** Distinguishes the previews one editor explains for. */
let previewCount = 0;

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
  /** Names this preview to the editor that explains what it found. */
  readonly #problemKey = `note-preview-${++previewCount}`;
  /** The editor holding this preview's findings, which a close gives back. */
  #problemHost: TemplateWorkbenchView | null = null;
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
    if (state.context?.root === "citation") {
      // A Citation set is what is rendered, so the tab names the set rather
      // than the note of an Item.
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
      annotationMode: this.#annotationChoice(),
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
    const citationSet =
      mode === "citation" || partialContextOf(state.context) === "citation";
    if (citationSet) this.#addExampleMenu(menu, state);
    if (mode !== "citation")
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
    // The caller leads: it decides which set the Citation pair below it names.
    if (mode === "partial") this.#addPartialMenu(menu, state);
    if (citationSet) this.#addVariantMenu(menu, state);
    if (mode === "note") {
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

  /**
   * The checked triple naming the caller a Shared Partial is rendered as called
   * from, and — only where the vault holds more than one — the Profile whose
   * bindings that caller's data is built with.
   */
  #addPartialMenu(menu: Menu, state: NativePreviewState): void {
    const current = partialContextOf(state.context);
    for (const [context, title, icon] of [
      ["note", m.template_workbench_preview_as_note(), "file-text"],
      [
        "annotation",
        m.template_workbench_preview_as_annotation(),
        "highlighter",
      ],
      ["citation", m.template_workbench_preview_as_citation(), "quote"],
    ] as const)
      menu.addItem((item) =>
        item
          .setSection("zotlit-preview")
          .setTitle(title)
          .setIcon(icon)
          .setChecked(current === context)
          .onClick(() => this.#setPartial({ context })),
      );
    // `profiles` holds the custom Profiles alone, so an empty list is the
    // default Profile by itself: there is nothing to choose between.
    const profiles = this.#deps.profile.profiles;
    if (profiles.length === 0) return;
    const selected = state.context?.partial?.profile ?? null;
    menu.addItem((item) => {
      item
        .setSection("zotlit-preview")
        .setTitle(m.template_workbench_use_profile())
        .setIcon("book-user");
      const submenu = item.setSubmenu();
      for (const [profile, label] of [
        [null, m.settings_profile_default_name()],
        ...profiles.map(({ id, label }) => [id, label] as const),
      ] as const)
        submenu.addItem((entry) =>
          entry
            .setTitle(label)
            .setChecked(selected === profile)
            .onClick(() => this.#setPartial({ profile })),
        );
    });
  }

  /**
   * Shows this partial under `value`, and reports what it now renders under.
   * The caller is also the root every companion follows, so it lands here too.
   *
   * @returns null on a document that is no Shared Partial.
   */
  #applyPartial(
    value: Partial<PartialChoice>,
  ): TemplateAuthoringContext["partial"] {
    const session = this.#session;
    const context = session?.state.getState().context;
    if (!session || !context?.partial) return null;
    const partial = { ...context.partial, ...value };
    session.setContext({ ...context, partial, root: partial.context });
    return partial;
  }

  /**
   * The caller and Profile this reader chose, published so the editor and the
   * Template data explorer that follow it read the one choice.
   */
  #setPartial(value: Partial<PartialChoice>): void {
    const partial = this.#applyPartial(value);
    if (!partial) return;
    publishWorkbenchSelection(
      this,
      {
        kind: "partial",
        context: partial.context,
        profile: partial.profile,
      },
      this.#sourceEditor()?.leaf ?? null,
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
        if (this.#annotationChoice()) void this.#chooseAnnotation();
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
          else if (selection.kind === "partial") this.#applyPartial(selection);
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
          this.#annotationChoice()
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
      partialProfile: context?.partial?.profile ?? null,
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
        variant: isCitationVariant(value["variant"])
          ? value["variant"]
          : DEFAULT_CITATION_VARIANT,
        citationExample:
          typeof value["citationExample"] === "string" &&
          isCitationExampleId(value["citationExample"])
            ? value["citationExample"]
            : value["citationExample"] === null
              ? null
              : DEFAULT_CITATION_EXAMPLE,
      };
      // The shown root is the one value the caller lives in: on a partial it is
      // the caller the reader chose, so nothing else has to be kept in step.
      const root =
        value["root"] === "annotation" ||
        value["root"] === "filename" ||
        value["root"] === "citation"
          ? value["root"]
          : "note";
      const partialName =
        path === null
          ? null
          : templatePartialName(path, templateFolderOf(this.#deps.settings));
      const context: TemplateAuthoringContext | null =
        source && (path !== null || source.builtin === true)
          ? {
              leaf: this.leaf,
              path,
              item,
              kind:
                value["kind"] === "citation" || value["kind"] === "partial"
                  ? value["kind"]
                  : "profile",
              root,
              tab: TABS.find((tab) => tab === value["tab"]) ?? "note",
              advanced: value["advanced"] === true,
              annotationId:
                typeof value["annotationId"] === "string"
                  ? value["annotationId"]
                  : null,
              citation:
                root === "citation"
                  ? {
                      variant: citation.variant,
                      example: citation.citationExample,
                    }
                  : null,
              partial:
                value["kind"] === "partial" && partialName !== null
                  ? {
                      name: partialName,
                      context: isPartialContext(root)
                        ? root
                        : DEFAULT_PARTIAL_CONTEXT,
                      profile:
                        typeof value["partialProfile"] === "string"
                          ? value["partialProfile"]
                          : null,
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
  /** Whether the shown root is an Annotation, so the chooser offers those. */
  #annotationChoice(): boolean {
    const context = this.state.getState().context;
    return context?.root === "annotation";
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
    if (explicit && context.root === "citation")
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
  /**
   * Hands this preview's findings to the editor that owns the Problems area,
   * and takes them back from the editor it no longer describes.
   */
  #publishProblems(diagnostics: readonly RenderDiagnostic[]): void {
    const editor = this.#sourceEditor();
    if (this.#problemHost && this.#problemHost !== editor)
      this.#problemHost.publishPreviewProblems(this.#problemKey, []);
    this.#problemHost = editor;
    editor?.publishPreviewProblems(this.#problemKey, diagnostics);
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
    if (context?.root === "citation")
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
              publishProblems={(diagnostics) =>
                this.#publishProblems(diagnostics)
              }
              showProblem={(id, reveal) =>
                this.#sourceEditor()?.showProblem(id, reveal)
              }
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
    // A closed preview describes nothing, so its findings leave the editor
    // with it rather than standing as a problem the reader cannot reach.
    this.#problemHost?.publishPreviewProblems(this.#problemKey, []);
    this.#problemHost = null;
    this.#cleanup?.dispose();
    this.#cleanup = null;
  }
}
const sidebarBar = selectionBar({ placement: "sidebar" });

/** Nothing found, as one value, so an idle preview publishes no new list. */
const NO_DIAGNOSTICS: readonly RenderDiagnostic[] = [];

function PreviewContent({
  session,
  scheduler,
  chooseItem,
  chooseAnnotation,
  editorAvailable,
  rendered,
  publishProblems,
  showProblem,
}: {
  rendered: () => void;
  session: NativePreviewSession;
  scheduler: RenderScheduler<NativeRenderResult>;
  editorAvailable: boolean;
  chooseItem: () => void;
  chooseAnnotation: () => void;
  /** Hands what this render found to the editor that explains it. */
  publishProblems: (diagnostics: readonly RenderDiagnostic[]) => void;
  /** Reads one problem in the editor's Problems area. */
  showProblem: (id: string | null, reveal: boolean) => void;
}) {
  const { result, busy, stale, staleReason, trigger, attempt } =
    useRenderState(scheduler);
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
  // The editor owns the explanation, so this preview publishes what its render
  // found and takes it back when it closes.
  const diagnostics = result?.diagnostics ?? NO_DIAGNOSTICS;
  const publish = useRef(publishProblems);
  publish.current = publishProblems;
  const open = useRef(showProblem);
  open.current = showProblem;
  useEffect(() => {
    publish.current(diagnostics);
  }, [diagnostics]);
  useEffect(() => () => publish.current(NO_DIAGNOSTICS), []);
  const opened = useRef(attempt);
  useEffect(() => {
    if (attempt === opened.current) return;
    opened.current = attempt;
    // A deliberate Run that failed is worth an explanation at once; the
    // editor's pane is left where the reader put it.
    const first = diagnostics[0];
    if (trigger === "explicit" && first)
      open.current(renderDiagnosis(first).id, false);
  }, [attempt, trigger, diagnostics]);
  const mode = context ? resultMode(context) : "note";
  const partialContext = partialContextOf(context);
  // A partial reads the root its chosen caller reads, so the set it is shown
  // against and the chooser it offers are that caller's, not the document's.
  const citationSet = mode === "citation" || partialContext === "citation";
  const annotationMode =
    mode === "annotation" ||
    (mode === "partial" && partialContext === "annotation");
  // A Citation example carries its own data, so its preview is ready the moment
  // the reader has one selected — no Item Snapshot to wait on.
  const ready =
    status === "ready" ||
    (annotationMode && example !== null) ||
    (citationSet && citationExample !== null);
  const choose = annotationMode ? chooseAnnotation : chooseItem;
  const name = citationSet
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
  const heading =
    mode === "partial"
      ? m.workbench_partial_result_heading()
      : mode === "citation"
        ? m.workbench_citation_result_heading()
        : mode === "annotation"
          ? m.workbench_annotation_example()
          : m.workbench_result_heading();
  const caption = [
    ...(mode === "partial" ? [partialContextLabel(m, partialContext)] : []),
    ...(citationSet ? [citationVariantLabel(m, variant)] : []),
    ...(mode === "note"
      ? [
          showManaged
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
            onClick={() => showProblem(null, true)}
          >
            {m.workbench_problem_show()}
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
            onShowProblem={(diagnostic) =>
              showProblem(renderDiagnosis(diagnostic).id, true)
            }
            onRun={() => scheduler.run()}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
