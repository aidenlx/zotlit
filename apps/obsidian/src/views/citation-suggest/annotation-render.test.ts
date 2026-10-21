// @vitest-environment happy-dom
// An Annotation Suggester row draws Zotero's stored rich text as the
// Annotation View does, never as literal markup.
import type { App, EditorSuggestContext } from "obsidian";
import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { QueryService } from "@/services/item-query/service";
import type { CommentRenderer } from "@/views/annot-view/comment-render";

import type { AnnotationHit } from "./annotation-search";
import {
  AnnotationEditorSuggest,
  renderAnnotationHit,
} from "./annotation-suggest";
import type { AnnotationSuggestDeps } from "./annotation-suggest";

const hit: AnnotationHit = {
  key: "ANN2HGHT",
  attachmentKey: "PDF2LIVE",
  itemKey: "ART2FULL",
  type: "highlight",
  text: "E = mc<sup>2</sup>",
  comment: "<b>Key</b> result",
  color: "#ffd400",
  pageLabel: "4",
  title: "Exact Matching in Literature Review",
  citationKey: null,
};

/**
 * Stands in for the comment renderer every annotation surface shares: it
 * marks what it drew, so a row that draws the comment itself shows.
 */
function commentRenderer() {
  const rendered: string[] = [];
  const renderComment: CommentRenderer = (el, html) => {
    rendered.push(html);
    el.createSpan({ cls: "rendered-comment", text: html });
    return () => {};
  };
  return { rendered, renderComment };
}

describe("renderAnnotationHit", () => {
  it("draws the quote as rich text and the comment through the shared comment renderer", () => {
    const el = document.createElement("div");
    const { rendered, renderComment } = commentRenderer();
    renderAnnotationHit(hit, el, renderComment);
    expect(el.querySelector("sup")?.textContent).toBe("2");
    expect(rendered).toEqual(["<b>Key</b> result"]);
    expect(el.querySelector(".rendered-comment")?.textContent).toBe(
      "<b>Key</b> result",
    );
  });

  it("draws a comment with no quote through the shared comment renderer", () => {
    const el = document.createElement("div");
    const { rendered, renderComment } = commentRenderer();
    renderAnnotationHit(
      { ...hit, type: "note", text: null, comment: "**important**" },
      el,
      renderComment,
    );
    expect(rendered).toEqual(["**important**"]);
  });

  it("names the page as the Annotation View does, then the paper", () => {
    const el = document.createElement("div");
    renderAnnotationHit(hit, el, commentRenderer().renderComment);
    expect(el.textContent).toContain(
      `${m.annot_view_page({ page: "4" })} · Exact Matching in Literature Review`,
    );
  });

  it("names the type of an annotation with no text, from the message catalog", () => {
    const el = document.createElement("div");
    renderAnnotationHit(
      { ...hit, type: "image", text: null, comment: null },
      el,
      commentRenderer().renderComment,
    );
    expect(el.textContent).toContain(
      m.workbench_annotation_type({ type: "image" }),
    );
    expect(el.textContent).not.toContain("image");
  });
});

describe("AnnotationEditorSuggest rows", () => {
  /**
   * A suggester whose search finds one commented annotation per query word,
   * and whose comment renderer counts the comments still drawn.
   */
  function setup() {
    const live = new Set<string>();
    const run: QueryService["run"] = async (request) => {
      if (request.from === "items")
        return {
          kind: "result",
          result: { rows: [{ indexedKey: "PAPER" }] },
        } as never;
      const words =
        /contains\("([^"]*)"\)/.exec(request.filter ?? "")?.[1] ?? "";
      return {
        kind: "result",
        result: {
          groups: [
            {
              value: "PAPER",
              rows: [`${words}-1`, `${words}-2`].map((key) => ({
                indexedKey: key,
                attachmentIndexedKey: "PDF",
                itemIndexedKey: "PAPER",
                values: { comment: key },
              })),
            },
          ],
        },
      } as never;
    };
    const suggest = new AnnotationEditorSuggest({
      app: {} as App,
      settings: { current: undefined },
      query: { run },
      commentRenderer: (): CommentRenderer => (el, html) => {
        live.add(html);
        el.setText(html);
        return () => live.delete(html);
      },
    } as unknown as AnnotationSuggestDeps);
    const show = async (query: string) => {
      const hits = await suggest.getSuggestions({
        query,
        file: null,
      } as unknown as EditorSuggestContext);
      for (const hit of hits)
        suggest.renderSuggestion(hit, document.createElement("div"));
    };
    return { live, show, suggest };
  }

  it("lets go of the comments of the rows a new search replaces", async () => {
    const h = setup();
    await h.show("fig");
    expect([...h.live].toSorted()).toEqual(["fig-1", "fig-2"]);

    await h.show("table");

    expect([...h.live].toSorted()).toEqual(["table-1", "table-2"]);
  });

  it("lets go of every drawn comment as it closes", async () => {
    const h = setup();
    await h.show("fig");

    h.suggest.close();

    expect([...h.live]).toEqual([]);
  });
});
