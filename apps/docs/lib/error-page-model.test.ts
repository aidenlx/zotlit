import { describe, expect, it } from "vitest";

import { errorPageModel } from "./error-page-model";
import { docsRoute, gitConfig } from "./shared";

describe("errorPageModel", () => {
  it("builds the 404 model", () => {
    const model = errorPageModel("404");

    expect(model.code).toBe("404");
    expect(model.statusLabel).toBe("NOT FOUND");
    expect(model.exitLabel).toBe("Try instead");
    expect(model.exits.map((exit) => exit.label)).toEqual([
      "Documentation home",
      "Getting started",
      "Search the docs",
    ]);
    expect(model.exits[2]).toMatchObject({ action: "search" });

    const docsHome = model.exits[0];
    expect(docsHome).toMatchObject({ href: docsRoute });
  });

  it("builds the 500 model", () => {
    const model = errorPageModel("500");

    expect(model.code).toBe("500");
    expect(model.statusLabel).toBe("ERROR");
    expect(model.exitLabel).toBe("Recovery actions");
    expect(model.exits[0]).toMatchObject({ action: "reset" });

    const docsHome = model.exits.find(
      (exit) => exit.label === "Documentation home",
    );
    expect(docsHome).toMatchObject({ href: docsRoute });

    const reportIssue = model.exits.find(
      (exit) => exit.label === "Report an issue",
    );
    expect(
      reportIssue && "href" in reportIssue ? reportIssue.href : "",
    ).toEqual(expect.stringContaining(gitConfig.user));
    expect(
      reportIssue && "href" in reportIssue ? reportIssue.href : "",
    ).toEqual(expect.stringContaining(gitConfig.repo));
    expect(
      reportIssue && "href" in reportIssue ? reportIssue.href : "",
    ).toMatch(/\/issues\/new$/);
  });
});
