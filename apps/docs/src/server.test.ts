import { beforeEach, describe, expect, it, vi } from "vitest";

const { assetsFetch, ssrFetch, workerEnv } = vi.hoisted(() => {
  const assetsFetch = vi.fn();
  return {
    assetsFetch,
    ssrFetch: vi.fn(),
    workerEnv: { ASSETS: { fetch: assetsFetch }, DOCS_LINE: "production" },
  };
});

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: ssrFetch },
  createServerEntry: (entry: unknown) => entry,
}));

import server from "./server";

beforeEach(() => {
  vi.clearAllMocks();
  workerEnv.DOCS_LINE = "production";
  assetsFetch.mockResolvedValue(new Response("Not found", { status: 404 }));
  ssrFetch.mockResolvedValue(new Response("Rendered before assets exist"));
});

describe("global machine endpoint locale aliases", () => {
  it.each(
    [
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/robots.txt",
      "/changelog/rss.xml",
    ].flatMap((path) => [path, `${path}/`]),
  )(
    "renders unprefixed %s when prerender has not written its asset",
    async (path) => {
      const response = await server.fetch(
        new Request(`https://zotlit.aidenlx.site${path}`),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe("Rendered before assets exist");
      expect(assetsFetch).toHaveBeenCalledOnce();
      expect(ssrFetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["/zh-CN/llms.txt", "/llms.txt"],
    ["/zh-cn/llms-full.txt/", "/llms-full.txt"],
    ["/zh-CN/sitemap.xml/", "/sitemap.xml"],
    ["/zh-cn/robots.txt/", "/robots.txt"],
    ["/en/changelog/rss.xml/", "/changelog/rss.xml"],
  ])(
    "redirects the explicit locale alias %s with its query",
    async (path, target) => {
      const response = await server.fetch(
        new Request(`https://zotlit.aidenlx.site${path}?keep=1&lang=fr`),
      );

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://zotlit.aidenlx.site${target}?keep=1&lang=fr`,
      );
      expect(assetsFetch).not.toHaveBeenCalled();
      expect(ssrFetch).not.toHaveBeenCalled();
    },
  );
});

// A Markdown answer repeats its HTML page, so search engines must neither
// index it nor treat it as a page of its own; and a cache in front of a page
// whose answer follows the Accept header must keep the two answers apart.
describe("Markdown answers", () => {
  const page = "/docs/how-to/insert-citations";
  const canonical = `<https://zotlit.aidenlx.site${page}>; rel="canonical"`;

  beforeEach(() => {
    assetsFetch.mockImplementation((request: Request) => {
      const { pathname } = new URL(request.url);
      const markdown =
        pathname.endsWith(".md") || pathname.startsWith("/llms.mdx/");
      return Promise.resolve(
        new Response(markdown ? "# Insert citations" : "<html></html>", {
          headers: {
            "content-type": markdown
              ? "text/markdown; charset=utf-8"
              : "text/html; charset=utf-8",
          },
        }),
      );
    });
  });

  async function fetchPage(path: string, accept: string) {
    return server.fetch(
      new Request(`https://zotlit.aidenlx.site${path}`, {
        headers: { accept },
      }),
    );
  }

  it.each([
    ["a `.md` edition", `${page}.md`, "*/*"],
    ["a negotiated page", page, "text/markdown"],
    ["a Chinese fallback's edition", `/zh-CN${page}.md`, "*/*"],
  ])(
    "keeps %s out of the index and names its HTML page canonical",
    async (_, path, accept) => {
      const response = await fetchPage(path, accept);
      expect(response.headers.get("content-type")).toMatch(/^text\/markdown/);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("link")).toBe(canonical);
    },
  );

  it.each([
    ["HTML", "text/html"],
    ["Markdown", "text/markdown"],
  ])("marks a page's %s answer as varying by Accept", async (_, accept) => {
    const response = await fetchPage(page, accept);
    expect(response.headers.get("vary")).toMatch(/\bAccept\b/);
  });

  it("leaves the HTML answer indexable with no canonical header", async () => {
    const response = await fetchPage(page, "text/html");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("link")).toBeNull();
  });

  it.each(["/", `${page}.md`])(
    "adds no Vary to %s, whose answer ignores Accept",
    async (path) => {
      const response = await fetchPage(path, "text/markdown");
      expect(response.headers.get("vary")).toBeNull();
    },
  );
});

// Pre-release Docs repeats the production pages; search engines list the
// production line alone.
describe("beta line", () => {
  it.each(["/docs/how-to/insert-citations", "/zh-CN/learn"])(
    "keeps the Worker's answer for %s out of the index",
    async (path) => {
      workerEnv.DOCS_LINE = "beta";
      const response = await server.fetch(
        new Request(`https://zotlit-beta.aidenlx.site${path}`),
      );
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    },
  );
});
