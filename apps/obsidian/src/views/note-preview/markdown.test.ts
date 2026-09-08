// @vitest-environment happy-dom
import { Component } from "obsidian";
import type { App } from "obsidian";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

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

it("keeps original Markdown, marks its managed text, and unloads children when replaced or closed", async () => {
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
      h(NativeMarkdown, { app: {} as App, markdown: source, result: null }),
      container,
    );
  });
  await vi.waitFor(() =>
    expect(
      container.querySelectorAll("p")[1]?.classList.contains("zt:border-l-2"),
    ).toBe(true),
  );
  expect(calls[0]).toBe(source);
  expect(container.textContent).toBe("OutsideManaged textAfter");
  expect(container.querySelector("p")?.className).toBe("");
  const firstChildren = calls.length;
  await act(async () => {
    render(
      h(NativeMarkdown, {
        app: {} as App,
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
