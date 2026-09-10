// Native overlays and Markdown lifecycle for the shared Template Workbench tree.
import { Compartment } from "@codemirror/state";
import { tooltips, ViewPlugin } from "@codemirror/view";
import {
  AbstractInputSuggest,
  Component,
  ConfirmationModal,
  MarkdownRenderer,
  Menu,
  Modal,
  prepareSimpleSearch,
  renderMatches,
  setIcon,
  SuggestModal,
} from "obsidian";
import type { App, HoverParent } from "obsidian";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  completionSuggestion,
  templateCompletion,
} from "@zotlit/workbench/language";
import type { TemplateCompletionPresentation } from "@zotlit/workbench/language";
import { WorkbenchMessagesProvider } from "@zotlit/workbench/ui";
import type {
  WorkbenchHost,
  WorkbenchDialogRequest,
  WorkbenchSuggesterRequest,
  WorkbenchSuggesterOption,
  WorkbenchInputSuggestionsRequest,
} from "@zotlit/workbench/ui";

import { Toggle } from "@/components/obsidian/toggle";
import { citationStyleLabel } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { BaseNotice } from "@/lib/notice";
import { tooltipAttrs } from "@/lib/utils";
import {
  appendInlineFlair,
  appendTrailingFlair,
  FLAIR_ROW_CLASS,
} from "@/services/item-lookup/render-hit";

import { templateHover } from "./hover";
import { templateWorkbenchIcons } from "./theme";

class EditorDialog extends Modal {
  #root: Root | null = null;
  readonly #request: WorkbenchDialogRequest;
  constructor(app: App, request: WorkbenchDialogRequest) {
    super(app);
    this.#request = request;
    this.setTitle(request.title);
  }
  override onOpen(): void {
    this.contentEl.addClass("zt-root");
    this.#root = createRoot(this.contentEl);
    this.#root.render(this.#request.content);
  }
  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
    this.#request.onClose?.();
  }
}

class MatchInputSuggest extends AbstractInputSuggest<WorkbenchSuggesterOption> {
  readonly #request: WorkbenchInputSuggestionsRequest;
  #search = prepareSimpleSearch("");

  constructor(app: App, request: WorkbenchInputSuggestionsRequest) {
    super(app, request.input);
    this.#request = request;
  }

  override getSuggestions(query: string) {
    this.#search = prepareSimpleSearch(query);
    return this.#request.getSuggestions(query);
  }

  override renderSuggestion(option: WorkbenchSuggesterOption, el: HTMLElement) {
    el.addClass("zt-template-workbench-suggestion");
    if (!option.hint) {
      el.addClass("mod-nowrap");
      renderMatches(
        el,
        option.label,
        this.#search(option.label)?.matches ?? null,
      );
      return;
    }
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    renderMatches(
      content.createDiv("suggestion-title"),
      option.label,
      this.#search(option.label)?.matches ?? null,
    );
    renderMatches(
      content.createDiv("suggestion-note"),
      option.hint,
      this.#search(option.hint)?.matches ?? null,
    );
  }

  override selectSuggestion(option: WorkbenchSuggesterOption) {
    this.#request.onSelect(option.id);
    this.close();
  }
}

class EditorSuggester extends SuggestModal<
  WorkbenchSuggesterOption & { group: string }
