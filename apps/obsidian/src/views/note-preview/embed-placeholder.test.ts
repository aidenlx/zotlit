// A note embed in a template's note preview shows a placeholder before
// Obsidian loads the embedded note. These tests run the post-processor on the
// spans Obsidian's Markdown step writes for `![[…]]`.
// @vitest-environment happy-dom
import type { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { expect, it } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { noteEmbedPlaceholders } from "./embed-placeholder";

const NOTES: Record<string, TFile> = {
  "Reading list": stubService<TFile>("TFile", {
    path: "projects/Reading list.md",
    basename: "Reading list",
    extension: "md",
  }),
  "figure.png": stubService<TFile>("TFile", {
    path: "figure.png",
    basename: "figure",
    extension: "png",
  }),
};

const app = stubService<App>("App", {
  metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
    getFirstLinkpathDest: (path: string) => NOTES[path] ?? null,
  }),
});

const ctx = stubService<MarkdownPostProcessorContext>("Context", {
  sourcePath: "literature/Bush 1945.md",
});

/** The embeds left for Obsidian to load. */
const embedsLeft = (el: HTMLElement) => el.querySelectorAll("[src]").length;

/** Render `srcs` as Obsidian's Markdown step does, inside a preview or not. */
function render(srcs: string[], draft = true): HTMLElement {
  const el = document.createElement("div");
  if (draft) el.dataset["zotlitDraft"] = "";
  for (const src of srcs) {
    const span = el.createSpan({ cls: "internal-embed" });
    span.setAttribute("src", src);
  }
  void noteEmbedPlaceholders(app)(el, ctx);
  return el;
}

it("names a note the vault holds, with its path, in place of its content", () => {
  const el = render(["Reading list#Methods"]);
  const box = el.querySelector('[data-note-preview-embed="found"]');
  expect(box?.textContent).toBe(
    "Reading list › MethodsEmbedded noteThe created note shows the content of projects/Reading list.md here.",
  );
  expect(embedsLeft(el)).toBe(0);
});

it("says a missing note does not exist yet, with no way to create it", () => {
  const el = render(["123"]);
  const box = el.querySelector('[data-note-preview-embed="missing"]');
  expect(box?.textContent).toContain(
    'No note named "123" exists yet. The created note offers to create it here.',
  );
  expect(box?.querySelector("a, button")).toBeNull();
  expect(embedsLeft(el)).toBe(0);
});

it("takes a missing note whose name holds a dot for a note", () => {
  const el = render(["Smith et al. 2020", "scan.pdf"]);
  expect(
    el.querySelectorAll('[data-note-preview-embed="missing"]'),
  ).toHaveLength(2);
  expect(embedsLeft(el)).toBe(0);
});

it("leaves embeds of other files, and Markdown outside a preview, to Obsidian", () => {
  const files = render(["figure.png"]);
  expect(embedsLeft(files)).toBe(1);
  const note = render(["Reading list"], false);
  expect(embedsLeft(note)).toBe(1);
});
