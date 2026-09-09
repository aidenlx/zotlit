// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { HoverParent } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  liquidTemplate,
  templateHighlighting,
} from "@zotlit/workbench/language";
import type { SuggestionConfig } from "@zotlit/workbench/language";

import { themeHook } from "@/lib/theme-hooks";

import { templateHover } from "./hover";

const config: SuggestionConfig = {
  root: "note",
  partials: [],
  fields: [{ path: "title", label: "Title" }],
};

let pointer: Element | null = null;
afterEach(() => {
  pointer = null;
  vi.useRealTimers();
});

function mount(parent: HoverParent, doc = "{{ zt.title }}") {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        liquidTemplate,
        templateHighlighting,
        templateHover(() => config, parent),
      ],
    }),
    parent: document.body,
  });
  return Object.assign(view, {
    [Symbol.dispose]() {
      view.destroy();
    },
  });
}

/**
 * Moves the pointer onto the first span carrying `hook`. happy-dom lays
 * nothing out, so the pointer resolves to the span's start, the way a pointer
 * at its left edge would.
 */
async function hover(editor: EditorView, hook: string | Element) {
  const token =
    typeof hook === "string"
      ? editor.contentDOM.querySelector(`.${hook}`)!
      : hook;
  vi.spyOn(editor, "posAtCoords").mockReturnValue(editor.posAtDOM(token));
  await act(async () => {
    if (pointer !== token) {
      pointer?.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: token }),
      );
      token.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: pointer }),
      );
      pointer = token;
    }
    token.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
}

