import type { TemplateRenderResult } from "#/render/index";
import { describe, expect, it } from "vitest";

import { pendingView } from "./pending-view";
import type { RenderSchedulerState } from "./scheduler-atoms";

import { failedRender } from "#/render/index";

const result = (filename: string | null): TemplateRenderResult => ({
  ...failedRender(
    {
      sourceRevision: "s",
      snapshotRevision: "i",
      mode: "create",
    } as Parameters<typeof failedRender>[0],
    { code: "render-error" },
  ),
  diagnostics: [],
  filename,
});

const LATEST = result("Latest");
const LAST_GOOD = result("Last good");
/** A surface that read the note name, and one whose last output lacked it. */
const SURFACES = {
  produced: (r: TemplateRenderResult) => r.filename !== null,
  "not produced": () => false,
} as const;

type Reason = RenderSchedulerState["staleReason"];

describe("pendingView", () => {
  const cases: readonly {
    readonly staleReason: Reason;
    readonly surface: keyof typeof SURFACES;
    readonly latest: TemplateRenderResult | null;
    readonly expected: {
      shown: TemplateRenderResult | null;
      retained: boolean;
      notice: string | null;
    };
  }[] = [
    {
      staleReason: null,
      surface: "produced",
      latest: LATEST,
      expected: { shown: LATEST, retained: false, notice: null },
    },
    {
      staleReason: null,
      surface: "not produced",
      latest: LATEST,
      expected: { shown: LATEST, retained: false, notice: null },
    },
    {
      staleReason: "live",
      surface: "produced",
      latest: LATEST,
      expected: { shown: LATEST, retained: false, notice: null },
    },
    {
      staleReason: "live",
      surface: "produced",
      latest: null,
      expected: { shown: null, retained: false, notice: "rendering" },
    },
    {
      staleReason: "demand",
      surface: "produced",
      latest: LATEST,
      expected: { shown: LATEST, retained: false, notice: "behind" },
    },
    {
      staleReason: "demand",
      surface: "not produced",
      latest: null,
      expected: { shown: null, retained: false, notice: "behind" },
    },
    {
      staleReason: "hold",
      surface: "produced",
      latest: LATEST,
      expected: { shown: LATEST, retained: false, notice: "held" },
    },
    {
      staleReason: "hold",
      surface: "not produced",
      latest: null,
      expected: { shown: null, retained: false, notice: null },
    },
    {
      staleReason: "invalid",
      surface: "produced",
      latest: LATEST,
      expected: { shown: LAST_GOOD, retained: true, notice: "failed" },
    },
    {
      staleReason: "invalid",
      surface: "not produced",
      latest: LATEST,
      expected: { shown: null, retained: false, notice: "failed" },
    },
  ];
  it.each(cases)(
    "$staleReason on a surface it $surface",
    ({ staleReason, surface, latest, expected }) => {
      expect(
        pendingView(
          { staleReason, result: latest, retained: LAST_GOOD },
          SURFACES[surface],
        ),
      ).toEqual(expected);
    },
  );
});
