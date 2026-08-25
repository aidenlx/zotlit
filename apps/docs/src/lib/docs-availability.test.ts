// Build-time pure functions: a release value in, a badge or a Markdown line
// out. The reader-facing surface they feed is asserted over HTTP instead.

import type * as PageTree from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";

import {
  DOCS_RELEASE_VERSION,
  getDocsAvailability,
  getDocsSidebarBadge,
  getStableReleaseLine,
  renderAvailabilityMarkdown,
  withDocsAvailability,
} from "./docs-availability.ts";
import type { DocsPageTreeItem } from "./docs-availability.ts";

describe("getStableReleaseLine", () => {
  it("normalizes a prerelease to its stable release line", () => {
    expect(getStableReleaseLine("2.0.0-beta.4")).toBe("2.0.0");
  });
});

describe("getDocsAvailability", () => {
  it("reads the Docs Release Line by default", () => {
    expect(getDocsAvailability(DOCS_RELEASE_VERSION).state).toBe("new");
  });

  it("marks prerelease content as new within the current release line", () => {
    expect(getDocsAvailability("2.1.0-beta.1", "2.1.0-beta.4").state).toBe(
      "new",
    );
  });

  it("keeps earlier release lines historical", () => {
    expect(getDocsAvailability("2.0.0", "2.0.1").state).toBe("historical");
    expect(getDocsAvailability("1.1.4-beta.1", "2.0.1").state).toBe(
      "historical",
    );
  });

  it("rejects a future release line", () => {
    expect(() => getDocsAvailability("2.2.0-beta.0", "2.1.0-beta.4")).toThrow(
      "ahead of current Docs Release Line",
    );
  });

  it("is undefined for a page with no Introduced Release yet", () => {
    expect(getDocsAvailability(undefined, "2.1.0-beta.4")).toBeUndefined();
  });
});

describe("getDocsSidebarBadge", () => {
  it("leaves earlier release lines unbadged", () => {
    expect(
      getDocsSidebarBadge({ introduced: "2.0.0", updated: "2.0.0" }, "2.0.1"),
    ).toBeUndefined();
  });

  it("marks a page introduced in the current release line as new", () => {
    expect(
      getDocsSidebarBadge(
        { introduced: "2.1.0-beta.1", updated: "2.1.0-beta.1" },
        "2.1.0-beta.4",
      ),
    ).toBe("new");
  });

  it("marks a revision to an earlier page as updated", () => {
    expect(
      getDocsSidebarBadge(
        { introduced: "2.0.0", updated: "2.1.0-beta.1" },
        "2.1.0-beta.4",
      ),
    ).toBe("updated");
  });

  it("gives a current introduction precedence over an update", () => {
    expect(
      getDocsSidebarBadge(
        { introduced: "2.1.0-beta.1", updated: "2.1.0-beta.4" },
        "2.1.0-beta.4",
      ),
    ).toBe("new");
  });

  it("rejects a future release line", () => {
    expect(() =>
      getDocsSidebarBadge(
        { introduced: "2.2.0-beta.0", updated: "2.2.0-beta.0" },
        "2.1.0-beta.4",
      ),
    ).toThrow("ahead of current Docs Release Line");
  });

  it("rejects an Updated Release before the Introduced Release", () => {
    expect(() =>
      getDocsSidebarBadge({ introduced: "2.1.0", updated: "2.0.0" }, "2.1.0"),
    ).toThrow("predates Introduced Release");
  });

  it("leaves a page with no release history yet unbadged", () => {
    expect(getDocsSidebarBadge({}, "2.1.0-beta.4")).toBeUndefined();
  });

  it("leaves a partially-set page unbadged", () => {
    expect(
      getDocsSidebarBadge({ introduced: "2.0.0" }, "2.1.0-beta.4"),
    ).toBeUndefined();
  });
});

describe("withDocsAvailability", () => {
  const treeOf = (page: PageTree.Item): PageTree.Root => ({
    $id: "docs",
    name: "Docs",
    children: [page],
  });

  it("copies the page tree without adding a badge to earlier pages", () => {
    const tree = treeOf({
      type: "page",
      name: "Template Workbench",
      url: "/docs/template-workbench",
    });
    const result = withDocsAvailability(
      tree,
      () => ({ introduced: "2.0.0", updated: "2.0.0" }),
      "2.0.1",
    );

    expect(
      (result.children[0] as DocsPageTreeItem).docsAvailability,
    ).toBeUndefined();
    expect(
      (tree.children[0] as DocsPageTreeItem).docsAvailability,
    ).toBeUndefined();
    expect(result.$id).toBe("docs:release-2.0.1");
  });

  it("badges a page introduced in the current release line", () => {
    const result = withDocsAvailability(
      treeOf({
        type: "page",
        name: "Export a note with citations",
        url: "/docs/how-to/export-note-with-citations",
      }),
      () => ({ introduced: "2.1.0", updated: "2.1.0" }),
      "2.1.0",
    );

    expect((result.children[0] as DocsPageTreeItem).docsAvailability).toBe(
      "new",
    );
  });

  it("leaves an unreleased page unbadged", () => {
    const result = withDocsAvailability(
      treeOf({
        type: "page",
        name: "Export a note with citations",
        url: "/docs/how-to/export-note-with-citations",
      }),
      () => ({}),
      "2.0.1",
    );

    expect(
      (result.children[0] as DocsPageTreeItem).docsAvailability,
    ).toBeUndefined();
  });
});

describe("renderAvailabilityMarkdown", () => {
  it("links the release to its changelog entry", () => {
    expect(
      renderAvailabilityMarkdown(
        { introduced: "2.0.0-beta.4", state: "historical" },
        "/changelog/2.0.0-beta.4",
      ),
    ).toBe("_Available since ZotLit [2.0.0-beta.4](/changelog/2.0.0-beta.4)._");
  });

  it("states a release with no changelog entry as plain text", () => {
    expect(
      renderAvailabilityMarkdown({ introduced: "2.0.0", state: "historical" }),
    ).toBe("_Available since ZotLit 2.0.0._");
  });
});
