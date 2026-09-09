// What the template token under the pointer means, shown in Obsidian's own
// popover: the shared resolver names the field, tag, or filter; the popover
// opens once per pointer visit and follows the pointer between tokens. As in
// VS Code, the open card keeps its content and rendered place until the
// pointer has rested on the next token for the hover delay, then swaps; its
// native target moves at once so the off-token grace keeps working.
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { HoverParent, Point } from "obsidian";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { hoverHint } from "@zotlit/workbench/completion";
import type { Suggestion, SuggestionSource } from "@zotlit/workbench/language";

import { SingletonHoverPopover } from "@/lib/singleton-hover-popover";
import { themeHook } from "@/lib/theme-hooks";

/**
 * Obsidian's own hover delay, which every popover of its own opens after. It
 * also serves as the dwell before an open card swaps to the next token.
 */
const WAIT_TIME = 300;

class TemplateHoverPopover extends SingletonHoverPopover {
  #root: Root | null;
  constructor(parent: HoverParent, token: HTMLElement, option: Suggestion) {
    super(parent, token, WAIT_TIME);
    const mount = this.hoverEl.createDiv({
      cls: ["zt-root", themeHook.templateHover],
    });
    this.#root = createRoot(mount);
    this.#root.render(<HoverFacts option={option} />);
    // The card takes its place again as the content settles.
    this.watchResize(mount);
    this.register(() => {
      this.#root?.unmount();
      this.#root = null;
    });
    // Content exists before show(); cancelling the enter delay must unload it.
    this.load();
  }

  render(option: Suggestion): void {
    flushSync(() => this.#root?.render(<HoverFacts option={option} />));
    if (this.hoverEl.isConnected) this.position();
  }

  /**
   * Obsidian anchors a popover to the union of its target's boxes, which for
   * a token that wraps is the whole line. The card anchors to the token's
   * first box instead, read live on every placement.
   */
  override position(): void {
    const box = this.targetEl?.getClientRects()[0];
    this.staticPos = box
      ? ({ x: box.left, y: box.top + box.height / 2 } satisfies Point)
      : null;
    super.position();
    if (!box) return;
    const card = this.hoverEl.getBoundingClientRect();
    // Keep Obsidian's side selection and horizontal viewport clamp.
    if (card.top >= box.bottom) this.hoverEl.style.top = `${box.bottom + 4}px`;
    else if (card.bottom <= box.top)
      this.hoverEl.style.top = `${box.top - card.height - 4}px`;
  }
}

function HoverFacts({ option }: { option: Suggestion }) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-2 zt:p-2 zt:text-sm zt:leading-normal zt:break-words zt:select-text">
      <div className="zt:flex zt:flex-wrap zt:items-baseline zt:gap-x-2 zt:gap-y-0.5">
        <strong className="zt:max-w-full zt:min-w-0">
          {option.path ?? option.displayLabel ?? option.label}
        </strong>
        {option.type && (
          <span className="zt:max-w-full zt:min-w-0 zt:font-mono zt:text-xs zt:text-muted-foreground">
            {option.type}
          </span>
        )}
      </div>
      <p>{option.detail}</p>
      {option.syntax && (
        <code className="zt:block zt:font-mono zt:text-xs zt:break-words zt:whitespace-pre-wrap">
          {option.syntax}
        </code>
      )}
      {option.example !== undefined && (
        <code className="zt:block zt:max-h-48 zt:overflow-auto zt:font-mono zt:text-xs zt:break-words zt:whitespace-pre-wrap zt:text-muted-foreground">
          {option.example}
        </code>
      )}
    </div>
  );
}

/**
 * Hover presentation over one pane. The resolved token's range is the
 * content's identity. An open card swaps to a new range only after the pointer
 * has dwelt on it for the hover delay; a card still opening swaps at once so
 * the first card is never stale. Native target events own the off-token
 * grace; leaving the editor, an edit, a keystroke, or a click closes the visit
 * early.
 */
export function templateHover(read: SuggestionSource, parent: HoverParent) {
  return ViewPlugin.fromClass(
    class {
      #popover: TemplateHoverPopover | null = null;
      #target: HTMLElement | null = null;
      #range: { from: number; to: number } | null = null;
      #pending: {
        range: { from: number; to: number };
        timer: ReturnType<typeof setTimeout>;
      } | null = null;
      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("mouseout", this.#handoff, true);
      }

      // Native mouseout hides a still-Showing popover immediately. Move its
      // listeners before that handler runs to retain the original enter timer.
      readonly #handoff = (event: MouseEvent) => {
        if (this.#popover) this.move(event, event.relatedTarget);
      };

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged)
          this.close();
      }

      move(event: MouseEvent, element = event.target) {
        const target =
          element instanceof HTMLElement
            ? element.closest<HTMLElement>(".cm-line span")
            : null;
        if (!target || !this.view.contentDOM.contains(target)) {
          this.#target = null;
          this.#cancelSwap();
          return;
        }
        if (target === this.#target) return;
        this.#target = target;
        const position = this.view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        const config = position === null ? null : read(position);
        const hint =
          config && position !== null
            ? hoverHint(this.view.state.doc.toString(), position, config)
            : null;
        const option = hint?.options[0];
        if (!hint || !option) {
          this.#cancelSwap();
          return;
        }
        this.#popover?.retarget(target);
        if (this.#range?.from === hint.from && this.#range.to === hint.to) {
          this.#cancelSwap();
          return;
        }
        const popover = this.#popover;
        // An attached card is open; one still waiting to open swaps at once.
        if (popover?.hoverEl.isConnected) {
          if (
            this.#pending?.range.from === hint.from &&
            this.#pending.range.to === hint.to
          )
            return;
          this.#cancelSwap();
          const range = { from: hint.from, to: hint.to };
          this.#pending = {
            range,
            timer: setTimeout(() => {
              this.#pending = null;
              this.#range = range;
              popover.render(option);
            }, WAIT_TIME),
          };
          return;
        }
        this.#range = { from: hint.from, to: hint.to };
        if (popover) {
          popover.render(option);
          return;
        }
        const opened = new TemplateHoverPopover(parent, target, option);
        this.#popover = opened;
        opened.register(() => {
          if (this.#popover !== opened) return;
          this.#popover = null;
          this.#target = null;
          this.#range = null;
          this.#cancelSwap();
        });
      }

      #cancelSwap() {
        if (!this.#pending) return;
        clearTimeout(this.#pending.timer);
        this.#pending = null;
      }

      close() {
        const popover = this.#popover;
        this.#popover = null;
        this.#target = null;
        this.#range = null;
        this.#cancelSwap();
        popover?.hide();
      }

      leave(event: MouseEvent) {
        if (
          event.relatedTarget instanceof Node &&
          this.#popover?.hoverEl.contains(event.relatedTarget)
        )
          return;
        this.close();
      }

      destroy() {
        this.view.contentDOM.removeEventListener(
          "mouseout",
          this.#handoff,
          true,
        );
        this.close();
      }
    },
    {
      eventObservers: {
        mousemove(event) {
          this.move(event);
        },
        mouseleave(event) {
          this.leave(event);
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