describe("template hover", () => {
  it("starts fresh after a pending hover is cancelled off-token", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(100);
    await hover(editor, themeHook.templateDelimiter);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBeNull();
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(299);
    expect(parent.hoverPopover).toBeNull();
    vi.advanceTimersByTime(1);
    expect(
      parent.hoverPopover?.hoverEl.querySelector("strong")?.textContent,
    ).toBe("zt.title");
  });

  it("keeps positioning beside the first wrapped box after many swaps", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    const variable = editor.contentDOM.querySelector(
      `.${themeHook.templateVariable}`,
    )!;
    const property = editor.contentDOM.querySelector(
      `.${themeHook.templateProperty}`,
    )!;
    vi.spyOn(variable, "getClientRects").mockReturnValue([
      new DOMRect(100, 10, 20, 20),
    ] as unknown as DOMRectList);
    vi.spyOn(property, "getClientRects").mockReturnValue([
      new DOMRect(140, 50, 20, 20),
      new DOMRect(0, 70, 30, 20),
    ] as unknown as DOMRectList);
    await hover(editor, variable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    vi.spyOn(popover.hoverEl, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 500, 150, 100),
    );
    for (let swap = 0; swap < 12; swap++) {
      await hover(editor, property);
      vi.advanceTimersByTime(300);
      expect(parent.hoverPopover).toBe(popover);
      expect(popover.hoverEl.querySelector("strong")!.textContent).toBe(
        "zt.collections",
      );
      expect(popover.hoverEl.style.top).toBe("74px");
      await hover(editor, variable);
      vi.advanceTimersByTime(300);
      expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
      expect(popover.hoverEl.style.top).toBe("34px");
    }
  });

  it.each(["mousedown", "keydown", "scroll"])(
    "closes at once on %s",
    async (event) => {
      vi.useFakeTimers();
      const parent: HoverParent = { hoverPopover: null };
      using editor = mount(parent);
      await hover(editor, themeHook.templateProperty);
      vi.advanceTimersByTime(300);
      const popover = parent.hoverPopover!;
      editor.contentDOM.dispatchEvent(new Event(event, { bubbles: true }));
      expect(parent.hoverPopover).toBeNull();
      expect(popover.hoverEl.isConnected).toBe(false);
    },
  );

  it("opens on the latest token at the original visit deadline", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(100);
    await hover(editor, themeHook.templateOperator);
    vi.advanceTimersByTime(100);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(99);
    expect(parent.hoverPopover).toBeNull();
    expect(document.querySelector(".hover-popover")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(
      parent.hoverPopover?.hoverEl.querySelector("strong")?.textContent,
    ).toBe("zt.collections");
  });

  it("keeps the card open while the pointer enters its selectable content", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    const content = popover.hoverEl.querySelector("strong")!;
    pointer!.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: content }),
    );
    editor.contentDOM.dispatchEvent(
      new MouseEvent("mouseleave", { relatedTarget: content }),
    );
    content.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: pointer }),
    );
    vi.advanceTimersByTime(600);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.textContent).toContain("Item title.");
    content.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBeNull();
  });

  it("closes on leaving the editor and gives the next visit a fresh delay", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    editor.contentDOM.dispatchEvent(
      new MouseEvent("mouseleave", { relatedTarget: document.body }),
    );
    expect(parent.hoverPopover).toBeNull();
    expect(popover.hoverEl.isConnected).toBe(false);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(299);
    expect(parent.hoverPopover).toBeNull();
    vi.advanceTimersByTime(1);
    expect(parent.hoverPopover).not.toBeNull();
    expect(parent.hoverPopover).not.toBe(popover);
  });

  it("cancels the grace close when returning to the same token across whitespace", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, editor.contentDOM.querySelector(".cm-line")!);
    vi.advanceTimersByTime(200);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe(
      "zt.title",
    );
  });

  it.each(["delimiter", "whitespace"])(
    "closes after the native grace time on %s",
    async (rest) => {
      vi.useFakeTimers();
      const parent: HoverParent = { hoverPopover: null };
      using editor = mount(parent);
      await hover(editor, themeHook.templateProperty);
      vi.advanceTimersByTime(300);
      const popover = parent.hoverPopover!;
      await hover(
        editor,
        rest === "delimiter"
          ? themeHook.templateDelimiter
          : editor.contentDOM.querySelector(".cm-line")!,
      );
      vi.advanceTimersByTime(299);
      expect(parent.hoverPopover).toBe(popover);
      expect(popover.hoverEl.isConnected).toBe(true);
      vi.advanceTimersByTime(1);
      expect(parent.hoverPopover).toBeNull();
      expect(popover.hoverEl.isConnected).toBe(false);
    },
  );

  it("keeps the old card while the pointer settles on the next token, then swaps", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(299);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
    vi.advanceTimersByTime(1);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe(
      "zt.collections",
    );
    expect(popover.hoverEl.isConnected).toBe(true);
  });

  it("restarts the swap wait when a third token is reached before the swap", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections | join: ', ' }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(200);
    await hover(editor, themeHook.templateFilter);
    vi.advanceTimersByTime(299);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
    vi.advanceTimersByTime(1);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("join");
  });

  it("drops the pending swap when the pointer returns to the shown token", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(200);
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(600);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
  });

  it("drops the pending swap on an off-token rest and waits again on return", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(200);
    await hover(editor, editor.contentDOM.querySelector(".cm-line")!);
    vi.advanceTimersByTime(100);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(299);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
    vi.advanceTimersByTime(1);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe(
      "zt.collections",
    );
  });

  it("closes at once during a pending swap and starts the next visit fresh", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(200);
    editor.contentDOM.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(parent.hoverPopover).toBeNull();
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBeNull();
    expect(popover.hoverEl.isConnected).toBe(false);
    await hover(editor, themeHook.templateVariable);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).not.toBeNull();
    expect(parent.hoverPopover).not.toBe(popover);
    expect(
      parent.hoverPopover!.hoverEl.querySelector("strong")!.textContent,
    ).toBe("zt.collections");
  });

  it("drops the pending swap when the pointer moves on to a delimiter", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent, "{{ zt.collections }}");
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(200);
    await hover(editor, themeHook.templateDelimiter);
    vi.advanceTimersByTime(299);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
    vi.advanceTimersByTime(1);
    expect(parent.hoverPopover).toBeNull();
  });

  it("opens Obsidian's popover on the field under the pointer after its delay", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    expect(parent.hoverPopover).toBeNull();
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    expect(popover.hoverEl.className).toBe("popover hover-popover");
    const card = popover.hoverEl.querySelector(`.${themeHook.templateHover}`)!;
    expect(card.classList.contains("zt-root")).toBe(true);
    expect(card.querySelector("strong")!.textContent).toBe("zt.title");
    expect(card.querySelector("span")!.textContent).toBe("string | null");
    expect(card.querySelector("p")!.textContent).toBe("Item title.");
    expect(card.textContent).toContain("zt.title");
  });

  it("keeps the popover as the pointer crosses the dot of the same token", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateVariable);
    vi.advanceTimersByTime(300);
    const popover = parent.hoverPopover!;
    await hover(editor, themeHook.templateOperator);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover.hoverEl.querySelector("strong")!.textContent).toBe("zt");
  });

  it("closes the popover on an edit", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).not.toBeNull();
    editor.dispatch({ changes: { from: 0, insert: "x" } });
    expect(parent.hoverPopover).toBeNull();
  });

  it("shows nothing over a delimiter", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    using editor = mount(parent);
    await hover(editor, themeHook.templateDelimiter);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBeNull();
  });
});
