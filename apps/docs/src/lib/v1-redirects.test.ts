import { describe, expect, it } from "vitest";

import { zotlitLegacyUrl } from "./shared";
import {
  buildV1Redirects,
  renderHeadersFile,
  renderRedirectsFile,
} from "./v1-redirects";

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
      status: 308,
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
      status: 307,
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
      status: 307,
    });
  });

  it("strips /zh-CN from every other Chinese route, marking only the language", () => {
    expect(find("/zh-CN/*")).toEqual({
      source: "/zh-CN/*",
      destination: "/:splat?lang=zh-CN",
      status: 307,
    });
  });

  it("keeps the v1-only changelog on the frozen v1 site", () => {
    expect(find("/zh-CN/changelog/v1.1.0")).toEqual({
      source: "/zh-CN/changelog/v1.1.0",
      destination: `${zotlitLegacyUrl}/zh-CN/changelog/v1.1.0`,
      status: 308,
    });
  });

  it("orders every specific Chinese route ahead of the catch-all", () => {
    const catchAll = indexOf("/zh-CN/*");

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
      const expected = redirect.destination.startsWith(zotlitLegacyUrl)
        ? 308
        : 307;
      expect(redirect.status).toBe(expected);
    }
  });
});

describe("renderRedirectsFile", () => {
  const file = renderRedirectsFile();

  it("writes one source-destination-status line per rule", () => {
    expect(file).toContain(
      "/faq/slurp /docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp 308\n",
    );
    expect(file).toContain("/zh-CN/* /:splat?lang=zh-CN 307\n");
    expect(file.trimEnd().split("\n")).toHaveLength(redirects.length);
  });

  it("ends with a newline so the last rule parses", () => {
    expect(file.endsWith("\n")).toBe(true);
  });
});

describe("renderHeadersFile", () => {
  const file = renderHeadersFile();

  it("adds the giscus CORS header to the comment themes", () => {
    expect(file).toContain(
      "/giscus/*\n  Access-Control-Allow-Origin: https://giscus.app",
    );
  });

  it("types the changelog feed as RSS", () => {
    expect(file).toContain(
      "/changelog/rss.xml\n  Content-Type: application/rss+xml; charset=utf-8",
    );
  });

  it("caches the commit-pinned agent-skill archives forever", () => {
    expect(file).toContain(
      "/.well-known/agent-skills/*/archive.zip\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("caches the content-hashed assets forever", () => {
    expect(file).toContain(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
    );
  });
});
