// Obsidian owns Markdown rendering; each output owns and unloads its render children.
import { Component, MarkdownRenderer, stringifyYaml } from "obsidian";
import type { App } from "obsidian";
import { useEffect, useRef } from "react";

import { MARKER_START, MARKER_END } from "@zotlit/templates/obsidian";
import type { RenderedProperty, RenderedRange } from "@zotlit/workbench/render";
import { PropertyList } from "@zotlit/workbench/ui";

import { getLogger } from "@/lib/log";
import { citationElement } from "@/services/citation-text/present";
import {
  replaceCitations,
  sectionCitations,
} from "@/services/citekey-reading/render";
import { renderCitationRuns } from "@/services/wikilink-reading/render";

import type { PreviewCitation } from "./citations";
import type { NativeRenderResult } from "./render";

const logger = getLogger(["note-preview", "markdown"]);
const NO_MARKS: readonly RenderedRange[] = [];
export function NativeMarkdown({
  app,
  markdown,
  result,
  marks = NO_MARKS,
  properties = [],
  showMarkdown = false,
  onRendered,
}: {
  app: App;
  markdown: string;
  result: NativeRenderResult | null;
  marks?: readonly RenderedRange[];
  properties?: readonly RenderedProperty[];
  showMarkdown?: boolean;
  onRendered?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element || showMarkdown) return;
    element.dataset["zotlitPreviewPending"] = "";
    const target = element.createDiv();
    target.dataset["zotlitDraft"] = "";
    const lifecycle = new Component();
    let disposed = false;
    lifecycle.load();
    const sourcePath = result?.sourcePath ?? "";
    void (async () => {
      await MarkdownRenderer.render(
        app,
        markdown,
        target,
        sourcePath,
        lifecycle,
      );
      if (disposed) return;
      const start = markdown.indexOf(MARKER_START);
      const end = markdown.indexOf(MARKER_END, start);
      const ranges = [
        ...(start >= 0 && end >= start
          ? [
              {
                from: start + MARKER_START.length,
                to: end,
                className: "zt:border-l-2 zt:border-accent-foreground zt:ps-2",
              },
            ]
          : []),
        ...marks.map((range) => ({ ...range, className: "zt:bg-accent" })),
      ];
      // Native rendering keeps all source bytes. Prefix renders locate the
      // visible range without inserting tokens into headings or callouts.
      const text = visibleText(target);
      for (const range of ranges) {
        const offsets = [];
        for (const end of [range.from, range.to]) {
          const probe = document.createElement("div");
          probe.dataset["zotlitDraft"] = "";
          await MarkdownRenderer.render(
            app,
            markdown.slice(0, end),
            probe,
            sourcePath,
            lifecycle,
          );
          if (disposed) return;
          const prefix = visibleText(probe);
          let matched = 0;
          while (matched < prefix.length && prefix[matched] === text[matched])
            matched++;
          offsets.push(matched);
        }
        markRange(target, {
          from: offsets[0]!,
          to: offsets[1]!,
          className: range.className,
        });
      }
      let citations =
        markdown === result?.annotation
          ? result.annotationCitations
          : (result?.citations ?? []);
      if (
        result &&
        markdown !== result.annotation &&
        markdown !== result.creationBody
      ) {
        const offset = result.creationBody?.indexOf(markdown) ?? -1;
        citations =
          offset < 0
            ? []
            : citations.filter(
                ({ start }) =>
                  start >= offset && start < offset + markdown.length,
              );
      }
      presentCitations(target, citations);
      delete element.dataset["zotlitPreviewPending"];
      onRendered?.();
    })().catch((error: unknown) => {
      logger.warn("Draft Markdown rendering failed", { error });
      if (!disposed) {
        target.textContent = markdown;
        delete element.dataset["zotlitPreviewPending"];
        onRendered?.();
      }
    });
    return () => {
      disposed = true;
      lifecycle.unload();
      target.remove();
    };
  }, [app, markdown, result, marks, showMarkdown, onRendered]);
  const present = properties.filter(({ missing }) => !missing);
  if (showMarkdown) {
    const frontmatter =
      present.length === 0
        ? ""
        : `---\n${stringifyYaml(Object.fromEntries(present.map(({ key, value }) => [key, value])))}---\n`;
    return (
      <pre className="zt:overflow-x-auto zt:font-mono zt:text-sm zt:[overflow-wrap:anywhere] zt:whitespace-pre-wrap zt:select-text">
        {frontmatter}
        {markdown}
      </pre>
    );
  }
  return (
    <>
      {present.length > 0 && (
        <PropertyList properties={present} variant="note" />
      )}
      <div
        ref={container}
        data-zotlit-preview-pending=""
        className="markdown-rendered zt:w-full zt:max-w-(--file-line-width) zt:min-w-0 zt:self-center zt:font-(family-name:--font-text) zt:text-(length:--font-text-size) zt:leading-(--line-height-normal) zt:select-text"
      />
    </>
  );
}
/** Whitespace carries layout, while these offsets locate the rendered characters. */
function compact(value: string): string {
  let text = "";
  for (const character of value) if (character.trim() !== "") text += character;
  return text;
}
function visibleText(element: HTMLElement): string {
  return compact(element.textContent ?? "");
}
function markRange(
  target: HTMLElement,
  { from, to, className }: { from: number; to: number; className: string },
): void {
  const walker = target.ownerDocument.createTreeWalker(
    target,
    NodeFilter.SHOW_TEXT,
  );
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = offset + compact(node.textContent ?? "").length;
    if (offset < to && end > from)
      node.parentElement?.classList.add(...className.split(" "));
    offset = end;
  }
}
/** Use the same replacements as saved notes, with this draft's formatted occurrences. */
export function presentCitations(
  target: HTMLElement,
  formatted: readonly PreviewCitation[],
): void {
  const literal = formatted.filter(({ links }) => links.length === 0);
  let next = 0;
  const citations = sectionCitations(target);
  const matches = citations.map(({ source }) => {
    const index = literal.findIndex(
      (entry, index) => index >= next && entry.source === source,
    );
    if (index < 0) return null;
    next = index + 1;
    return literal[index]!;
  });
  replaceCitations(citations, (_, index) => {
    const value = matches[index];
    return value ? citationElement(target.ownerDocument, value) : null;
  });
  const anchors = [
    ...target.querySelectorAll<HTMLAnchorElement>("a.internal-link"),
  ].filter((anchor) => !anchor.hasAttribute("aria-label"));
  let cursor = 0;
  for (const value of formatted) {
    if (value.links.length === 0) continue;
    const run = [];
    let position = cursor;
    for (const link of value.links) {
      const index = anchors.findIndex(
        (anchor, index) =>
          index >= position && anchor.dataset["href"] === link.target,
      );
      if (index < 0) break;
      position = index + 1;
      run.push({ source: anchors[index]!, citation: link.citation });
    }
    if (run.length !== value.links.length) continue;
    cursor = position;
    renderCitationRuns([run], () => value);
  }
}