> {
  readonly #answer = Promise.withResolvers<string | null>();
  #picked = false;
  #search = prepareSimpleSearch("");
  readonly #request: WorkbenchSuggesterRequest;
  constructor(app: App, request: WorkbenchSuggesterRequest) {
    super(app);
    this.setTitle(request.title);
    this.#request = request;
    this.setPlaceholder(request.placeholder ?? request.title);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    const empty = request.groups.find((group) => group.empty)?.empty;
    if (empty && request.groups.every((group) => group.options.length === 0))
      this.emptyStateText = empty;
  }
  override getSuggestions(query: string) {
    this.#search = prepareSimpleSearch(query);
    return this.#request.groups
      .flatMap((group) =>
        group.options.map((option) => ({ ...option, group: group.label })),
      )
      .filter(
        (option) =>
          this.#search(
            `${option.label} ${option.hint ?? ""} ${option.group}`,
          ) !== null,
      );
  }
  /**
   * A row reads the way a citation row reads: the name in the title slot,
   * the hint beneath it, and the group at the trailing edge once the row is
   * wide enough, otherwise as a badge closing the hint line.
   */
  override renderSuggestion(
    option: WorkbenchSuggesterOption & { group: string },
    el: HTMLElement,
  ): void {
    el.addClass("mod-complex", "zt-workbench-suggestion", FLAIR_ROW_CLASS);
    if (option.icon)
      setIcon(
        el.createDiv("suggestion-icon").createSpan("suggestion-flair"),
        templateWorkbenchIcons[option.icon],
      );
    const content = el.createDiv({
      cls: "suggestion-content zt:min-w-0 zt:gap-0.5",
    });
    renderMatches(
      content.createDiv({
        cls: "suggestion-title zt:truncate zt:text-sm zt:leading-tight zt:font-medium",
      }),
      option.label,
      this.#search(option.label)?.matches ?? null,
    );
    if (option.hint || option.group) {
      const note = content.createDiv({
        cls: "suggestion-note zt:leading-tight",
      });
      if (option.hint)
        renderMatches(
          note.createSpan("hint"),
          option.hint,
          this.#search(option.hint)?.matches ?? null,
        );
      if (option.group)
        appendInlineFlair(note, option.group, option.hint ? "zt:ms-1.5" : "");
    }
    for (const match of el.querySelectorAll(".suggestion-highlight")) {
      match.classList.add("zt:text-accent-foreground");
    }
    if (option.id === this.#request.selected) {
      el.setAttribute("aria-current", "true");
      setIcon(
        el.createDiv("suggestion-aux").createSpan({
          cls: "suggestion-flair",
          attr: { "aria-label": m.modal_profile_current() },
        }),
        "check",
      );
    }
    if (option.group) appendTrailingFlair(el, option.group);
  }
  override selectSuggestion(
    value: WorkbenchSuggesterOption & { group: string },
    event: MouseEvent | KeyboardEvent,
  ): void {
    this.#picked = true;
    super.selectSuggestion(value, event);
  }
  override onChooseSuggestion(option: WorkbenchSuggesterOption): void {
    this.#answer.resolve(option.id);
  }
  override onClose(): void {
    super.onClose();
    if (!this.#picked) this.#answer.resolve(null);
    this.#request.anchor?.focus();
  }
  choose(): Promise<string | null> {
    this.open();
    return this.#answer.promise;
  }
}

/**
 * The typing popup wears Obsidian's own suggestion classes, the way Obsidian
 * skins CodeMirror's completion for a Bases formula. Types get their own
 * line so unions and function signatures keep the same reading order.
 */
const nativeCompletion: TemplateCompletionPresentation = {
  tooltipClass: () => "suggestion-container zt-template-completion",
  optionClass: () => "suggestion-item mod-complex",
  addToOptions: [
    {
      position: 60,
      render(completion) {
        const type = completionSuggestion(completion)?.type;
        if (!type) return null;
        return createDiv({ cls: "zt-template-completion-type", text: type });
      },
    },
    {
      position: 70,
      render(completion) {
        const suggestion = completionSuggestion(completion);
        return suggestion && !suggestion.syntax
          ? createDiv({ cls: "suggestion-note", text: suggestion.detail })
          : null;
      },
    },
  ],
};

