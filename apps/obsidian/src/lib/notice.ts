import { ButtonComponent, Notice } from "obsidian";

/**
 * Notice that defers its underlying `Notice` construction until the first
 * `setMessage` call. Pair with `using` so an undisposed loading toast clears
 * automatically when the caller scope exits.
 */
export class LazyNotice implements Disposable {
  #notice: Notice | null = null;

  setMessage(message: string | DocumentFragment) {
    if (!this.#notice) {
      this.#notice = new BaseNotice(message, 0);
    } else {
      this.#notice.setMessage(message);
    }
  }

  [Symbol.dispose]() {
    this.#notice?.hide();
  }
}

class NoticeRenderer {
  titleEl: HTMLElement;
  actionsEl: HTMLElement | null = null;
  containerEl: DocumentFragment;

  constructor() {
    this.titleEl = createDiv("zt-notice-text");
    this.containerEl = createFragment((frag) => {
      frag.appendChild(this.titleEl);
    });
  }

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }

  addAction(cb: (component: ButtonComponent) => void): this {
    if (!this.actionsEl) {
      this.actionsEl = this.containerEl.createDiv("zt-notice-actions");
      this.actionsEl.addClasses(["flex", "gap-4", "justify-end"]);
    }
    cb(new ButtonComponent(this.actionsEl));
    return this;
  }
}

export class BaseNotice extends Notice {
  static render(cb: (renderer: NoticeRenderer) => void): DocumentFragment {
    const renderer = new NoticeRenderer();
    cb(renderer);
    return renderer.containerEl;
  }

  constructor(message: string | DocumentFragment, duration?: number) {
    super(message, duration);
    this.containerEl.addClasses(["zt-notice", "max-w-[300px]"]);
    const messageEl = this.containerEl.querySelector(".notice-message");
    messageEl?.addClasses(["flex", "flex-col", "gap-[var(--size-2-3)]"]);
  }
}
