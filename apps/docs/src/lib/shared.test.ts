import { describe, expect, it } from "vitest";

import { docsSourceBranch } from "./shared";

describe("docsSourceBranch", () => {
  it("uses the stable branch for production docs", () => {
    expect(docsSourceBranch("production")).toBe("main");
  });

  it("uses the pre-release branch for beta docs", () => {
    expect(docsSourceBranch("beta")).toBe("next");
  });
});
