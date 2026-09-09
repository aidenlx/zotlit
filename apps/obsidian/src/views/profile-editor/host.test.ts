// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Menu, Modal, SuggestModal } from "@mock/obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { liquidTemplate } from "@zotlit/workbench/language";
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
    render: () => Promise.reject(new Error("This test renders nothing.")),
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
  it("names the built-in citation style the same way as native citation settings", () => {
    using host = setup().host;
    expect(host.messages.workbench_name_value_no_style()).toBe(
      "Default (Chicago author-date)",
    );
  });

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
    using host = setup().host;
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

  it("draws a suggestion row the way Obsidian's own complex rows read", () => {
    const { host } = setup();
    using open = vi.spyOn(SuggestModal.prototype, "open");
    void host.suggester({
      title: "Styles",
      selected: "apa",
      groups: [
        {
          label: "Installed",
          options: [
            { id: "apa", label: "APA", hint: "Author-date" },
            { id: "ieee", label: "IEEE" },
          ],
        },
      ],
    });
    type Row = { id: string; label: string; hint?: string; group: string };
    const modal = open.mock.contexts.at(-1)! as SuggestModal<Row>;
    const rows = (modal.getSuggestions("") as Row[]).map((option) => {
      const el = document.createElement("div");
      modal.renderSuggestion(option, el);
      return el;
    });
    expect(rows.map((el) => el.className)).toEqual([
      "mod-complex",
      "mod-complex",
    ]);
    expect(
      rows.map((el) => el.querySelector(".suggestion-title")!.textContent),
    ).toEqual(["APA", "IEEE"]);
    expect(
      rows.map(
        (el) => el.querySelector(".suggestion-note")?.textContent ?? null,
      ),
    ).toEqual(["Author-date", null]);
    expect(
      rows.map((el) =>
        [...el.querySelectorAll(".suggestion-aux .suggestion-flair")].map(
          (flair) => flair.getAttribute("aria-label") ?? flair.textContent,
        ),
      ),
    ).toEqual([[m.modal_profile_current(), "Installed"], ["Installed"]]);
    expect(rows.map((el) => el.getAttribute("aria-current"))).toEqual([
      "true",
      null,
    ]);
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

describe("Profile Editor typing popup", () => {
  it("wears Obsidian's suggestion classes, with the description and type as cells", async () => {
    const { host } = setup();
    const input = document.createElement("div");
    const migrations: ((win: Window) => void)[] = [];
    const disposeMigration = vi.fn();
    input.onWindowMigrated = (listener) => {
      migrations.push(listener);
      return disposeMigration;
    };
    input.style.overflow = "hidden";
    document.body.append(input);
    const view = new EditorView({
      state: EditorState.create({
        doc: "{{ zt.",
        extensions: [
          liquidTemplate,
          host.editorPopups!(
            () => ({
              root: "note",
              partials: [],
              fields: [{ path: "title", label: "Title" }],
            }),
            input,
          ),
        ],
      }),
      parent: input,
    });
    try {
      view.dispatch({
        changes: { from: 6, insert: "t" },
        selection: { anchor: 7 },
        userEvent: "input.type",
      });
      const popup = await vi.waitFor(() => {
        const found = document.body.querySelector(".cm-tooltip-autocomplete");
        if (!found) throw new Error("no popup yet");
        return found;
      });
      expect(popup.classList.contains("suggestion-container")).toBe(true);
      expect(document.body.contains(popup)).toBe(true);
      expect(input.contains(popup)).toBe(false);
      const rows = [...popup.querySelectorAll("li")];
      expect(rows.map((row) => row.className)).toEqual(
        rows.map(() => "suggestion-item mod-complex"),
      );
      const row = rows.find(
        (row) =>
          row.querySelector(".cm-completionLabel")!.textContent === "title",
      )!;
      expect(
        row.querySelector(".zt-template-completion-type")!.textContent,
      ).toBe("string | null");
      expect(row.querySelector(".suggestion-note")!.textContent).toBe(
        "Item title.",
      );
      const destination = document.implementation.createHTMLDocument();
      destination.body.append(input);
      view.setRoot(destination);
      migrations[0]!({
        document: destination,
      } as Window);
      expect(
        destination.body.querySelector(".cm-tooltip-autocomplete"),
      ).not.toBeNull();
      expect(
        document.body.querySelector(".cm-tooltip-autocomplete"),
      ).toBeNull();
    } finally {
      view.destroy();
      expect(disposeMigration).toHaveBeenCalledOnce();
      input.remove();
    }
  });
});
