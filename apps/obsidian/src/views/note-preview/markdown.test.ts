// @vitest-environment happy-dom
import { Component } from "obsidian";
import type { App } from "obsidian";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchMessagesProvider } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { isDraftMarkdown } from "@/lib/reading-view";

import { NativeMarkdown } from "./markdown";

const renderer = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  MarkdownRenderer: renderer,
}));
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("keeps native Markdown outside the plugin preflight and preserves its footer boundary", async () => {
  renderer.render.mockImplementation(
    async (
      ...args: Parameters<typeof import("obsidian").MarkdownRenderer.render>
    ) => {
      const [, , target] = args;
      target.append(document.createElement("blockquote"));
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app: { vault: { getConfig: () => false } } as unknown as App,
        markdown: "> Quoted paragraph",
        result: null,
      }),
      container,
    );
  });
  await vi.waitFor(() =>
    expect(container.querySelector("blockquote")).not.toBeNull(),
  );
  const sheet = container.querySelector(".markdown-rendered");
  const draft = sheet?.querySelector("[data-zotlit-draft]");
  expect(sheet?.classList.contains("zt-native-markdown")).toBe(true);
  expect(draft?.nextElementSibling?.className).toBe("mod-footer mod-ui");
});

it("keeps managed Markdown free of extra borders and unloads children when replaced or closed", async () => {
  const unloaded = vi.fn();
  const calls: string[] = [];
  class RenderChild extends Component {
    override onunload() {
      unloaded();
    }
  }
  renderer.render.mockImplementation(
    async (
      ...args: Parameters<typeof import("obsidian").MarkdownRenderer.render>
    ) => {
      const [, markdown, target, , owner] = args;
      calls.push(markdown);
      expect(isDraftMarkdown(target)).toBe(true);
      owner.addChild(new RenderChild());
      for (const line of markdown.split("\n")) {
        if (!line || line.startsWith("%%")) continue;
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        target.append(paragraph);
      }
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const source =
    "Outside\n%%zt-managed%%\nManaged text\n%%/zt-managed%%\nAfter";
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app: { vault: { getConfig: () => false } } as unknown as App,
        markdown: source,
        result: null,
      }),
      container,
    );
  });
  await vi.waitFor(() =>
    expect(container.textContent).toBe("OutsideManaged textAfter"),
  );
  await vi.waitFor(() =>
    expect(container.querySelector("[data-zotlit-preview-pending]")).toBeNull(),
  );
  expect(
    [...container.querySelectorAll("p")].map((element) => element.className),
  ).toEqual(["", "", ""]);
  expect(calls[0]).toBe(source);
  expect(container.textContent).toBe("OutsideManaged textAfter");
  expect(container.querySelector("p")?.className).toBe("");
  const firstChildren = calls.length;
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app: { vault: { getConfig: () => false } } as unknown as App,
        markdown: "Replacement",
        result: null,
      }),
      container,
    );
  });
  await vi.waitFor(() => expect(container.textContent).toBe("Replacement"));
  expect(unloaded).toHaveBeenCalledTimes(firstChildren);
  await act(async () => {
    render(null, container);
  });
  expect(unloaded).toHaveBeenCalledTimes(calls.length);
});

it("shows a placeholder instead of a blank sheet when there is nothing to preview", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const app = { vault: { getConfig: () => false } } as unknown as App;
  await act(async () => {
    render(
      h(NativeMarkdown, { app, markdown: " \n", result: null }),
      container,
    );
  });
  expect(container.textContent).toBe("No content to preview");
  expect(container.querySelector(".markdown-preview-view")).toBeNull();
  expect(renderer.render).not.toHaveBeenCalled();
  await act(async () => {
    render(
      h(WorkbenchMessagesProvider, {
        messages: m,
        // A preact node is the React node under `preact/compat`.
        children: h(NativeMarkdown, {
          app,
          markdown: "",
          result: null,
          properties: [
            { key: "title", value: "A study", missing: false, position: 1 },
          ],
        }) as unknown as ReactNode,
      }),
      container,
    );
  });
  expect(container.querySelector("[data-part=row]")?.textContent).toBe(
    "titleA study",
  );
  expect(
    container.querySelector(".markdown-preview-view")?.textContent,
  ).toContain("No content to preview");
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app,
        markdown: "",
        result: null,
        showMarkdown: true,
      }),
      container,
    );
  });
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).toBe("No content to preview");
});

it("shows the placeholder when the source renders to nothing, as an empty Managed Region does", async () => {
  renderer.render.mockImplementation(
    async (
      ...args: Parameters<typeof import("obsidian").MarkdownRenderer.render>
    ) => {
      const [, , target] = args;
      target.append(document.createElement("p"));
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const app = { vault: { getConfig: () => false } } as unknown as App;
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app,
        markdown: "%%zt-managed%%\n\n%%/zt-managed%%",
        result: null,
      }),
      container,
    );
  });
  await vi.waitFor(() =>
    expect(container.textContent).toContain("No content to preview"),
  );
  expect(
    container.querySelector<HTMLElement>("[data-zotlit-preview-pending]"),
  ).toBeNull();
  expect(
    container.querySelector("[data-zotlit-draft]")?.closest("[hidden]"),
  ).not.toBeNull();
});

it("prints the render's own frontmatter block above the body in the Markdown view", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const app = { vault: { getConfig: () => false } } as unknown as App;
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app,
        markdown: "# A study\n",
        result: null,
        frontmatterBlock: "title: A study\n",
        showMarkdown: true,
      }),
      container,
    );
  });
  expect(container.querySelector("pre")?.textContent).toBe(
    "---\ntitle: A study\n---\n# A study\n",
  );
});

it("opens the Properties block when the Properties tab asks, and leaves the toggle to the reader after that", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const app = { vault: { getConfig: () => false } } as unknown as App;
  const sheet = (expandProperties: boolean) =>
    h(WorkbenchMessagesProvider, {
      messages: m,
      children: h(NativeMarkdown, {
        app,
        markdown: "",
        result: null,
        properties: [
          { key: "title", value: "A study", missing: false, position: 1 },
        ],
        expandProperties,
      }) as unknown as ReactNode,
    });
  const heading = () =>
    container.querySelector<HTMLElement>(".metadata-properties-heading")!;
  const collapsed = () =>
    container
      .querySelector(".metadata-container")
      ?.classList.contains("is-collapsed");
  await act(async () => render(sheet(false), container));
  await act(async () => heading().click());
  expect(collapsed()).toBe(true);
  await act(async () => render(sheet(true), container));
  expect(collapsed()).toBe(false);
  await act(async () => heading().click());
  expect(collapsed()).toBe(true);
});
