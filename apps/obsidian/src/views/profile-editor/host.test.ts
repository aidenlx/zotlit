// @vitest-environment happy-dom
import { Menu, Modal, SuggestModal } from "@mock/obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnnotationPointer } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";

import { createProfileEditorHost } from "./host";

function setup() {
  const memory = new Map<string, string | null>();
  const app = {
    loadLocalStorage: (key: string) => memory.get(key),
    saveLocalStorage: (key: string, value: string | null) =>
      memory.set(key, value),
  } as unknown as App;
  const host = createProfileEditorHost(app, {
    render: () => ({ terminate() {} }),
    matchData: {
      tags: async () => [],
      collections: async () => [],
      libraries: async () => [],
    },
    insertTarget: () => null,
  });
  return { host, memory };
}

describe("Profile Editor host", () => {
  it("opens an Obsidian menu at its control and executes the selected action", () => {
    const { host } = setup();
    const anchor = document.createElement("button");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 100, 25),
    );
    const onSelect = vi.fn();
    host.menu({
      anchor,
      items: [{ label: "Move up", icon: "move-up", onSelect }],
    });
    const menu = Menu.instances.at(-1)!;
    expect(menu.position).toEqual({ x: 20, y: 55 });
    expect(menu.items[0]!.title).toBe("Move up");
    menu.items[0]!.click();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(host.tooltip("Explain field")).toEqual({
      "aria-label": "Explain field",
    });
  });

  it("binds dialogs to Modal and reports dismissal", () => {
    const { host } = setup();
    const onClose = vi.fn();
    const handle = host.dialog({ title: "Details", content: null, onClose });
    const modal = Modal.instances.at(-1)!;
    expect(modal.title).toBe("Details");
    expect(modal.isOpen).toBe(true);
    handle.close();
    modal.onClose();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("supplies pack messages to shared controls in a separately mounted dialog", async () => {
    const { host } = setup();
    const handle = host.dialog({
      title: "Profile panes",
      content: createElement(AnnotationPointer, { onInsert() {} }),
    });
    const modal = Modal.instances.at(-1)!;
    try {
      await act(async () => modal.onOpen());
      expect(
        [...modal.contentEl.querySelectorAll("button")].map(
          (tab) => tab.textContent,
        ),
      ).toContain(m.workbench_annotation_insert());
    } finally {
      handle.close();
      await act(async () => modal.onClose());
      host[Symbol.dispose]();
    }
  });

  it("settles SuggestModal cancellation and restores control focus", async () => {
    const { host } = setup();
    using open = vi.spyOn(SuggestModal.prototype, "open");
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const chosen = host.suggester({
      title: "Styles",
      anchor,
      groups: [
        {
          label: "Installed",
          options: [{ id: "apa", label: "APA", hint: "Author-date" }],
        },
      ],
    });
    const modal = open.mock.contexts.at(-1)! as SuggestModal<unknown>;
    expect(modal.getSuggestions("author")).toEqual([
      { id: "apa", label: "APA", hint: "Author-date", group: "Installed" },
    ]);
    modal.close();
    await expect(chosen).resolves.toBeNull();
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("keeps preferences in Obsidian's vault-local storage", () => {
    const { host, memory } = setup();
    host.persistence.write("vault", "last", "ABCD2345");
    expect(memory.get("zotlit.workbench.vault.last")).toBe("ABCD2345");
    expect(host.persistence.read("vault", "last")).toBe("ABCD2345");
    host.persistence.write("vault", "last", null);
    expect(host.persistence.read("vault", "last")).toBeNull();
  });
});