export function createTemplateWorkbenchHost(
  app: App,
  ports: Pick<WorkbenchHost, "render" | "matchData" | "insertTarget"> &
    Partial<Pick<WorkbenchHost, "markdown">> & {
      /** The view an editor hover popover belongs to; one popover shows at a time. */
      hoverParent?: HoverParent;
    },
  wrap: (content: ReactNode) => ReactNode = (content) => content,
): WorkbenchHost & Disposable {
  const open = new Set<() => void>();
  const { hoverParent = { hoverPopover: null }, ...rest } = ports;
  function track(close: () => void): () => void {
    const release = () => {
      if (open.delete(release)) close();
    };
    open.add(release);
    return release;
  }
  return {
    [Symbol.dispose]() {
      for (const close of open) close();
    },
    ...rest,
    messages: {
      ...m,
      workbench_name_value_no_style: citationStyleLabel,
    },
    getLocale: () => runtime.getLocale(),
    inputSuggestions(request) {
      const popup = new MatchInputSuggest(app, request);
      return { close: track(() => popup.close()) };
    },
    editorPopups(read, parent) {
      const placement = new Compartment();
      return [
        placement.of(tooltips({ parent: parent.ownerDocument.body })),
        ViewPlugin.define((view) => ({
          destroy: parent.onWindowMigrated((win) => {
            view.dispatch({
              effects: placement.reconfigure(
                tooltips({ parent: win.document.body }),
              ),
            });
          }),
        })),
        templateCompletion(read, nativeCompletion),
        templateHover(read, hoverParent),
      ];
    },
    menu({ anchor, items, submenus }) {
      const menu = new Menu();
      for (const item of items)
        menu.addItem((entry) =>
          entry
            .setTitle(item.label)
            .setIcon(item.icon ? templateWorkbenchIcons[item.icon] : null)
            .setDisabled(item.disabled ?? false)
            .onClick(item.onSelect),
        );
      for (const group of submenus ?? [])
        menu.addItem((entry) => {
          entry.setTitle(group.label);
          const submenu = entry.setSubmenu();
          for (const item of group.items)
            submenu.addItem((child) =>
              child
                .setTitle(item.label)
                .setDisabled(item.disabled ?? false)
                .onClick(item.onSelect),
            );
        });
      const bounds = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: bounds.left, y: bounds.bottom });
    },
    dialog(request) {
      const modal = new EditorDialog(app, {
        ...request,
        content: wrap(
          <WorkbenchMessagesProvider messages={m}>
            {request.content}
          </WorkbenchMessagesProvider>,
        ),
        onClose() {
          open.delete(close);
          request.onClose?.();
        },
      });
      const close = track(() => modal.close());
      modal.open();
      return { close };
    },
    confirm(request) {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const modal = new ConfirmationModal(app);
      const close = track(() => modal.close());
      modal.setTitle(request.title);
      modal.setContent(request.body);
      modal.addButton((button) =>
        button.setButtonText(request.confirm).onClick(() => resolve(true)),
      );
      modal.addCancelButton(request.cancel ?? m.modal_cancel());
      modal.setCloseCallback(() => {
        open.delete(close);
        resolve(false);
      });
      modal.open();
      return promise;
    },
    suggester(request) {
      const modal = new EditorSuggester(app, request);
      const close = track(() => modal.close());
      return modal.choose().finally(() => open.delete(close));
    },
    tooltip: tooltipAttrs,
    hoverCard({ anchor, content }) {
      const element = document.body.createDiv({ cls: "popover zt-root" });
      const root = createRoot(element);
      const bounds =
        anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
      element.style.position = "fixed";
      element.style.left = `${bounds.left}px`;
      element.style.top = `${bounds.bottom}px`;
      root.render(
        wrap(
          <WorkbenchMessagesProvider messages={m}>
            {content}
          </WorkbenchMessagesProvider>,
        ),
      );
      return {
        close: track(() => {
          root.unmount();
          element.remove();
        }),
      };
    },
    notice: (text) => {
      new BaseNotice(text);
    },
    persistence: {
      read(scope, key) {
        const value: unknown = app.loadLocalStorage(
          `zotlit.workbench.${scope}.${key}`,
        );
        return typeof value === "string" ? value : null;
      },
      write(scope, key, value) {
        app.saveLocalStorage(`zotlit.workbench.${scope}.${key}`, value);
      },
    },
    toggle: Toggle,
    markdown:
      ports.markdown ??
      function EditorMarkdown({ markdown, showMarkdown }) {
        const container = useRef<HTMLDivElement>(null);
        useEffect(() => {
          const element = container.current;
          if (!element || showMarkdown) return;
          const target = element.createDiv();
          const lifecycle = new Component();
          lifecycle.load();
          void MarkdownRenderer.render(app, markdown, target, "", lifecycle);
          return () => {
            lifecycle.unload();
            target.remove();
          };
        }, [markdown, showMarkdown]);
        return showMarkdown ? (
          <pre>{markdown}</pre>
        ) : (
          <div ref={container} className="markdown-rendered" />
        );
      },
  };
}
