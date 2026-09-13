import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE_SOURCE, renderProfile, SAMPLE_ITEMS } from "./index";
import { currentCallSite } from "./locate";
import type { RenderDiagnostic } from "./result";

describe("current repair call", () => {
  it("locates an unchanged failed section after edits and rejects changed or repeated source", () => {
    const tag = "{% for annotation i zt.annotations %}";
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "{% for annotation in zt.annotations %}",
      tag,
    );
    const failure = renderProfile(source, SAMPLE_ITEMS[0]!).diagnostics[0]!;
    const moved = source.replace(
      "# {{ zt.title }}",
      "Extra line\n# {{ zt.title }}",
    );
    expect(moved).not.toBe(source);
    expect(
      currentCallSite(failure, { source: moved, language: "liquid" }),
    ).toEqual({
      from: moved.indexOf(tag),
      to: moved.indexOf(tag) + tag.length,
    });
    expect(
      currentCallSite(failure, {
        source: DEFAULT_PROFILE_SOURCE,
        language: "liquid",
      }),
    ).toBeUndefined();
    expect(
      currentCallSite(failure, {
        source: source + failure.sourceSite!.source,
        language: "liquid",
      }),
    ).toBeUndefined();
  });

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
