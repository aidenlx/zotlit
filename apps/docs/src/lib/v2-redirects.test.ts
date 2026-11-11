import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { scanContent } from "./content-scan";
import { buildRedirects, renderSiteRedirectsFile } from "./redirects";
import { buildV1Redirects } from "./v1-redirects";
import { PAGE_MAP } from "./v1-routes";
import { buildV2Redirects, V2_MOVES } from "./v2-redirects";

const packageRoot = resolve(import.meta.dirname, "../..");

const content = scanContent(packageRoot);
/** Every docs page URL the build publishes, as the prerender list spells it. */
const docsPages = new Set(
  content.docs.map((entry) => `/${["docs", ...entry.slugs].join("/")}`),
);
/** Every page a move can land on: the docs, the lessons, and the course page. */
const livePages = new Set([
  ...docsPages,
  "/learn",
  ...content.learn.map((entry) => `/${["learn", ...entry.slugs].join("/")}`),
]);
const v1Sources = new Set(buildV1Redirects().map((rule) => rule.source));
const v1Destinations = new Set(Object.values(PAGE_MAP));
/** A live docs page, so a fixture fails only the rule under test. */
const LIVE = "/docs/how-to/insert-citations";

/** Every rule a moves table breaks, one message per offending entry. */
function problems(moves: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [from, to] of Object.entries(moves)) {
    if (!/^\/docs(\/[^/?#]+)*$/.test(from)) {
      found.push(`${from} is not a bare /docs path`);
    }
    if (!/^\/(docs|learn)(\/[^/?#]+)*$/.test(to)) {
      found.push(`${to} is not a bare /docs or /learn path`);
    }
    if (v1Destinations.has(from)) {
      found.push(`${from} is a PAGE_MAP destination; point PAGE_MAP at ${to}`);
    }
    // The Markdown editions' destinations follow from the page's, by the same
    // scheme the prerender list publishes them under.
    if (!livePages.has(to)) found.push(`${from} → ${to} is no live page`);
  }

  // Chains, over every emitted rule: the pages and their Markdown editions.
  const rules = buildV2Redirects(moves);
  const sources = new Set(rules.map((rule) => rule.source));
  for (const { source, destination } of rules) {
    if (sources.has(destination)) {
      found.push(`${source} → ${destination} chains into another move`);
    }
    if (v1Sources.has(destination)) {
      found.push(`${source} → ${destination} chains into a v1 rule`);
    }
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

  it("rejects a destination that is itself a moved page, editions too", () => {
    expect(
      problems({ "/docs/a": "/docs/b", "/docs/b": LIVE }).filter((p) =>
        p.includes("chains into another move"),
      ),
    ).toEqual([
      "/docs/a → /docs/b chains into another move",
      "/docs/a.md → /docs/b.md chains into another move",
      "/llms.mdx/docs/a/content.md → /llms.mdx/docs/b/content.md chains into another move",
      "/zh-CN/docs/a → /zh-CN/docs/b chains into another move",
      "/zh-CN/docs/a.md → /zh-CN/docs/b.md chains into another move",
      "/zh-CN/llms.mdx/docs/a/content.md → /zh-CN/llms.mdx/docs/b/content.md chains into another move",
    ]);
  });

  it("rejects a v1 permalink table destination as a source", () => {
    const [v1Target] = v1Destinations;
    expect(problems({ [v1Target!]: LIVE })).toEqual([
      `${v1Target} is a PAGE_MAP destination; point PAGE_MAP at ${LIVE}`,
    ]);
  });

  it("rejects a destination with no page in the content tree", () => {
    expect(problems({ "/docs/old": "/docs/no-such-page" })).toEqual([
      "/docs/old → /docs/no-such-page is no live page",
    ]);
    expect(problems({ "/docs/old": "/learn/no-such-lesson" })).toEqual([
      "/docs/old → /learn/no-such-lesson is no live page",
    ]);
  });

  it("accepts a lesson or the course page as a destination", () => {
    const [lesson] = content.learn;
    expect(lesson).toBeDefined();
    expect(
      problems({
        "/docs/old": `/learn/${lesson!.slugs.join("/")}`,
        "/docs/older": "/learn",
      }),
    ).toEqual([]);
  });

  it("rejects a source outside /docs", () => {
    expect(() => problems({ "/learn/old": LIVE })).toThrow(
      "/learn/old is not a docs path",
    );
  });

  it("rejects an anchor or a trailing slash", () => {
    expect(problems({ "/docs/old/": `${LIVE}#slug` })).toHaveLength(3);
  });
});

describe("buildV2Redirects", () => {
  it("sends each moved page and its two Markdown editions to the new path, in both locales", () => {
    expect(buildV2Redirects({ "/docs/old/page": LIVE })).toEqual([
      { source: "/docs/old/page", destination: LIVE, status: 308 },
      {
        source: "/docs/old/page.md",
        destination: "/docs/how-to/insert-citations.md",
        status: 308,
      },
      {
        source: "/llms.mdx/docs/old/page/content.md",
        destination: "/llms.mdx/docs/how-to/insert-citations/content.md",
        status: 308,
      },
      {
        source: "/zh-CN/docs/old/page",
        destination: "/zh-CN/docs/how-to/insert-citations",
        status: 308,
      },
      {
        source: "/zh-CN/docs/old/page.md",
        destination: "/zh-CN/docs/how-to/insert-citations.md",
        status: 308,
      },
      {
        source: "/zh-CN/llms.mdx/docs/old/page/content.md",
        destination: "/zh-CN/llms.mdx/docs/how-to/insert-citations/content.md",
        status: 308,
      },
    ]);
  });
});

describe("buildV2Redirects to a lesson", () => {
  it("moves a docs page and its editions into /learn", () => {
    const rules = buildV2Redirects({
      "/docs/tutorial/first-note": "/learn/connect-zotero-to-obsidian",
    });
    expect(rules.slice(0, 3)).toEqual([
      {
        source: "/docs/tutorial/first-note",
        destination: "/learn/connect-zotero-to-obsidian",
        status: 308,
      },
      {
        source: "/docs/tutorial/first-note.md",
        destination: "/learn/connect-zotero-to-obsidian.md",
        status: 308,
      },
      {
        source: "/llms.mdx/docs/tutorial/first-note/content.md",
        destination: "/llms.mdx/learn/connect-zotero-to-obsidian/content.md",
        status: 308,
      },
    ]);
    expect(rules[3]).toEqual({
      source: "/zh-CN/docs/tutorial/first-note",
      destination: "/zh-CN/learn/connect-zotero-to-obsidian",
      status: 308,
    });
  });

  it("moves a section index onto the course page", () => {
    expect(
      buildV2Redirects({ "/docs/tutorial": "/learn" }).slice(0, 3),
    ).toEqual([
      { source: "/docs/tutorial", destination: "/learn", status: 308 },
      { source: "/docs/tutorial.md", destination: "/learn.md", status: 308 },
      {
        source: "/llms.mdx/docs/tutorial/content.md",
        destination: "/llms.mdx/learn/content.md",
        status: 308,
      },
    ]);
  });
});

describe("renderSiteRedirectsFile", () => {
  const moves = { "/docs/old": LIVE };

  it("writes the v2 moves into the same file as the v1 table", () => {
    const file = renderSiteRedirectsFile(moves);
    expect(file).toContain(`/docs/old ${LIVE} 308\n`);
    expect(file).toContain(`/docs/old.md ${LIVE}.md 308\n`);
    expect(file).toContain(`/zh-CN/docs/old /zh-CN${LIVE} 308\n`);
    expect(file.trimEnd().split("\n")).toHaveLength(
      buildV1Redirects().length + 6,
    );
  });

  it("matches a v2 move ahead of every v1 rule", () => {
    expect(buildRedirects(moves)[0]?.source).toBe("/docs/old");
  });

  it("adds nothing while the table is empty", () => {
    expect(buildRedirects({})).toEqual(buildV1Redirects());
  });
});
