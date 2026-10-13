import { describe, expect, it } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import { engineFaultSpan, reportedFaultSpan } from "./errors";

/** The error `define` throws for `source`. */
function compileFault(source: string, language: "liquid" | "eta"): unknown {
  try {
    new TemplateFacade().define("note", source, language);
  } catch (error) {
    return error;
  }
  throw new Error("The source compiled.");
}

describe("engineFaultSpan", () => {
  it("reads the token liquidjs stopped on", () => {
    const source = "# Title\n{% if zt.title %}\nbody\n";
    const at = engineFaultSpan(compileFault(source, "liquid"), source);

    expect(at).toMatchObject({ source, from: 8 });
    expect(source.slice(at!.from, at!.to)).toBe("{% if zt.title %}");
  });

  it("reads the line and column Eta writes into its message", () => {
    const source = "# Title\n<%= it.title";
    const at = engineFaultSpan(compileFault(source, "eta"), source);

    expect(at).toEqual({ source, from: 8, to: 9 });
  });

  it("names no span for an Eta JavaScript syntax error", () => {
    const source = "<% if ( %>";

    expect(engineFaultSpan(compileFault(source, "eta"), source)).toBe(
      undefined,
    );
  });
});

describe("reportedFaultSpan", () => {
  it("reads a liquidjs line and column", () => {
    expect(
      reportedFaultSpan("unexpected token, line:2, col:3", "a\nbcd"),
    ).toEqual({ source: "a\nbcd", from: 4, to: 5 });
  });

  it("names no span for a line past the source", () => {
    expect(reportedFaultSpan("at line 3 col 1:", "a\nb")).toBe(undefined);
  });
});
