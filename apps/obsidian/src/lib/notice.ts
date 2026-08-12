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

  addText(text: string): this {
    this.containerEl.createDiv("zt-notice-text").setText(text);
    return this;
  }

  addSteps(items: readonly string[]): this {
    const list = this.containerEl.createEl("ol");
    list.addClasses(["zt:m-0", "zt:pl-5"]);
    for (const item of items) {
      list.createEl("li", { text: item });
    }
    return this;
  }

  addList(label: string, items: readonly string[]): this {
    const section = this.containerEl.createDiv("zt-notice-list");
    section.addClasses(["zt:flex", "zt:flex-col", "zt:gap-1"]);
    section.createDiv("zt-notice-text").setText(label);
    const list = section.createEl("ul");
    list.addClasses(["zt:m-0", "zt:pl-5"]);
    for (const item of items) {
      const code = list.createEl("li").createEl("code", { text: item });
      code.addClass("zt:break-all");
    }
    return this;
  }

  addAction(cb: (component: ButtonComponent) => void): this {
    if (!this.actionsEl) {
      this.actionsEl = this.containerEl.createDiv("zt-notice-actions");
      this.actionsEl.addClasses(["zt:flex", "zt:gap-4", "zt:justify-end"]);
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
    this.containerEl.addClasses(["zt-notice", "zt:max-w-[300px]"]);
    const messageEl = this.containerEl.querySelector(".notice-message");
    messageEl?.addClasses(["zt:flex", "zt:flex-col", "zt:gap-1.5"]);
  }
}
