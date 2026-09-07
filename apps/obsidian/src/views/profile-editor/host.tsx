// Native overlays and Markdown lifecycle for the shared Profile Editor tree.
import {
  Component,
  ConfirmationModal,
  MarkdownRenderer,
  Menu,
  Modal,
  SuggestModal,
} from "obsidian";
import type { App } from "obsidian";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import type {
  WorkbenchHost,
  WorkbenchDialogRequest,
  WorkbenchSuggesterRequest,
  WorkbenchSuggesterOption,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { tooltipAttrs } from "@/lib/utils";

import { profileEditorIcons } from "./theme";

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

class EditorSuggester extends SuggestModal<
  WorkbenchSuggesterOption & { group: string }
> {
  readonly #answer = Promise.withResolvers<string | null>();
  #picked = false;
  readonly #request: WorkbenchSuggesterRequest;
  constructor(app: App, request: WorkbenchSuggesterRequest) {
    super(app);
    this.setTitle(request.title);
    this.#request = request;
    this.setPlaceholder(request.placeholder ?? request.title);
    const empty = request.groups.find((group) => group.empty)?.empty;
    if (empty && request.groups.every((group) => group.options.length === 0))
      this.emptyStateText = empty;
  }
  override getSuggestions(query: string) {
    const search = query.toLocaleLowerCase();
    return this.#request.groups
      .flatMap((group) =>
        group.options.map((option) => ({ ...option, group: group.label })),
      )
      .filter((option) =>
        `${option.label} ${option.hint ?? ""} ${option.group}`
          .toLocaleLowerCase()
          .includes(search),
      );
  }
  override renderSuggestion(
    option: WorkbenchSuggesterOption & { group: string },
    el: HTMLElement,
  ): void {
    el.createDiv({ text: option.label });
    el.createDiv({
      cls: "suggestion-note",
      text: [option.group, option.hint].filter(Boolean).join(" · "),
    });
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

export function createProfileEditorHost(
  app: App,
  ports: Pick<WorkbenchHost, "render" | "matchData" | "insertTarget"> &
    Partial<Pick<WorkbenchHost, "markdown">>,
  wrap: (content: ReactNode) => ReactNode = (content) => content,
): WorkbenchHost & Disposable {
  const open = new Set<() => void>();
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
    ...ports,
    menu({ anchor, items, submenus }) {
      const menu = new Menu();
      for (const item of items)
        menu.addItem((entry) =>
          entry
            .setTitle(item.label)
            .setIcon(item.icon ? profileEditorIcons[item.icon] : null)
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
        content: wrap(request.content),
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
      root.render(wrap(content));
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
