// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { setup } from "@/services/annotation-repository/__fixtures__";
import type {
  ExcerptDisplayDemand,
  ExcerptImageDisplay,
} from "@/services/excerpt-image/display";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import type { ExcerptRequest } from "@/services/excerpt-image/service";

import { AnnotationPopover } from "./service";
import type { AnnotationHoverRequest } from "./service";

const popovers = vi.hoisted(
  () =>
    [] as {
      render: ReturnType<typeof vi.fn>;
      hide: () => void;
      retarget: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("@/services/citation-popover/popover", () => ({
  CitationHoverPopover: class {
    readonly render = vi.fn(() => true);
    readonly retarget = vi.fn();
    readonly #cleanup: (() => void)[] = [];
    readonly hide = (): void => {
      for (const cleanup of this.#cleanup.splice(0).reverse()) cleanup();
    };

    constructor() {
      popovers.push(this);
    }

    register(cleanup: () => void): void {
      this.#cleanup.push(cleanup);
    }
  },
}));

/** One display demand that paints `image` once a request is stated. */
function excerptDemand(image: ExcerptImageDisplay["image"]) {
  const listeners = new Set<() => void>();
  let display: ExcerptImageDisplay = {
    image: null,
    current: false,
    status: "reading",
  };
  const stated: (ExcerptRequest | null)[] = [];
  let released = false;
  const demand: ExcerptDisplayDemand = {
    demand: (request) => {
      stated.push(request);
      display = { image, current: true, status: "settled" };
      for (const listener of listeners) listener();
    },
    release: () => {
      released = true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => display,
  };
  return {
    demand,
    stated,
    get released() {
      return released;
    },
  };
}

async function harness(stack: AsyncDisposableStack) {
  const { repository, client } = await setup(stack);
  const demands: ReturnType<typeof excerptDemand>[] = [];
  const image = {
    bytes: new Uint8Array([137, 80, 78, 71]),
    format: PNG_FORMAT,
  };
  const request = { annotation: "stated" } as unknown as ExcerptRequest;
  const service = new AnnotationPopover({
    annotations: repository,
    excerptDisplay: {
      open: () => {
        const opened = excerptDemand(image);
        demands.push(opened);
        return opened.demand;
      },
    },
    excerptRequest: async () => request,
    commentRenderer: () => (el, html) => {
      el.textContent = html;
      return () => {
        el.textContent = "";
      };
    },
  });
  stack.use(service);
  const element = document.createElement("div");
  const root = createRoot(element);
  stack.defer(() => root.unmount());
  const hoverParent = { hoverPopover: null };
  return {
    repository,
    client,
    demands,
    request,
    show(
      link: Partial<AnnotationHoverRequest["link"]> & { annotationKey: string },
    ) {
      service.show({
        event: new MouseEvent("mouseover"),
        hoverParent,
        targetEl: element,
        sourcePath: "note.md",
        link: {
          attachmentKey: "RGRPDF24",
          pageLabel: null,
          groupID: null,
          ...link,
        },
      });
    },
    /** What the newest popover draws now. */
    async shown(): Promise<HTMLElement> {
      await vi.waitFor(() =>
        expect(popovers.at(-1)!.render).toHaveBeenCalled(),
      );
      const content = popovers
        .at(-1)!
        .render.mock.calls.at(-1)![0] as ReactElement | null;
      await act(() => root.render(content));
      return element;
    },
  };
}

describe("AnnotationPopover", () => {
  it("shows a highlight's text, page label, and colour", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.show({ annotationKey: "PUPR5FG5" });

    await vi.waitFor(async () => {
      const shown = await run.shown();
      expect(shown.textContent).toContain("Identify Your Message");
      expect(shown.textContent).toContain(m.annot_view_page({ page: "1" }));
      expect(shown.innerHTML).toContain("#2ea8e5");
    });
    expect(run.demands).toEqual([]);
  });

  it("shows a note annotation's comment", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.show({ annotationKey: "HRK7BG32" });

    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        "Making figures is hard :(",
      ),
    );
  });

  it("shows an image annotation's Excerpt Image and lets it go on hide", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.show({ annotationKey: "FDRFQ7C2" });

    await vi.waitFor(async () => {
      const img = (await run.shown()).querySelector("img");
      expect(img?.getAttribute("src")).toMatch(/^blob:/);
    });
    expect(run.demands).toHaveLength(1);
    expect(run.demands[0]!.stated).toEqual([run.request]);

    popovers.at(-1)!.hide();
    expect(run.demands[0]!.released).toBe(true);
  });

  it("says an annotation that no longer exists is unavailable", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.show({ annotationKey: "GONE2345" });

    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toBe(
        m.annotation_popover_unavailable(),
      ),
    );
  });

  it("says a link to an Attachment the library lacks is unavailable", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.show({ attachmentKey: "GONE2345", annotationKey: "PUPR5FG5" });

    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toBe(
        m.annotation_popover_unavailable(),
      ),
    );
  });

  it("redraws an open popover when the annotation changes", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);
    run.show({ annotationKey: "HRK7BG32" });
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        "Making figures is hard :(",
      ),
    );

    run.client.$client.exec(
      "update itemAnnotations set comment = 'Figures are easier now' where itemID = 51",
    );
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
    run.show({ annotationKey: "HRK7BG32" });
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        "Making figures is hard :(",
      ),
    );
    popovers.at(-1)!.hide();

    run.client.$client.exec(
      "update itemAnnotations set comment = 'Figures are easier now' where itemID = 51",
    );
    await run.repository.refresh("RGRPDF24");
    run.show({ annotationKey: "HRK7BG32" });

    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        "Figures are easier now",
      ),
    );
  });
});
