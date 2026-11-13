import { beforeEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({ env: { DOCS_LINE: "production" } }));

vi.mock("cloudflare:workers", () => ({ env }));

import { missingReleaseResponse } from "./beta-fallback";

const paths = (version: string) => ({
  release: `/changelog/${version}`,
  changelog: "/changelog",
});

beforeEach(() => {
  env.DOCS_LINE = "production";
});

// The plugin's release-note links name every GitHub release tag, and the
// 2.0.0 alphas shipped before the changelog began: those must land on the
// changelog rather than a 404 or a beta page that never existed.
describe("missingReleaseResponse", () => {
  it.each(["production", "beta"])(
    "moves a version older than the first release notes to the changelog on %s",
    (line) => {
      env.DOCS_LINE = line;
      const response = missingReleaseResponse(
        "2.0.0-alpha.3",
        paths("2.0.0-alpha.3"),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("/changelog");
    },
  );

  it("hands an unknown later version to Pre-release Docs from production", () => {
    const response = missingReleaseResponse("9.9.9", paths("9.9.9"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://zotlit-beta.aidenlx.site/changelog/9.9.9",
    );
  });

  it("answers an unknown later version with 404 on Pre-release Docs", () => {
    env.DOCS_LINE = "beta";
    expect(missingReleaseResponse("9.9.9", paths("9.9.9")).status).toBe(404);
  });

  it("hands a slug that is no version to Pre-release Docs as before", () => {
    expect(
      missingReleaseResponse("not-a-version", paths("not-a-version")).status,
    ).toBe(307);
  });
});
