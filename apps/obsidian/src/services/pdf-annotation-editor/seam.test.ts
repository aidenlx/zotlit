// @vitest-environment happy-dom
import { expect, it } from "vitest";

import {
  failedIn,
  host,
  pageView,
  pdfReader,
  SCANNED_CONTENT,
  UNPATCHED_CONTENT,
} from "./__fixtures__";
import {
  onPageRendered,
  pageViewOf,
  PdfSeamProbeLog,
  probeController,
  probeFileView,
  probePageView,
  probeRenderEvent,
  probeTextContent,
} from "./seam";
import type { PdfSeamProbeId } from "./seam";

/** The eleven probes of the seam re-verification, as issue #1140 numbers them. */
const ALL_PROBES: PdfSeamProbeId[] = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
];

function controller() {
  return pdfReader().child;
}

it("passes every probe against the shape Obsidian 1.14.2 exposes", async () => {
  const reader = pdfReader();
  const view = {
    file: { path: "attachments/rougier-2014.pdf" },
    viewer: reader.viewer,
  };
  const results = [
    ...probeFileView(view),
    ...probeController(view.viewer as never, reader.child),
    ...probeRenderEvent({ pageNumber: 1, source: reader.page }),
    ...probePageView(reader.page),
    await probeTextContent(reader.page as never),
  ];

  expect(results).toHaveLength(ALL_PROBES.length);
  expect(new Set(results.map(({ probe }) => probe))).toEqual(
    new Set(ALL_PROBES),
  );
  expect(failedIn(results)).toEqual([]);
});

it("passes P1 for a view between files, where Obsidian nulls the open file", () => {
  expect(
    failedIn(probeFileView({ file: null, viewer: host(controller()) })),
  ).toEqual([]);
});

it.each([
  {
    probe: "P1" as const,
    results: () => probeFileView({ viewer: host(controller()) }),
  },
  {
    probe: "P2" as const,
    results: () =>
      probeFileView({
        file: { path: "a.pdf" },
        // oxlint-disable-next-line unicorn/no-thenable -- a host that lost its child.
        viewer: { then: () => undefined },
      }),
  },
  {
    probe: "P3" as const,
    results: () => probeController(host(controller()) as never, controller()),
  },
  {
    probe: "P4" as const,
    results: () => {
      const child = controller();
      delete child.off;
      return probeController(host(child) as never, child);
    },
  },
  {
    probe: "P5" as const,
    results: () => {
      const child = controller();
      delete child.getPage;
      return probeController(host(child) as never, child);
    },
  },
  {
    probe: "P6" as const,
    results: () => {
      const child = controller();
      delete child.applySubpath;
      return probeController(host(child) as never, child);
    },
  },
  {
    probe: "P7" as const,
    results: () => probeRenderEvent({ source: pageView() }),
  },
  {
    probe: "P8" as const,
    results: () => probePageView({ ...pageView(), div: "<div>" }),
  },
  {
    probe: "P10" as const,
    results: () => {
      const child = { ...controller(), toolbar: null };
      return probeController(host(child) as never, child);
    },
  },
])(
  "fails $probe alone when that member changed shape",
  ({ probe, results }) => {
    expect(failedIn(results())).toEqual([probe]);
  },
);

it.each([
  "viewBox",
  "userUnit",
  "scale",
  "rotation",
  "offsetX",
  "offsetY",
  "transform",
  "width",
  "height",
  "convertToViewportPoint",
])("fails P9 when the viewport lost %s", (member) => {
  const page = pageView();
  delete (page.viewport as Record<string, unknown>)[member];

  expect(failedIn(probePageView(page))).toEqual(["P9"]);
});

it.each(["clone", "convertToPdfPoint"])(
  "fails P9 when %s is present but is no longer a method",
  (member) => {
    const page = pageView();
    (page.viewport as Record<string, unknown>)[member] = "scale";

    expect(failedIn(probePageView(page))).toEqual(["P9"]);
  },
);

it.each(["clone", "convertToPdfPoint"])(
  "passes P9 on a viewport with no %s, which the overlay covers with a fallback",
  (member) => {
    const page = pageView();
    delete (page.viewport as Record<string, unknown>)[member];

    expect(failedIn(probePageView(page))).toEqual([]);
  },
);

it("passes P11 on a scanned page, which answers with no text item", async () => {
  await expect(
    probeTextContent(pageView(SCANNED_CONTENT) as never),
  ).resolves.toMatchObject({ probe: "P11", ok: true });
});

it("passes P11 on a text item the worker found no glyph in", async () => {
  await expect(
    probeTextContent(pageView({ items: [{ chars: [] }] }) as never),
  ).resolves.toMatchObject({ probe: "P11", ok: true });
});

it.each([
  {
    case: "the includeChars patch is gone, so items carry no chars",
    page: () => pageView(UNPATCHED_CONTENT),
  },
  {
    case: "the route is gone",
    page: () => ({ ...pageView(), pdfPage: {} }),
  },
  {
    case: "a glyph no longer carries its rectangle",
    page: () => pageView({ items: [{ chars: [{ c: "E", u: "E" }] }] }),
  },
  {
    case: "the call rejects",
    page: () => ({
      ...pageView(),
      pdfPage: {
        getTextContent: () => Promise.reject(new Error("worker gone")),
      },
    }),
  },
])("fails P11 when $case", async ({ page }) => {
  await expect(probeTextContent(page() as never)).resolves.toMatchObject({
    probe: "P11",
    ok: false,
  });
});

it("removes its page listener from a viewer Obsidian still holds open", () => {
  const reader = pdfReader();
  const listener = () => undefined;

  {
    using _subscription = onPageRendered(reader.child as never, listener);
  }

  expect(reader.child.off).toHaveBeenCalledExactlyOnceWith(
    "pagerendered",
    listener,
  );
});

it("reads nothing off a controller whose viewer Obsidian closed", () => {
  const reader = pdfReader();
  const subscription = onPageRendered(reader.child as never, () => undefined);
  reader.closeViewer();

  // What `off` and `getPage` would throw on instead: the viewer both read
  // through is gone, and every listener and page went with it.
  expect(() => subscription[Symbol.dispose]()).not.toThrow();
  expect(reader.child.off).not.toHaveBeenCalled();
  expect(pageViewOf(reader.child as never, 1)).toBeNull();
  expect(reader.child.getPage).not.toHaveBeenCalled();
});

it("records each probe once and never recovers from a failure", () => {
  const log = new PdfSeamProbeLog(() => "attachments/rougier-2014.pdf");

  log.record([{ probe: "P5", member: "getPage", ok: false }]);
  log.record([{ probe: "P5", member: "getPage", ok: true }]);
  log.record([{ probe: "P6", member: "applySubpath", ok: true }]);

  expect(log.ok).toBe(false);
  expect(log.results).toEqual([
    { probe: "P5", member: "getPage", ok: false },
    { probe: "P6", member: "applySubpath", ok: true },
  ]);
});
