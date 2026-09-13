import { regex } from "arkregex";
import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE_SOURCE, renderProfile, SAMPLE_ITEMS } from "./index";
import { currentCallSite, currentSliceSite } from "./locate";
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

/** One authored row per way an entry expression can fail. */
const ENTRIES = {
  evalRule: `  - key: broken
    value: {"$eval": "zt.nowhere.deep"}
    merge: replace`,
  spreadRule: `  - value: {"title": "kept", "kind": {"$eval": "zt.nowhere.deep"}}
    merge: replace`,
  unknownOperator: `  - key: broken
    value: {"$evl": "zt.title"}
    merge: replace`,
  liquidExpression: `  - key: broken
    expr: "zt.]title"
    merge: replace`,
  // An operator missing the clauses it needs fails on what the rule does not
  // say, so no part of what it does say is the fault.
  operatorMissingClause: `  - key: broken
    value: {"$let": {}}
    merge: replace`,
  // JSON-e renders an operator's own branches itself and leaves the operator
  // out of the location it reports, so this failure inside `in` is reported at
  // a path that also names the sibling `in` the author wrote beside it.
  operatorBranch: `  - key: broken
    value: {"$let": {"in": {"$eval": "zt.nowhere.deep"}}, "in": "safe"}
    merge: replace`,
};

/** The failure one appended row raises, beside the expression its row edits. */
function entryFailure(rows: string): {
  diagnostic: RenderDiagnostic;
  expression: string;
} {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "---\n# {{ zt.title }}",
    `${rows}\n---\n# {{ zt.title }}`,
  );
  const diagnostic = renderProfile(source, SAMPLE_ITEMS[0]!).diagnostics.find(
    ({ code }) => code === "property-error",
  )!;
  // The row's editor holds the expression alone, which every offset counts from.
  const expression = regex("(?:value|expr): (?<held>.*)").exec(rows)!.groups
    .held;
  return { diagnostic, expression };
}

describe("current entry site", () => {
  it("marks the argument of the one operator a rule stopped inside", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.evalRule);

    const site = currentSliceSite(diagnostic, expression)!;
    expect(expression.slice(site.from, site.to)).toBe('"zt.nowhere.deep"');
  });

  it("marks the produced key a spread failed on, not the whole rule", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.spreadRule);

    const site = currentSliceSite(diagnostic, expression)!;
    expect(expression.slice(site.from, site.to)).toBe('"zt.nowhere.deep"');
  });

  it("marks the key itself where JSON-e knows no operator by that name", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.unknownOperator);

    const site = currentSliceSite(diagnostic, expression)!;
    expect(expression.slice(site.from, site.to)).toBe('"$evl"');
  });

  it("marks the token a Liquid expression stopped on", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.liquidExpression);

    const site = currentSliceSite(diagnostic, expression)!;
    // liquidjs stops on the filter name it wanted a pipe before.
    expect(expression.slice(site.from, site.to)).toBe("title");
  });

  it("leaves an expression edited since the attempt unmarked", () => {
    const { diagnostic } = entryFailure(ENTRIES.liquidExpression);

    expect(currentSliceSite(diagnostic, '"zt.title"')).toBeUndefined();
  });

  it("keeps the whole rule where an operator is missing a clause", () => {
    const { diagnostic, expression } = entryFailure(
      ENTRIES.operatorMissingClause,
    );

    const site = currentSliceSite(diagnostic, expression)!;
    expect(expression.slice(site.from, site.to)).toBe('{"$let": {}}');
  });

  it("marks nothing where JSON-e reported a path through an operator", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.operatorBranch);

    // The reported path names `in`, which the author also wrote as a sibling
    // of the operator: marking it would underline text that did not fail.
    expect(diagnostic.sliceSite).toBeUndefined();
    expect(currentSliceSite(diagnostic, expression)).toBeUndefined();
  });

  it("drops the mark once the expression it read has been repaired", () => {
    const { diagnostic, expression } = entryFailure(ENTRIES.evalRule);

    expect(currentSliceSite(diagnostic, expression)).toBeDefined();
    expect(
      currentSliceSite(diagnostic, expression.replace("nowhere.deep", "title")),
    ).toBeUndefined();
  });

  it("marks nothing where the failure named no place", () => {
    expect(
      currentSliceSite({ code: "property-error" }, '{"$eval": "zt.title"}'),
    ).toBeUndefined();
  });
});
