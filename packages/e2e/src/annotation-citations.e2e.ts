import { describe, expect, it } from "vitest";
// Annotation Citations shown as citations: a Durable Annotation Link with no
// text renders as its parent Item's formatted citation, located by the
// Annotation's page, while the setting asks for it. With the setting off, the
// link stays a link. The hover holds the Annotation and the Item's reference
// in one popover either way.

import {
  annotationAttachment,
  attachmentAnnotations,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";
import type { LinkMarkdownView } from "./page-links-types.ts";

const NOTE = "Annotation citations.md";

/** An Annotation on page one of the Rougier PDF. */
const FIRST_PAGE = attachmentAnnotations.find(({ key }) => key === "PUPR5FG5")!;

const URL = `zotero://open/library/items/${annotationAttachment.key}?annotation=${FIRST_PAGE.key}&page=${FIRST_PAGE.pageLabel}`;

/** What one look at the note's Annotation Citation found. */
interface CitationLook {
  /** The text the line or the paragraph holding the link shows. */
  shown: string;
  /** What the hover's popover holds. */
  popover: {
    /** Whether it shows the Annotation. */
    annotation: boolean;
    /** The Annotation's quoted text, as the popover shows it. */
    quote: string;
    /** How many reference blocks it holds. */
    references: number;
    /** How many actions the reference offers. */
    actions: number;
  };
}

/**
 * Writes a note with one Annotation Citation, shows it in `gesture`, hovers
 * the link, and reads what the line and the popover show. Every change is
 * undone before the reply.
 */
async function look({
  gesture,
  render,
  hoverAction = "popover",
}: {
  gesture: "live-preview" | "reading";
  /** `citation.render-annotation-citations` for the look. */
  render: boolean;
  /** `citation.hover-action` for the look. */
  hoverAction?: "off" | "popover" | "page-preview";
}): Promise<CitationLook> {
  return obRun(
    run.vaultId,
    async (
      { zotlit, page },
      { notePath, url, noteGesture, renderCitations, hover, quote },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      await using cleanup = new AsyncDisposableStack();
      links.applySettings(cleanup, {
        "citation.annotation-citations": true,
        "citation.render-annotation-citations": renderCitations,
        "citation.hover-action": hover,
      });
      const { view } = await links.showNote(cleanup, {
        notePath,
        content: `# Draft\n\nAs Rougier argues [](${url}).\n`,
        gesture: noteGesture,
      });
      const shownLine = () =>
        noteGesture === "reading"
          ? (view.previewMode.containerEl
              .querySelector<HTMLAnchorElement>(`a[href="${url}"]`)
              ?.closest("p") ?? null)
          : ([
              ...view.editor.cm.contentDOM.querySelectorAll<HTMLElement>(
                ".cm-line",
              ),
            ].find((line) => line.textContent?.startsWith("As Rougier")) ??
            null);
      // The citation lands once the note's citations are read; until then,
      // and for good with the setting off, the link stays the link it is.
      const target = await until(
        () => {
          const line = shownLine();
          if (!line) return null;
          if (!renderCitations)
            return line.querySelector<HTMLElement>(
              noteGesture === "reading"
                ? `a[href="${url}"]`
                : // The `[]` Obsidian draws for a link with no text.
                  ".zt-annotation-link .cm-link",
            );
          return line.textContent?.includes("Rougier", "As Rougier".length)
            ? line.querySelector<HTMLElement>(".zt-annotation-citation")
            : null;
        },
        () =>
          `The link did not render: ${shownLine()?.outerHTML.slice(0, 300)}`,
      );
      const shown = shownLine()!.textContent ?? "";
      cleanup.defer(() => (view as LinkMarkdownView).hoverPopover?.hide());
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          clientX: box.left + 2,
          clientY: box.top + box.height / 2,
          view: target.ownerDocument.defaultView,
        }),
      );
      const content = await until(
        () =>
          (
            view as LinkMarkdownView
          ).hoverPopover?.hoverEl.querySelector<HTMLElement>(
            ".zt-citation-popover-content",
          ),
        () => "No popover opened over the link",
      );
      await until(
        () => content.textContent?.includes(quote),
        () => `The popover never showed the Annotation: ${content.textContent}`,
      );
      await until(
        () => content.querySelector("[data-citation-popover-actions]"),
        () => `The popover never showed the reference: ${content.textContent}`,
      );
      return {
        shown,
        popover: {
          annotation: content.querySelector("[data-annotation-key]") !== null,
          quote: content.textContent ?? "",
          references: content.querySelectorAll("[data-citation-popover-block]")
            .length,
          actions: content.querySelectorAll(
            "[data-citation-popover-actions] .clickable-icon",
          ).length,
        },
      };
    },
    {
      notePath: NOTE,
      url: URL,
      noteGesture: gesture,
      renderCitations: render,
      hover: hoverAction,
      quote: FIRST_PAGE.text!,
    },
    { timeoutMs: 90000 },
  );
}

describe.skipIf(!reachable)("Annotation Citations", () => {
  registerEndToEndRunHooks();

  it.each(["live-preview", "reading"] as const)(
    "stay links, and hover with the Annotation and the reference, while the setting is off, in %s",
    async (gesture) => {
      const outcome = await look({ gesture, render: false });

      expect(outcome.shown).not.toContain("2014");
      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
      expect(outcome.popover.quote).toContain("Ten Simple Rules");
      expect(outcome.popover.actions).toBeGreaterThanOrEqual(3);
    },
    120000,
  );

  it.each(["live-preview", "reading"] as const)(
    "show as the Item's citation at the Annotation's page, and hover with the Annotation and the reference, in %s",
    async (gesture) => {
      const outcome = await look({ gesture, render: true });

      // The default Chicago author-date style, with the page as the locator.
      expect(outcome.shown).toMatch(
        new RegExp(`\\(Rougier .*2014, ${FIRST_PAGE.pageLabel}\\)`),
      );
      expect(outcome.shown).not.toContain("zotero://");
      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
      expect(outcome.popover.quote).toContain("Ten Simple Rules");
      expect(outcome.popover.actions).toBeGreaterThanOrEqual(3);
    },
    120000,
  );

  it.each(["off", "page-preview"] as const)(
    "hover with the Annotation and the reference whatever the Hover action, under %s",
    async (hoverAction) => {
      const outcome = await look({
        gesture: "live-preview",
        render: true,
        hoverAction,
      });

      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
    },
    120000,
  );
});
