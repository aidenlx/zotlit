// Obsidian owns Markdown rendering; each output owns and unloads its render children.
import { Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import { useEffect, useRef, useState } from "react";

import { MARKER_START, MARKER_END } from "@zotlit/templates/obsidian";
import type { RenderedProperty, RenderedRange } from "@zotlit/workbench/render";
import { PropertyList } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { cn } from "@/lib/utils";
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
  frontmatterBlock = null,
  showMarkdown = false,
  expandProperties = false,
  onRendered,
}: {
  app: App;
  markdown: string;
  result: NativeRenderResult | null;
  marks?: readonly RenderedRange[];
  properties?: readonly RenderedProperty[];
  /** The note's YAML block as the render wrote it; the Markdown view prints it above the body. */
  frontmatterBlock?: string | null;
  showMarkdown?: boolean;
  /** Opens the Properties block when it turns true; the reader's toggle rules after that. */
  expandProperties?: boolean;
  onRendered?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (expandProperties) setCollapsed(false);
  }, [expandProperties]);
  // Source that renders to nothing, such as an empty Managed Region between
  // its markers, is known only once the app has rendered it.
  const [renderedEmpty, setRenderedEmpty] = useState(false);
  const toggleCollapsed = () => setCollapsed((value) => !value);
  useEffect(() => {
    const element = container.current;
    if (!element || showMarkdown) return;
    element.dataset["zotlitPreviewPending"] = "";
    // The pusher stands where the app's does, so its first-block rule applies.
    const pusher = element.createDiv({ cls: "markdown-preview-pusher" });
    const target = element.createDiv();
    target.dataset["zotlitDraft"] = "";
    // Keep the target away from Obsidian's last-section rule, as the native
    // Reading view does with its footer after the rendered blocks.
    const footer = element.createDiv({ cls: "mod-footer mod-ui" });
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
      setRenderedEmpty(
        visibleText(target) === "" &&
          target.querySelector("img, svg, video, audio, iframe, input") ===
            null,
      );
      delete element.dataset["zotlitPreviewPending"];
      onRendered?.();
    })().catch((error: unknown) => {
      logger.warn("Draft Markdown rendering failed", { error });
      if (!disposed) {
        target.textContent = markdown;
        setRenderedEmpty(false);
        delete element.dataset["zotlitPreviewPending"];
        onRendered?.();
      }
    });
    return () => {
      disposed = true;
      lifecycle.unload();
      pusher.remove();
      target.remove();
      footer.remove();
    };
  }, [app, markdown, result, marks, showMarkdown, onRendered]);
  const present = properties.filter(({ missing }) => !missing);
  const blank = markdown.trim() === "";
  if (showMarkdown) {
    const frontmatter = frontmatterBlock ? `---\n${frontmatterBlock}---\n` : "";
    if (blank && !frontmatter) return <EmptyNote />;
    return (
      <pre className="zt:overflow-x-auto zt:font-mono zt:text-sm zt:[overflow-wrap:anywhere] zt:whitespace-pre-wrap zt:select-text">
        {frontmatter}
        {markdown}
      </pre>
    );
  }
  if (blank && present.length === 0) return <EmptyNote />;
  // The sheet is a reading view: the app's own classes lay out the file margins,
  // the readable line width, the Properties block, and the body spacing. The
  // Properties always show here, whatever the vault's own document setting,
  // under the app's own heading, which folds them the way the editor does.
  return (
    <div
      className={cn(
        "markdown-preview-view markdown-rendered show-properties zt-note-preview-sheet zt-native-markdown",
        app.vault.getConfig("readableLineLength") && "is-readable-line-width",
      )}
    >
      {present.length > 0 && (
        <div className="markdown-preview-sizer">
          <div className="mod-header mod-ui">
            <div
              className={cn("metadata-container", collapsed && "is-collapsed")}
            >
              <div
                className="metadata-properties-heading"
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleCollapsed();
                  }
                }}
              >
                <div
                  className={cn(
                    "collapse-indicator collapse-icon",
                    collapsed && "is-collapsed",
                  )}
                >
                  <Icon name="right-triangle" />
                </div>
                <div className="metadata-properties-title">
                  {m.workbench_result_properties()}
                </div>
              </div>
              <div className="metadata-content">
                <PropertyList properties={present} variant="note" />
              </div>
            </div>
          </div>
        </div>
      )}
      {blank ? (
        <div className="markdown-preview-sizer">
          <EmptyNote />
        </div>
      ) : (
        <div
          ref={container}
          data-zotlit-preview-pending=""
          hidden={renderedEmpty}
          className="markdown-preview-sizer markdown-preview-section"
        />
      )}
      {!blank && renderedEmpty && (
        <div className="markdown-preview-sizer">
          <EmptyNote />
        </div>
      )}
    </div>
  );
}
/** Stands where the note would, so a blank result reads as one rather than as a gap. */
function EmptyNote() {
  return (
    <p className="zt:my-6 zt:text-center zt:text-sm zt:text-muted-foreground">
      {m.workbench_result_empty()}
    </p>
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
