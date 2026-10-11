import { beforeEach, describe, expect, it, vi } from "vitest";

const { assetsFetch, ssrFetch } = vi.hoisted(() => ({
  assetsFetch: vi.fn(),
  ssrFetch: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { ASSETS: { fetch: assetsFetch } },
}));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: ssrFetch },
  createServerEntry: (entry: unknown) => entry,
}));

import server from "./server";

beforeEach(() => {
  vi.clearAllMocks();
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
