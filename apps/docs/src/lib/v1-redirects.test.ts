import { describe, expect, it } from "vitest";

import { zotlitLegacyUrl } from "./shared";
import { buildV1Redirects, renderRedirectsFile } from "./v1-redirects";
import { PAGE_MAP } from "./v1-routes";

const redirects = buildV1Redirects();
const find = (source: string) => redirects.find((r) => r.source === source);

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

  it("leaves the Chinese home and modern locale routes to the router", () => {
    for (const path of [
      "/zh-CN",
      "/zh-CN/",
      "/zh-CN/docs",
      "/zh-CN/docs/install-zotlit",
      "/zh-CN/changelog",
      "/zh-CN/changelog/v2.0.0",
      "/zh-CN/blog",
      "/zh-CN/workbench",
      "/zh-CN/not-a-page",
    ]) {
      expect(find(path)).toBeUndefined();
    }
    // A wildcard would intercept these paths before the locale router runs.
    expect(redirects.some((rule) => rule.source.includes("*"))).toBe(false);
    // No redirect anywhere claims v1's root as a linkable source page.
    expect(redirects.some((r) => r.destination.includes("src=%2F&"))).toBe(
      false,
    );
  });

  it("sends a Chinese v1 permalink permanently to its Chinese v2 equivalent", () => {
    expect(find("/zh-CN/faq/slurp")).toEqual({
      source: "/zh-CN/faq/slurp",
      destination:
        "/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN",
      status: 308,
    });
  });

  it.each(Object.entries(PAGE_MAP))(
    "keeps the Chinese locale and legacy notice for %s",
    (from, to) => {
      for (const source of [`/zh-CN${from}`, `/zh-CN${from}/`]) {
        expect(find(source)).toEqual({
          source,
          destination: `/zh-CN${to}?from=v1&src=${encodeURIComponent(from)}&lang=zh-CN`,
          status: 308,
        });
      }
      // Each target is a live v2 page, so it must not start another redirect.
      for (const target of [to, `${to}/`, `/zh-CN${to}`, `/zh-CN${to}/`]) {
        expect(find(target)).toBeUndefined();
      }
    },
  );

  it.each([
    "/changelog/v1.0.0",
    "/changelog/v1.1.0",
    "/zh-CN/changelog/v1.1.0",
  ])("keeps %s on the frozen v1 site", (source) => {
    expect(find(source)).toEqual({
      source,
      destination: `${zotlitLegacyUrl}${source}`,
      status: 308,
    });
    expect(find(`${source}/`)).toEqual({
      source: `${source}/`,
      destination: `${zotlitLegacyUrl}${source}`,
      status: 308,
    });
  });

  it("preserves the legacy notice for trailing-slash permalinks", () => {
    expect(find("/faq/slurp/")).toEqual({
      source: "/faq/slurp/",
      destination:
        "/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp",
      status: 308,
    });
    expect(find("/zh-CN/faq/slurp/")).toEqual({
      source: "/zh-CN/faq/slurp/",
      destination:
        "/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN",
      status: 308,
    });
  });

  it("marks every legacy redirect as permanent", () => {
    for (const redirect of redirects) {
      expect(redirect.status).toBe(308);
    }
  });
});

describe("renderRedirectsFile", () => {
  const file = renderRedirectsFile();

  it("writes one source-destination-status line per rule", () => {
    expect(file).toContain(
      "/faq/slurp /docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp 308\n",
    );
    expect(file).toContain(
      "/zh-CN/faq/slurp /zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN 308\n",
    );
    expect(file.trimEnd().split("\n")).toHaveLength(redirects.length);
  });

  it("ends with a newline so the last rule parses", () => {
    expect(file.endsWith("\n")).toBe(true);
  });
});
