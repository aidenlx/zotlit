import { describe, expect, it } from "vitest";

import { currentCallSite } from "./locate";
import type { RenderDiagnostic } from "./result";

describe("current repair call", () => {
  const diagnostic: RenderDiagnostic = {
    code: "missing-partial",
    params: { name: "details" },
    callSite: { from: 0, to: 22 },
  };
  const call = "{% render 'details' %}";

  it("moves with the call after an edit above it", () => {
    expect(
      currentCallSite(diagnostic, {
        source: `Heading\n${call}`,
        language: "liquid",
      }),
    ).toEqual({ from: 8, to: 30 });
  });

  it("keeps the first of several calls to the same missing partial", () => {
    expect(
      currentCallSite(diagnostic, {
        source: `${call}\n${call}`,
        language: "liquid",
      }),
    ).toEqual({ from: 0, to: 22 });
  });

  it("leaves removed and ambiguous resolved calls without a target", () => {
    expect(
      currentCallSite(diagnostic, { source: "Heading", language: "liquid" }),
    ).toBeUndefined();
    expect(
      currentCallSite(
        {
          code: "render-error",
          engine: { template: "details" },
          callSite: diagnostic.callSite,
        },
        { source: `${call}\n${call}`, language: "liquid" },
      ),
    ).toBeUndefined();
  });

  it("does not invent a target that the failed attempt did not verify", () => {
    expect(
      currentCallSite(
        { code: "missing-partial", params: { name: "details" } },
        { source: call, language: "liquid" },
      ),
    ).toBeUndefined();
  });
});
