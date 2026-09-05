// @vitest-environment happy-dom
import type { Setting, SettingDefinitionGroup, SettingGroup } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION, DOCS_SITE_URL } from "@/lib/constants";
import { defaults } from "@/services/settings/schema";

import type { SettingTabContext } from "./context";
import { zoteroPageItems } from "./zotero";

beforeAll(() => {
  globalThis.createFragment = (() =>
    document.createDocumentFragment()) as typeof createFragment;
  globalThis.createEl = ((tag: string) =>
    document.createElement(tag)) as typeof createEl;
  globalThis.createSpan = ((options?: { cls?: string; text?: string }) => {
    const span = document.createElement("span");
    if (options?.cls) span.className = options.cls;
    if (options?.text) span.textContent = options.text;
    return span;
  }) as typeof createSpan;
});

afterEach(() => vi.unstubAllGlobals());

function context(): SettingTabContext {
  return {
    settings: { current: defaults },
    libraryScope: {
      effective: defaults["zotero.library-scope"],
      current: null,
      invalid: false,
      libraries: [],
    },
  } as unknown as SettingTabContext;
}

describe("Zotero settings page", () => {
  it.each([
    [0, DOCS_COMPANION],
    [1, `${DOCS_SITE_URL}/docs/how-to/fix-stale-data`],
  ])("opens guide %i at its documented URL", (index, expectedUrl) => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    buttonAction(index)();

    expect(open).toHaveBeenCalledWith(expectedUrl);
  });
});

function buttonAction(index: number): () => void {
  let action: (() => void) | undefined;
  const button = {
    setButtonText: () => button,
    onClick: (onClick: () => void) => {
      action = onClick;
      return button;
    },
  };
  const setting = {
    addButton: (configure: (component: typeof button) => void) => {
      configure(button);
      return setting;
    },
  };
  const connection = zoteroPageItems(context())[0] as SettingDefinitionGroup;
  const item = connection.items![index];
  if (!item || !("render" in item) || !item.render) {
    throw new Error(`Zotero setting ${index} has no custom renderer`);
  }
  item.render(setting as unknown as Setting, {} as SettingGroup);
  if (!action) throw new Error(`Zotero setting ${index} has no button`);
  return action;
}
