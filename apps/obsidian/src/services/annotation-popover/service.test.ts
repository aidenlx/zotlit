// @vitest-environment happy-dom
// What a hovered link shows is proven in the running app
// (`packages/e2e/src/annotation-links.e2e.ts`). These cases cover what the
// End-to-end Run cannot time or observe: a popover held open across a change
// in the repository, two reads that land out of order, the Excerpt Image read
// a hidden popover lets go, and image bytes that fail to decode.
import type { HoverParent } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { Effect, Stream } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { setup } from "@/services/annotation-repository/__fixtures__";
import { redPng } from "@/services/excerpt-image/__fixtures__/png";
import {
  EXCERPT_DISPLAY,
  ExcerptDisplayService,
} from "@/services/excerpt-image/display";
import { savedExcerptRequest } from "@/services/excerpt-image/request";
import { ExcerptImageService } from "@/services/excerpt-image/service";

import { AnnotationPopover } from "./service";
import type { AnnotationHoverRequest } from "./service";

/** The card a hover parent shows, once Obsidian's opening delay has passed. */
async function shownUnder(parent: HoverParent): Promise<HTMLElement> {
  await vi.waitFor(() => expect(parent.hoverPopover).not.toBeNull());
  return parent.hoverPopover!.hoverEl;
}

/**
 * The popover over the real Annotation repository, reading the Fixture's
 * Annotations from an in-memory Zotero database. A comment renders through
 * Obsidian's Markdown renderer, which stands outside the test: it is drawn as
 * text. No case here hovers an Annotation with an Excerpt Image.
 */
async function harness(stack: AsyncDisposableStack) {
  const {
    repository,
    service: annotations,
    bridge,
    client,
  } = await setup(stack);
  const popover = stack.use(
    new AnnotationPopover({
      annotations,
      bridge,
      excerptDisplay: {
        open: () => {
          throw new Error("No hovered Annotation here has an Excerpt Image");
        },
      },
      excerptRequest: () =>
        Promise.reject(new Error("No Excerpt Image is asked for")),
      commentRenderer: () => (el, html) => {
        el.textContent = html;
        return () => {
          el.textContent = "";
        };
      },
    }),
  );
  const hoverParent: HoverParent = { hoverPopover: null };
  return {
    repository,
    client,
    hoverParent,
    /** Hovers a link over a target of its own; settles once its read drew. */
    show(
      link: Partial<AnnotationHoverRequest["link"]> & { annotationKey: string },
    ): Promise<void> {
      const targetEl = document.body.appendChild(
        document.createElement("span"),
      );
      stack.defer(() => targetEl.remove());
      return popover.show({
        event: new MouseEvent("mouseover"),
        hoverParent,
        targetEl,
        sourcePath: "note.md",
        link: {
          attachmentKey: "RGRPDF24",
          pageLabel: null,
          groupID: null,
          ...link,
        },
      });
    },
    /** What the popover draws now. */
    shown: () => shownUnder(hoverParent),
  };
}

/** The note Annotation's comment, as the Fixture holds it. */
const COMMENT = "Making figures is hard :(";
const EDITED =
  "update itemAnnotations set comment = 'Figures are easier now' where itemID = 51";

