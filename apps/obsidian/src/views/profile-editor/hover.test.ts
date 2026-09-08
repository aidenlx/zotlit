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

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

function mount(parent: HoverParent) {
  view = new EditorView({
    state: EditorState.create({
      doc: "{{ zt.title }}",
      extensions: [
        liquidTemplate,
        templateHighlighting,
        templateHover(() => config, parent),
      ],
    }),
    parent: document.body,
  });
  return view;
}

async function hover(editor: EditorView, hook: string) {
  const token = editor.contentDOM.querySelector(`.${hook}`)!;
  await act(async () => {
    token.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
}

describe("template hover", () => {
  it("opens Obsidian's popover on the field under the pointer after its delay", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    const editor = mount(parent);
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

  it("closes the popover on an edit", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    const editor = mount(parent);
    await hover(editor, themeHook.templateProperty);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).not.toBeNull();
    editor.dispatch({ changes: { from: 0, insert: "x" } });
    expect(parent.hoverPopover).toBeNull();
  });

  it("shows nothing over a delimiter", async () => {
    vi.useFakeTimers();
    const parent: HoverParent = { hoverPopover: null };
    const editor = mount(parent);
    await hover(editor, themeHook.templateDelimiter);
    vi.advanceTimersByTime(300);
    expect(parent.hoverPopover).toBeNull();
  });
});
