// Web presentation for the shared Template Completion results. CodeMirror keeps focus.
import { Popover } from "@base-ui/react/popover";
import { Prec } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { Command } from "cmdk";
import { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { suggestions } from "@zotlit/workbench/completion";
import { applyTemplateCompletion } from "@zotlit/workbench/language";
import type {
  SuggestionResult,
  SuggestionSource,
} from "@zotlit/workbench/language";

import { m } from "@/paraglide/messages.js";

/** The editor owns the query and keys; React owns the Command list and Base UI popup. */
export function webCompletion(read: SuggestionSource) {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        readonly #host = document.createElement("div");
        readonly #root = createRoot(this.#host);
        #result: SuggestionResult | null = null;
        #active = 0;
        constructor(readonly view: EditorView) {}

        update(update: ViewUpdate) {
          if (
            update.transactions.some((tr) => tr.isUserEvent("input.pair-close"))
          ) {
            this.close();
            return;
          }
          if (update.focusChanged && !this.view.hasFocus) {
            this.close();
            return;
          }
          if (
            update.transactions.some((tr) => tr.isUserEvent("input.complete"))
          )
            return;
          if (update.docChanged || update.selectionSet) {
            const typed = update.transactions.some(
              (tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete"),
            );
            if (typed || this.#result) this.open();
          }
        }

        open() {
          const config = read(this.view.state.selection.main.head);
          const { state } = this.view;
          this.#result =
            config && state.selection.main.empty && !this.view.composing
              ? suggestions(
                  state.doc.toString(),
                  state.selection.main.head,
                  config,
                )
              : null;
          if (!this.#result?.options.length) this.#result = null;
          this.#active = 0;
          this.render();
        }

        close() {
          this.#result = null;
          this.render();
        }

        accept(index = this.#active) {
          const result = this.#result;
          const option = result?.options[index];
          if (!result || !option || this.view.composing) return;
          this.#result = null;
          const more = applyTemplateCompletion(this.view, result, option);
          this.view.focus();
          if (more) this.open();
          else this.render();
        }

        key(event: KeyboardEvent) {
          if (event.isComposing || this.view.composing) return false;
          if (event.ctrlKey && event.code === "Space") {
            this.open();
            return true;
          }
          const count = this.#result?.options.length;
          if (!count) return false;
          if (event.key === "Escape") {
            this.close();
            return true;
          }
          if (event.key === "Enter") {
            this.accept();
            return true;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            this.#active =
              (this.#active + (event.key === "ArrowDown" ? 1 : -1) + count) %
              count;
            this.render();
            return true;
          }
          return false;
        }

        render() {
          this.view.contentDOM.setAttribute("aria-autocomplete", "list");
          if (this.#result)
            this.view.contentDOM.setAttribute("aria-haspopup", "listbox");
          if (!this.#result) {
            this.view.contentDOM.removeAttribute("aria-haspopup");
            this.view.contentDOM.removeAttribute("aria-activedescendant");
            this.view.contentDOM.removeAttribute("aria-controls");
          }
          this.#root.render(
            this.#result ? (
              <CompletionPopup
                view={this.view}
                result={this.#result}
                active={this.#active}
                onSelect={(index) => {
                  this.#active = index;
                  this.render();
                }}
                onAccept={(index) => this.accept(index)}
                onClose={() => this.close()}
              />
            ) : null,
          );
        }

        destroy() {
          // A parent React commit can destroy the editor; finish that commit first.
          queueMicrotask(() => this.#root.unmount());
          for (const attribute of [
            "aria-autocomplete",
            "aria-haspopup",
            "aria-controls",
            "aria-activedescendant",
          ])
            this.view.contentDOM.removeAttribute(attribute);
        }
      },
      {
        eventHandlers: {
          keydown(event) {
            return this.key(event);
          },
        },
      },
    ),
  );
}

function CompletionPopup({
  view,
  result,
  active,
  onSelect,
  onAccept,
  onClose,
}: {
  view: EditorView;
  result: SuggestionResult;
  active: number;
  onSelect: (index: number) => void;
  onAccept: (index: number) => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Command applies aria-selected in its own effect. Use our active index so
    // focus announcements and scrolling follow this keypress, not the last one.
    const selected =
      list.current?.querySelectorAll<HTMLElement>("[cmdk-item]")[active];
    if (selected) {
      view.contentDOM.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView({ block: "nearest" });
    }
    if (list.current)
      view.contentDOM.setAttribute("aria-controls", list.current.id);
  }, [view, result, active]);
  const anchor = {
    getBoundingClientRect: () => {
      const coords = view.coordsAtPos(view.state.selection.main.head);
      return coords
        ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
        : view.dom.getBoundingClientRect();
    },
  };
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          sideOffset={5}
          align="start"
          className="z-50"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            onMouseDown={(event) => event.preventDefault()}
            className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-fd-border bg-fd-popover text-fd-popover-foreground shadow-lg"
          >
            <Command
              label={m.workbench_completion_label()}
              shouldFilter={false}
              value={String(active)}
              onValueChange={(value) => onSelect(Number(value))}
            >
              <Command.List
                label={m.workbench_completion_label()}
                aria-expanded="true"
                ref={list}
                className="max-h-72 overflow-y-auto p-1"
              >
                {result.options.map((option, index) => (
                  <Command.Item
                    key={`${option.category}:${option.label}`}
                    value={String(index)}
                    onSelect={() => onAccept(index)}
                    className="flex cursor-default flex-col gap-0.5 rounded-sm px-2 py-1.5 text-xs aria-selected:bg-fd-accent aria-selected:text-fd-accent-foreground"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">
                        {option.displayLabel ?? option.label}
                      </span>
                      <span className="ml-auto truncate font-mono text-[0.65rem] text-fd-muted-foreground">
                        {option.type}
                      </span>
                    </span>
                    {option.path && (
                      <span className="font-mono text-[0.65rem] text-fd-muted-foreground">
                        {option.path}
                      </span>
                    )}
                    {option.syntax && index === active && (
                      <>
                        <span className="whitespace-normal text-fd-muted-foreground">
                          {option.detail}
                        </span>
                        <code className="break-words whitespace-pre-wrap">
                          {option.syntax}
                        </code>
                      </>
                    )}
                    {option.example && (!option.syntax || index === active) && (
                      <span
                        className={
                          option.syntax
                            ? "break-words whitespace-pre-wrap text-fd-muted-foreground"
                            : "truncate text-fd-muted-foreground"
                        }
                      >
                        {option.example}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
