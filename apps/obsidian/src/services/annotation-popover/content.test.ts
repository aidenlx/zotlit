// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type {
  ExcerptDisplayDemand,
  ExcerptImageDisplay,
} from "@/services/excerpt-image/display";
import { PNG_FORMAT } from "@/services/excerpt-image/format";

import { AnnotationPopoverContent } from "./content";

const record = (patch: Partial<AnnotationRecord>): AnnotationRecord =>
  ({
    key: "PUPR5FG5",
    type: "highlight",
    color: "#2ea8e5",
    comment: null,
    text: null,
    parentKey: "RGRPDF24",
    pageLabel: "1",
    sortIndex: "00000|002041|00170",
    tags: [],
    position: { pageIndex: 0, rects: [] },
    version: null,
    ...patch,
  }) as AnnotationRecord;

/** A demand whose display already holds one image. */
function holding(): ExcerptDisplayDemand {
  const display: ExcerptImageDisplay = {
    image: { bytes: new Uint8Array([137, 80, 78, 71]), format: PNG_FORMAT },
    current: true,
    status: "settled",
  };
  return {
    demand: () => {},
    release: () => {},
    subscribe: () => () => {},
    snapshot: () => display,
  };
}

async function rendered(
  stack: DisposableStack,
  props: Parameters<typeof AnnotationPopoverContent>[0],
): Promise<HTMLElement> {
  const element = document.createElement("div");
  const root = createRoot(element);
  stack.defer(() => root.unmount());
  await act(() => root.render(createElement(AnnotationPopoverContent, props)));
  return element;
}

describe("AnnotationPopoverContent", () => {
  it("renders the quoted text's rich-text tags rather than showing them", async () => {
    using stack = new DisposableStack();
    const element = await rendered(stack, {
      kind: "annotation",
      annotation: record({ text: "E = mc<sup>2</sup>" }),
      renderComment: () => () => {},
      excerpt: null,
    });

    expect(element.querySelector("sup")?.textContent).toBe("2");
    expect(element.textContent).not.toContain("<sup>");
  });

  it("says the Excerpt Image is unavailable when its bytes fail to decode", async () => {
    using stack = new DisposableStack();
    const element = await rendered(stack, {
      kind: "annotation",
      annotation: record({ key: "FDRFQ7C2", type: "image", pageLabel: "2" }),
      renderComment: () => () => {},
      excerpt: holding(),
    });
    const img = element.querySelector("img")!;

    await act(() => {
      img.dispatchEvent(new Event("error"));
    });

    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain(m.annot_view_image_unavailable());
  });
});
