import { describe, expect, it } from "vitest";

import { zotlitLegacyUrl } from "./shared";
import { buildV1Redirects } from "./v1-redirects";

const redirects = buildV1Redirects();
const find = (source: string) => redirects.find((r) => r.source === source);
const indexOf = (source: string) =>
  redirects.findIndex((r) => r.source === source);

describe("buildV1Redirects", () => {
  it("sends an English v1 permalink to its v2 equivalent", () => {
    expect(find("/faq/slurp")).toEqual({
      source: "/faq/slurp",
      destination:
        "/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp",
      permanent: true,
    });
  });

  it("leaves the English home page alone", () => {
    expect(find("/")).toBeUndefined();
  });

  it("sends /zh-CN to the English home with no v1 back-link", () => {
    // Needs its own entry: the catch-all matches the bare prefix too, but
    // rebuilds it as `/zh-CN` and loops.
    expect(find("/zh-CN")).toEqual({
      source: "/zh-CN",
      destination: "/?lang=zh-CN",
      permanent: false,
    });
    // No redirect anywhere claims v1's root as a linkable source page.
    expect(redirects.some((r) => r.destination.includes("src=%2F&"))).toBe(
      false,
    );
  });

  it("sends a Chinese v1 permalink to its English v2 equivalent", () => {
    expect(find("/zh-CN/faq/slurp")).toEqual({
      source: "/zh-CN/faq/slurp",
      destination:
        "/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN",
      permanent: false,
    });
  });

  it("strips /zh-CN from every other Chinese route, marking only the language", () => {
    expect(find("/zh-CN/:path*")).toEqual({
      source: "/zh-CN/:path*",
      destination: "/:path*?lang=zh-CN",
      permanent: false,
    });
  });

  it("keeps the v1-only changelog on the frozen v1 site", () => {
    expect(find("/zh-CN/changelog/v1.1.0")).toEqual({
      source: "/zh-CN/changelog/v1.1.0",
      destination: `${zotlitLegacyUrl}/zh-CN/changelog/v1.1.0`,
      permanent: true,
    });
  });

  it("orders every specific Chinese route ahead of the catch-all", () => {
    const catchAll = indexOf("/zh-CN/:path*");

    expect(catchAll).toBe(redirects.length - 1);
    for (const source of [
      "/zh-CN",
      "/zh-CN/faq/slurp",
      "/zh-CN/changelog/v1.1.0",
    ]) {
      expect(indexOf(source)).toBeLessThan(catchAll);
    }
  });

  it("marks every Chinese redirect as temporary", () => {
    const chinese = redirects.filter(
      (r) => r.source === "/zh-CN" || r.source.startsWith("/zh-CN/"),
    );

    for (const redirect of chinese) {
      // The frozen v1 changelog has no v2 equivalent, so it stays permanent.
      const expected = redirect.destination.startsWith(zotlitLegacyUrl);
      expect(redirect.permanent).toBe(expected);
    }
  });
});
