// Web hover lifecycle and shadcn Base UI Hover Card presentation. The shared
// resolver also supplies field facts to a native Obsidian HoverPopover adapter.
import { PreviewCard } from "@base-ui/react/preview-card";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { createRoot } from "react-dom/client";

import { hoverHint } from "@zotlit/workbench/completion";
import type {
  SuggestionResult,
  SuggestionSource,
} from "@zotlit/workbench/language";

/** Resolve under the pointer; leave text, selection, and focus with the editor. */
export function webHover(read: SuggestionSource) {
  return ViewPlugin.fromClass(
    class {
      readonly #root = createRoot(document.createElement("div"));
      #hint: SuggestionResult | null = null;
      #open = false;
      #timer: ReturnType<typeof setTimeout> | undefined;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          update.geometryChanged
        )
          this.close();
      }

      move(event: MouseEvent) {
        if (
          event.buttons ||
          this.view.composing ||
          this.view.contentDOM.hasAttribute("aria-controls")
        ) {
          this.close();
          return;
        }
        const position = this.view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        if (position === null) {
          this.leave();
          return;
        }
        const config = read(position);
        const hint = config
          ? hoverHint(this.view.state.doc.toString(), position, config)
          : null;
        const start = hint && this.view.coordsAtPos(hint.from, 1);
        const end = hint && this.view.coordsAtPos(hint.to, -1);
        if (
          !hint ||
          !start ||
          !end ||
          event.clientX < Math.min(start.left, end.left) ||
          event.clientX > Math.max(start.right, end.right) ||
          event.clientY < start.top ||
          event.clientY > end.bottom
        ) {
          this.leave();
          return;
        }
        if (this.#hint?.from === hint.from && this.#hint.to === hint.to) {
          if (this.#open) this.keep();
          return;
        }
        this.close();
        this.#hint = hint;
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          // Read current sample facts at show time, since the sample can change
          // without a document transaction while the pointer waits.
          const current = read(position);
          this.#hint = current
            ? hoverHint(this.view.state.doc.toString(), position, current)
            : null;
          this.#open = this.#hint !== null;
          this.render();
        }, 500);
      }

      keep() {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }

      leave() {
        if (!this.#open) {
          this.close();
          return;
        }
        // A short grace period lets the pointer cross the gap into the card.
        if (this.#timer === undefined)
          this.#timer = setTimeout(() => this.close(), 300);
      }

      close() {
        this.keep();
        this.#hint = null;
        if (!this.#open) return;
        this.#open = false;
        this.render();
      }

      render() {
        const hint = this.#hint;
        const option = hint?.options[0];
        this.#root.render(
          this.#open && hint && option ? (
            <PreviewCard.Root
              open
              onOpenChange={(open) => {
                if (!open) this.close();
              }}
            >
              <PreviewCard.Portal container={this.view.dom.ownerDocument.body}>
                <PreviewCard.Positioner
                  anchor={{
                    getBoundingClientRect: () => {
                      const start = this.view.coordsAtPos(hint.from, 1);
                      const end = this.view.coordsAtPos(hint.to, -1);
                      return start && end
                        ? new DOMRect(
                            Math.min(start.left, end.left),
                            start.top,
                            Math.abs(end.right - start.left),
                            end.bottom - start.top,
                          )
                        : this.view.dom.getBoundingClientRect();
                    },
                  }}
                  side="top"
                  align="start"
                  sideOffset={6}
                  className="z-50"
                  onMouseEnter={() => this.keep()}
                  onMouseLeave={() => this.leave()}
                >
                  <PreviewCard.Popup
                    data-slot="hover-card-content"
                    className="w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-fd-border bg-fd-popover p-3 text-xs text-fd-popover-foreground shadow-lg"
                  >
                    <div className="flex items-baseline gap-2">
                      <strong>{option.displayLabel ?? option.label}</strong>
                      <span className="ml-auto font-mono text-fd-muted-foreground">
                        {option.type}
                      </span>
                    </div>
                    {option.path && (
                      <div className="font-mono text-fd-muted-foreground">
                        {option.path}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{option.detail}</p>
                    {option.example !== undefined && (
                      <code className="block max-h-48 overflow-auto break-words whitespace-pre-wrap text-fd-muted-foreground">
                        {option.example}
                      </code>
                    )}
                  </PreviewCard.Popup>
                </PreviewCard.Positioner>
              </PreviewCard.Portal>
            </PreviewCard.Root>
          ) : null,
        );
      }

      destroy() {
        this.keep();
        queueMicrotask(() => this.#root.unmount());
      }
    },
    {
      eventObservers: {
        mousemove(event) {
          this.move(event);
        },
        mouseleave() {
          this.leave();
        },
        mousedown() {
          this.close();
        },
        keydown() {
          this.close();
        },
        scroll() {
          this.close();
        },
      },
    },
  );
}