describe("AnnotationPopover", () => {
  it("redraws an open popover when the annotation changes", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);
    await run.show({ annotationKey: "HRK7BG32" });
    expect((await run.shown()).textContent).toContain(COMMENT);

    run.client.$client.exec(EDITED);
    await run.repository.refresh("RGRPDF24");

    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        "Figures are easier now",
      ),
    );
  });

  it("reads the annotation again on the next hover", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);
    await run.show({ annotationKey: "HRK7BG32" });
    expect((await run.shown()).textContent).toContain(COMMENT);
    run.hoverParent.hoverPopover!.hide();

    run.client.$client.exec(EDITED);
    await run.repository.refresh("RGRPDF24");
    await run.show({ annotationKey: "HRK7BG32" });

    expect((await run.shown()).textContent).toContain("Figures are easier now");
  });

  // The pointer moves on to a second link before the first link's read
  // answers, and the first read lands last. Holding the first hover's
  // database read under the real repository held the second hover's read
  // too, so the order is not reversed there: the reads are held here, each
  // answering with the list the repository read for its Attachment.
  it("keeps the newer link when the first hover's read lands after it", async () => {
    await using stack = new AsyncDisposableStack();
    const { repository, bridge } = await setup(stack);
    const lists = {
      EPUBBKS2: await repository.read("EPUBBKS2"),
      RGRPDF24: await repository.read("RGRPDF24"),
    };
    const reads: { key: string; held: PromiseWithResolvers<void> }[] = [];
    const service = stack.use(
      new AnnotationPopover({
        annotations: {
          read: (key) =>
            Effect.promise(async () => {
              const held = Promise.withResolvers<void>();
              reads.push({ key, held });
              await held.promise;
              return lists[key as keyof typeof lists];
            }),
          hold: () => Effect.succeed({ [Symbol.dispose]: () => {} }),
          annotationsChanged: Stream.never,
        },
        bridge,
        excerptDisplay: {
          open: () => {
            throw new Error("No hovered Annotation here has an Excerpt Image");
          },
        },
        excerptRequest: () =>
          Promise.reject(new Error("No Excerpt Image is asked for")),
        commentRenderer: () => (el, html) => {
          el.textContent = html;
          return () => {};
        },
      }),
    );
    const hoverParent: HoverParent = { hoverPopover: null };
    const show = (link: { attachmentKey: string; annotationKey: string }) => {
      const targetEl = document.body.appendChild(
        document.createElement("span"),
      );
      stack.defer(() => targetEl.remove());
      return service.show({
        event: new MouseEvent("mouseover"),
        hoverParent,
        targetEl,
        sourcePath: "note.md",
        link: { ...link, pageLabel: null, groupID: null },
      });
    };

    const stale = show({
      attachmentKey: "EPUBBKS2",
      annotationKey: "EPUBMRK2",
    });
    const fresh = show({
      attachmentKey: "RGRPDF24",
      annotationKey: "HRK7BG32",
    });
    expect(reads.map(({ key }) => key)).toEqual(["EPUBBKS2", "RGRPDF24"]);
    reads[1]!.held.resolve();
    await fresh;
    reads[0]!.held.resolve();
    await stale;

    const card = await shownUnder(hoverParent);
    expect(card.textContent).toContain(COMMENT);
    expect(card.textContent).not.toContain("A paragraph in a reflowable book");
  });
});

// Whether a real Excerpt Image shows in the popover is proven in the running
// app. These cases cover what it cannot observe: the display read a hidden
// popover lets go, and bytes the browser fails to decode.
describe("AnnotationPopover with an Excerpt Image", () => {
  const DATA_DIR = "/zotero";

  /**
   * The Fixture's image Annotation in a popover, over the real repository and
   * the real Excerpt Image display. Every file the image service reads answers
   * with one red pixel, which the browser never decodes here: a case fires
   * the decode failure itself.
   */
  async function harness(stack: AsyncDisposableStack) {
    const {
      service: annotations,
      bridge,
      db,
      queryClient,
    } = await setup(stack);
    const images = stack.use(
      new ExcerptImageService({ read: async () => redPng }),
    );
    const display = stack.use(
      new ExcerptDisplayService({
        queries: queryClient,
        resolve: (request, signal) => images.resolve(request, signal),
        stored: (request) => images.stored(request),
      }),
    );
    const service = stack.use(
      new AnnotationPopover({
        annotations,
        bridge,
        excerptDisplay: display,
        excerptRequest: ({ annotation, source }) =>
          savedExcerptRequest({
            annotation,
            source,
            sourceScope: DATA_DIR,
            zoteroReads: db,
            paths: { dataDir: DATA_DIR, baseAttachmentPath: null },
          }),
        commentRenderer: () => () => () => {},
      }),
    );
    const hoverParent: HoverParent = { hoverPopover: null };
    const targetEl = document.body.appendChild(document.createElement("span"));
    stack.defer(() => targetEl.remove());
    await service.show({
      event: new MouseEvent("mouseover"),
      hoverParent,
      targetEl,
      sourcePath: "note.md",
      link: {
        attachmentKey: "RGRPDF24",
        annotationKey: "FDRFQ7C2",
        pageLabel: null,
        groupID: null,
      },
    });
    const card = await shownUnder(hoverParent);
    const img = await vi.waitFor(() => {
      const found = card.querySelector("img");
      expect(found).not.toBeNull();
      return found!;
    });
    return {
      card,
      img,
      hoverParent,
      /** The display reads the query client holds now. */
      displayReads: () =>
        queryClient.client
          .getQueryCache()
          .findAll({ queryKey: [EXCERPT_DISPLAY] }).length,
    };
  }

  it("lets the Excerpt Image's display read go when the popover hides", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);
    expect(run.displayReads()).toBe(1);

    run.hoverParent.hoverPopover!.hide();

    expect(run.displayReads()).toBe(0);
  });

  it("says the Excerpt Image is unavailable when its bytes fail to decode", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.img.dispatchEvent(new Event("error"));

    await vi.waitFor(() => {
      expect(run.card.querySelector("img")).toBeNull();
      expect(run.card.textContent).toContain(m.annot_view_image_unavailable());
    });
  });
});
