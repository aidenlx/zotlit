// The HTTP surface of the built Worker, served through workerd.
//
// This is the primary seam for the site: every assertion is something a
// browser, a crawler, or the Obsidian plugin can observe over HTTP. It needs
// `dist/`, so run it through turbo (`turbo run test --filter=@zotlit/website`),
// which builds first.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import { getBlogPages, getChangelogPages, source } from "./lib/source.ts";
import { buildV1Redirects } from "./lib/v1-redirects.ts";

const config = resolve(import.meta.dirname, "../dist/server/wrangler.json");

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

/** `redirect: "manual"` so a redirect answers instead of being followed. */
function get(path: string) {
  return worker.fetch(`http://localhost${path}`, { redirect: "manual" });
}

beforeAll(async () => {
  if (!existsSync(config)) {
    throw new Error(`No build to serve at ${config}; run \`vite build\` first`);
  }
  worker = await unstable_startWorker({ config });
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
});

describe("page routes", () => {
  const pages = [
    "/",
    "/community",
    "/blog",
    ...getBlogPages().map((page) => page.url),
    "/changelog",
    ...getChangelogPages().map((page) => page.url),
    ...source.getPages().map((page) => page.url),
  ];

  it.for(pages)("renders %s", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("answers an unknown path with 404", async () => {
    const response = await get("/no-such-page");

    expect(response.status).toBe(404);
  });
});

describe("legacy redirects", () => {
  it.for(buildV1Redirects())(
    "sends $source to $destination",
    async ({ source: from, destination, status }) => {
      // The catch-all is a pattern, not a path; exercise it below instead.
      if (from.includes("*")) return;
      const response = await get(from);

      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe(destination);
    },
  );

  it("strips /zh-CN from a route with no entry of its own", async () => {
    const response = await get("/zh-CN/community");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/community?lang=zh-CN");
  });
});

describe("search", () => {
  /** The endpoint answers with fumadocs' sorted-result list. */
  async function search(query: string) {
    const response = await get(
      `/api/search?query=${encodeURIComponent(query)}`,
    );

    expect(response.status).toBe(200);
    return (await response.json()) as { url: string }[];
  }

  it("finds docs pages for a term the docs use", async () => {
    const results = await search("annotation");

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(result.url).toMatch(/^\/docs\//);
  });

  it("leaves the changelog out of the index", async () => {
    // "AGPL" appears in the changelog and nowhere in the docs content.
    const results = await search("AGPL");

    expect(results).toEqual([]);
  });
});

describe("asset headers", () => {
  it("serves the giscus theme with its CORS header", async () => {
    const response = await get("/giscus/light.css");

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://giscus.app",
    );
  });
});
