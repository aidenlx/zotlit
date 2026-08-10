import { assertEquals, assertThrows } from "@std/assert";
import type * as PageTree from "fumadocs-core/page-tree";
import { describe, it } from "vitest";

import {
  DOCS_RELEASE_VERSION,
  getDocsAvailability,
  getDocsSidebarBadge,
  getStableReleaseLine,
  renderAvailabilityMarkdown,
  withDocsAvailability,
} from "@/lib/docs-availability";
import type { DocsPageTreeItem } from "@/lib/docs-availability";

describe("getStableReleaseLine", () => {
  it("normalizes a prerelease to its stable release line", () => {
    assertEquals(getStableReleaseLine("2.0.0-beta.4"), "2.0.0");
  });
});

describe("getDocsAvailability", () => {
  it("uses the Obsidian package version by default", () => {
    assertEquals(getDocsAvailability(DOCS_RELEASE_VERSION).state, "new");
  });

  it("marks prerelease content as new within the current release line", () => {
    assertEquals(
      getDocsAvailability("2.1.0-beta.1", "2.1.0-beta.4").state,
      "new",
    );
  });

  it("keeps earlier release lines historical", () => {
    assertEquals(getDocsAvailability("2.0.0", "2.0.1").state, "historical");
    assertEquals(
      getDocsAvailability("1.1.4-beta.1", "2.0.1").state,
      "historical",
    );
  });

  it("rejects a future release line", () => {
    assertThrows(
      () => getDocsAvailability("2.2.0-beta.0", "2.1.0-beta.4"),
      Error,
      "ahead of current Docs Release Line",
    );
  });

  it("is undefined for a page with no Introduced Release yet", () => {
    assertEquals(getDocsAvailability(undefined, "2.1.0-beta.4"), undefined);
  });
});

describe("getDocsSidebarBadge", () => {
  it("leaves earlier release lines unbadged", () => {
    assertEquals(
      getDocsSidebarBadge({ introduced: "2.0.0", updated: "2.0.0" }, "2.0.1"),
      undefined,
    );
  });

  it("marks a page introduced in the current release line as new", () => {
    assertEquals(
      getDocsSidebarBadge(
        { introduced: "2.1.0-beta.1", updated: "2.1.0-beta.1" },
        "2.1.0-beta.4",
      ),
      "new",
    );
  });

  it("marks a revision to an earlier page as updated", () => {
    assertEquals(
      getDocsSidebarBadge(
        { introduced: "2.0.0", updated: "2.1.0-beta.1" },
        "2.1.0-beta.4",
      ),
      "updated",
    );
  });

  it("gives a current introduction precedence over an update", () => {
    assertEquals(
      getDocsSidebarBadge(
        { introduced: "2.1.0-beta.1", updated: "2.1.0-beta.4" },
        "2.1.0-beta.4",
      ),
      "new",
    );
  });

  it("rejects a future release line", () => {
    assertThrows(
      () =>
        getDocsSidebarBadge(
          { introduced: "2.2.0-beta.0", updated: "2.2.0-beta.0" },
          "2.1.0-beta.4",
        ),
      Error,
      "ahead of current Docs Release Line",
    );
  });

  it("rejects an Updated Release before the Introduced Release", () => {
    assertThrows(
      () =>
        getDocsSidebarBadge({ introduced: "2.1.0", updated: "2.0.0" }, "2.1.0"),
      Error,
      "predates Introduced Release",
    );
  });

  it("leaves a page with no release history yet unbadged", () => {
    assertEquals(getDocsSidebarBadge({}, "2.1.0-beta.4"), undefined);
  });

  it("leaves a partially-set page unbadged", () => {
    assertEquals(
      getDocsSidebarBadge({ introduced: "2.0.0" }, "2.1.0-beta.4"),
      undefined,
    );
  });
});

describe("withDocsAvailability", () => {
  it("copies the page tree without adding a badge to earlier pages", () => {
    const page: PageTree.Item = {
      type: "page",
      name: "Template Workbench",
      url: "/docs/template-workbench",
    };
    const tree: PageTree.Root = {
      $id: "docs",
      name: "Docs",
      children: [page],
    };
    const result = withDocsAvailability(
      tree,
      () => ({
        introduced: "2.0.0",
        updated: "2.0.0",
      }),
      "2.0.1",
    );

    assertEquals(
      (result.children[0] as DocsPageTreeItem).docsAvailability,
      undefined,
    );
    assertEquals(
      (tree.children[0] as DocsPageTreeItem).docsAvailability,
      undefined,
    );
    assertEquals(result.$id, "docs:release-2.0.1");
  });

  it("leaves an unreleased page unbadged", () => {
    const page: PageTree.Item = {
      type: "page",
      name: "Export a note with citations",
      url: "/docs/how-to/export-note-with-citations",
    };
    const tree: PageTree.Root = {
      $id: "docs",
      name: "Docs",
      children: [page],
    };
    const result = withDocsAvailability(tree, () => ({}), "2.0.1");

    assertEquals(
      (result.children[0] as DocsPageTreeItem).docsAvailability,
      undefined,
    );
  });
});

describe("renderAvailabilityMarkdown", () => {
  it("renders permanent release history", () => {
    assertEquals(
      renderAvailabilityMarkdown(
        { introduced: "2.0.0-beta.4", state: "historical" },
        "/changelog/2.0.0-beta.4",
      ),
      "_Available since ZotLit [2.0.0-beta.4](/changelog/2.0.0-beta.4)._",
    );
  });
});
