// Obsidian's renderer runs in a real browser window where `window` and
// `globalThis` are the same object; the `node` test environment has no
// `window` global, so source code that calls `window.setTimeout()` /
// `window.clearInterval()` etc. (for popout-window compatibility, see
// AGENTS.md → Obsidian guideline review) throws `ReferenceError: window is
// not defined` under Vitest without this stub.
globalThis.window ??= globalThis;

// Obsidian's renderer also supplies `DOMParser`, which source code reads XML
// and HTML with. The `node` test environment has none, so a test that runs
// such code borrows happy-dom's — the same parser the `happy-dom` environment
// installs, here without taking that whole environment on.
if (typeof globalThis.DOMParser === "undefined") {
  const { Window } = await import("happy-dom");
  globalThis.DOMParser = new Window().DOMParser;
}

// Obsidian patches every window (main and popout alike, each patched by its
// own copy of this same runtime script) with a `createEl()`/`createDiv()`/
// `createSpan()`/`createFragment()` global family and a `Node.prototype`
// `createEl()`/`createDiv()`/`createSpan()` + `.doc`/`.win` pair — used over
// `document.createElement()`/`ownerDocument` per AGENTS.md → Obsidian
// guideline review. Ported from Obsidian 1.13.4's `enhance.js` (see
// `/obsidian-asar-extract`), trimmed to the option keys this plugin passes.
// `Node`/`Window` are undefined in the plain `node` test environment; each
// guard below skips the patch there, since no DOM exists for it to attach to.

globalThis.createEl ??= (tag, o, callback) => {
  const el = document.createElement(tag);
  const info = typeof o === "string" ? { cls: o } : (o ?? {});
  if (info.cls !== undefined) {
    el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  }
  if (info.text !== undefined) {
    if (typeof info.text === "string") el.textContent = info.text;
    else el.append(info.text);
  }
  if (info.attr) {
    for (const [name, value] of Object.entries(info.attr)) {
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, String(value));
    }
  }
  if (info.title !== undefined) el.title = info.title;
  if (
    info.value !== undefined &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLOptionElement)
  ) {
    el.value = info.value;
  }
  if (info.type !== undefined && el instanceof HTMLInputElement) {
    el.type = info.type;
  }
  if (info.placeholder !== undefined && el instanceof HTMLInputElement) {
    el.placeholder = info.placeholder;
  }
  if (
    info.href !== undefined &&
    (el instanceof HTMLAnchorElement || el instanceof HTMLLinkElement)
  ) {
    el.href = info.href;
  }
  callback?.(el);
  if (info.parent) {
    if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
    else info.parent.appendChild(el);
  }
  return el;
};
globalThis.createDiv ??= (o, callback) =>
  globalThis.createEl("div", o, callback);
globalThis.createSpan ??= (o, callback) =>
  globalThis.createEl("span", o, callback);
globalThis.createFragment ??= (callback) => {
  const fragment = document.createDocumentFragment();
  callback?.(fragment);
  return fragment;
};

if (typeof Window !== "undefined") {
  const winProto = Window.prototype;
  winProto.createEl ??= globalThis.createEl;
  winProto.createDiv ??= globalThis.createDiv;
  winProto.createSpan ??= globalThis.createSpan;
  winProto.createFragment ??= globalThis.createFragment;
}

if (typeof Node !== "undefined") {
  const proto = Node.prototype;
  if (!Object.getOwnPropertyDescriptor(proto, "doc")) {
    Object.defineProperty(proto, "doc", {
      configurable: true,
      get() {
        return this.ownerDocument ?? document;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(proto, "win")) {
    Object.defineProperty(proto, "win", {
      configurable: true,
      get() {
        return this.doc.defaultView ?? window;
      },
    });
  }
  proto.createEl ??= function (tag, o, callback) {
    const info = typeof o === "string" ? { cls: o } : (o ?? {});
    return globalThis.createEl(tag, { ...info, parent: this }, callback);
  };
  proto.createDiv ??= function (o, callback) {
    return proto.createEl.call(this, "div", o, callback);
  };
  proto.createSpan ??= function (o, callback) {
    return proto.createEl.call(this, "span", o, callback);
  };
  proto.setText ??= function (val) {
    if (typeof val === "string") this.textContent = val;
    else {
      this.textContent = "";
      this.append(val);
    }
  };
}

// The same runtime script patches every element with the `addClass()` family
// the plugin styles its own notices and views with.
if (typeof Element !== "undefined") {
  const proto = Element.prototype;
  proto.addClass ??= function (...classes) {
    this.classList.add(...classes);
  };
  proto.addClasses ??= function (classes) {
    this.classList.add(...classes);
  };
}
