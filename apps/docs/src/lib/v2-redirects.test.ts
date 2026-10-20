import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { scanContent } from "./content-scan";
import { buildRedirects, renderSiteRedirectsFile } from "./redirects";
import { buildV1Redirects } from "./v1-redirects";
import { PAGE_MAP } from "./v1-routes";
import { buildV2Redirects, V2_MOVES } from "./v2-redirects";

const packageRoot = resolve(import.meta.dirname, "../..");

/** Every docs page URL the build publishes, as the prerender list spells it. */
const docsPages = new Set(
  scanContent(packageRoot).docs.map(
    (entry) => `/${["docs", ...entry.slugs].join("/")}`,
  ),
);
const v1Sources = new Set(buildV1Redirects().map((rule) => rule.source));
const v1Destinations = new Set(Object.values(PAGE_MAP));
/** A live docs page, so a fixture fails only the rule under test. */
const LIVE = "/docs/how-to/insert-citations";

/** Every rule a moves table breaks, one message per offending entry. */
function problems(moves: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [from, to] of Object.entries(moves)) {
    for (const path of [from, to]) {
      if (!/^\/docs(\/[^/?#]+)*$/.test(path)) {
        found.push(`${path} is not a bare /docs path`);
      }
    }
    if (to in moves) found.push(`${from} → ${to} chains into another move`);
    if (v1Sources.has(to)) found.push(`${from} → ${to} chains into a v1 rule`);
    if (v1Destinations.has(from)) {
      found.push(`${from} is a PAGE_MAP destination; point PAGE_MAP at ${to}`);
    }
    if (!docsPages.has(to)) found.push(`${from} → ${to} is no docs page`);
  }
  return found;
}

describe("V2_MOVES", () => {
  it("breaks none of the table's rules", () => {
    expect(problems(V2_MOVES)).toEqual([]);
  });
});

describe("the moves table's rules", () => {
  it("sees the docs pages the content tree publishes", () => {
    expect(docsPages.has("/docs")).toBe(true);
    expect(docsPages.has(LIVE)).toBe(true);
  });

  it("rejects a destination that is itself a moved page", () => {
    expect(
      problems({ "/docs/a": "/docs/b", "/docs/b": LIVE }).some((p) =>
        p.includes("chains into another move"),
      ),
    ).toBe(true);
  });

  it("rejects a v1 permalink table destination as a source", () => {
    const [v1Target] = v1Destinations;
    expect(problems({ [v1Target!]: LIVE })).toEqual([
      `${v1Target} is a PAGE_MAP destination; point PAGE_MAP at ${LIVE}`,
    ]);
  });

  it("rejects a destination with no page in the content tree", () => {
    expect(problems({ "/docs/old": "/docs/no-such-page" })).toEqual([
      "/docs/old → /docs/no-such-page is no docs page",
    ]);
  });

  it("rejects an anchor or a trailing slash", () => {
    expect(problems({ "/docs/old/": `${LIVE}#slug` })).toHaveLength(3);
  });
});

describe("buildV2Redirects", () => {
  it("sends each moved page to its new path permanently", () => {
    expect(buildV2Redirects({ "/docs/old": LIVE })).toEqual([
      { source: "/docs/old", destination: LIVE, status: 308 },
    ]);
  });
});

describe("renderSiteRedirectsFile", () => {
  const moves = { "/docs/old": LIVE };

  it("writes the v2 moves into the same file as the v1 table", () => {
    const file = renderSiteRedirectsFile(moves);
    expect(file).toContain(`/docs/old ${LIVE} 308\n`);
    expect(file).toContain("/zh-CN/* /:splat?lang=zh-CN 307\n");
    expect(file.trimEnd().split("\n")).toHaveLength(
      buildV1Redirects().length + 1,
    );
  });

  it("matches a v2 move ahead of every v1 rule", () => {
    expect(buildRedirects(moves)[0]?.source).toBe("/docs/old");
  });

  it("adds nothing while the table is empty", () => {
    expect(buildRedirects({})).toEqual(buildV1Redirects());
  });
});
