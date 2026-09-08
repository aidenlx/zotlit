// What the template token under the pointer means, shown in Obsidian's own
// popover: the shared resolver names the field, tag, or filter; the popover
// opens after Obsidian's hover delay and closes when the pointer leaves.
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { HoverPopover } from "obsidian";
import type { HoverParent, Point } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { hoverHint } from "@zotlit/workbench/completion";
import type { Suggestion, SuggestionSource } from "@zotlit/workbench/language";

import { themeHook } from "@/lib/theme-hooks";

/** Obsidian's own hover delay, which every popover of its own opens after. */
const WAIT_TIME = 300;

class TemplateHoverPopover extends HoverPopover {
  #root: Root | null;
  readonly #token: HTMLElement;
  constructor(parent: HoverParent, token: HTMLElement, option: Suggestion) {
    super(parent, token, WAIT_TIME);
    this.#token = token;
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
  }

  /**
   * Obsidian anchors a popover to the union of its target's boxes, which for
   * a token that wraps is the whole line. The card anchors to the token's
   * first box instead, read live on every placement.
   */
  override position(): void {
    const box = this.#token.getClientRects()[0];
    this.staticPos = box
      ? ({ x: box.left, y: box.top + box.height / 2 } satisfies Point)
      : null;
    super.position();
  }
}

function HoverFacts({ option }: { option: Suggestion }) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-2 zt:p-3 zt:text-sm zt:leading-normal zt:break-words zt:select-text">
      <div className="zt:flex zt:flex-wrap zt:items-baseline zt:gap-x-2 zt:gap-y-1">
        <strong className="zt:max-w-full zt:min-w-0">
          {option.displayLabel ?? option.label}
        </strong>
        {option.type && (
          <span className="zt:ms-auto zt:max-w-full zt:min-w-0 zt:font-mono zt:text-xs zt:text-muted-foreground">
            {option.type}
          </span>
        )}
      </div>
      {option.path && (
        <div className="zt:font-mono zt:text-xs zt:text-muted-foreground">
          {option.path}
        </div>
      )}
      <p className="zt:whitespace-pre-wrap">{option.detail}</p>
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
 * Hover presentation over one pane. A highlighted token is the popover's
 * target, so Obsidian hides the popover as the pointer leaves it; an edit,
 * a keystroke, or a click closes it early.
 */
export function templateHover(read: SuggestionSource, parent: HoverParent) {
  return ViewPlugin.fromClass(
    class {
      #popover: TemplateHoverPopover | null = null;
      #target: HTMLElement | null = null;
      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged)
          this.close();
      }

      move(event: MouseEvent) {
        const target =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>(".cm-line span")
            : null;
        if (!target || !this.view.contentDOM.contains(target)) return;
        if (target === this.#target) return;
        this.close();
        const position = this.view.posAtDOM(target);
        const config = read(position);
        const hint = config
          ? hoverHint(this.view.state.doc.toString(), position, config)
          : null;
        const option = hint?.options[0];
        if (!option) return;
        this.#target = target;
        target.addEventListener("mouseleave", () => this.close(), {
          once: true,
        });
        this.#popover = new TemplateHoverPopover(parent, target, option);
      }

      close() {
        this.#popover?.hide();
        this.#popover = null;
        this.#target = null;
      }

      destroy() {
        this.close();
      }
    },
    {
      eventObservers: {
        mousemove(event) {
          this.move(event);
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
