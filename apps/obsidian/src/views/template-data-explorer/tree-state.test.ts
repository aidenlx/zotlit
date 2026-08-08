import { describe, expect, it } from "vitest";

import {
  initialTreeState,
  setAnchor,
  setFilter,
  toggleNode,
} from "./tree-state";
import type { TreeState } from "./tree-state";

describe("initialTreeState", () => {
  it("returns a fresh empty state with no anchor by default", () => {
    const state = initialTreeState();
    expect(state).toEqual<TreeState>({
      anchorKey: null,
      filterQuery: "",
      expanded: new Set(),
      noteRootExpanded: null,
      preFilterExpanded: null,
      filterCollapsed: new Set(),
    });
  });

  it("accepts a persisted anchorKey", () => {
    const state = initialTreeState("annot-1");
    expect(state.anchorKey).toBe("annot-1");
    expect(state.expanded.size).toBe(0);
    expect(state.filterQuery).toBe("");
  });
});

describe("toggleNode", () => {
  it("toggles the key in expanded when not filtering", () => {
    const state = initialTreeState();
    const opened = toggleNode(state, "a.b");
    expect(opened.expanded.has("a.b")).toBe(true);
    expect(opened.filterCollapsed.size).toBe(0);

    const closed = toggleNode(opened, "a.b");
    expect(closed.expanded.has("a.b")).toBe(false);
  });

  it("toggles the key in filterCollapsed when filtering", () => {
    const state = setFilter(initialTreeState(), "foo");
    const collapsed = toggleNode(state, "a.b");
    expect(collapsed.filterCollapsed.has("a.b")).toBe(true);
    expect(collapsed.expanded.size).toBe(0);

    const reopened = toggleNode(collapsed, "a.b");
    expect(reopened.filterCollapsed.has("a.b")).toBe(false);
  });
});

describe("setFilter", () => {
  it("snapshots expanded into preFilterExpanded on entering a filter", () => {
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const filtering = setFilter(withExpansion, "foo");
    expect(filtering.preFilterExpanded).toEqual(new Set(["a", "b"]));
    expect(filtering.filterQuery).toBe("foo");
  });

  it("restores expanded from preFilterExpanded on leaving a filter", () => {
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const filtering = setFilter(withExpansion, "foo");
    const changedWhileFiltering = toggleNode(filtering, "c");
    const cleared = setFilter(changedWhileFiltering, "");
    expect(cleared.expanded).toEqual(new Set(["a", "b"]));
    expect(cleared.preFilterExpanded).toBeNull();
  });

  it("restores to an empty set when there was no prior stash", () => {
    const cleared = setFilter(setFilter(initialTreeState(), "foo"), "");
    expect(cleared.expanded).toEqual(new Set());
  });

  it("resets filterCollapsed on every query change, including query-to-query", () => {
    const filtering = setFilter(initialTreeState(), "foo");
    const collapsed = toggleNode(filtering, "x");
    expect(collapsed.filterCollapsed.size).toBe(1);

    const requeried = setFilter(collapsed, "foobar");
    expect(requeried.filterCollapsed.size).toBe(0);
  });
});

describe("setAnchor", () => {
  it("clears an active filter when anchoring to an annotation", () => {
    const filtering = setFilter(initialTreeState(), "foo");
    const anchored = setAnchor(filtering, "annot-1");
    expect(anchored.filterQuery).toBe("");
    expect(anchored.filterCollapsed).toEqual(new Set());
    expect(anchored.preFilterExpanded).toBeNull();
  });

  it("clears an active filter when returning to the note root", () => {
    const anchored: TreeState = { ...initialTreeState(), anchorKey: "annot-1" };
    const filtering = setFilter(anchored, "foo");
    const backToRoot = setAnchor(filtering, null);
    expect(backToRoot.filterQuery).toBe("");
    expect(backToRoot.filterCollapsed).toEqual(new Set());
    expect(backToRoot.preFilterExpanded).toBeNull();
  });

  it("stashes note-root expanded and starts anchored tree collapsed", () => {
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const anchored = setAnchor(withExpansion, "annot-1");
    expect(anchored.noteRootExpanded).toEqual(new Set(["a", "b"]));
    expect(anchored.expanded).toEqual(new Set());
    expect(anchored.anchorKey).toBe("annot-1");
  });

  it("restores note-root expanded when returning from an anchor", () => {
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const anchored = setAnchor(withExpansion, "annot-1");
    const backToRoot = setAnchor(anchored, null);
    expect(backToRoot.expanded).toEqual(new Set(["a", "b"]));
    expect(backToRoot.noteRootExpanded).toBeNull();
    expect(backToRoot.anchorKey).toBeNull();
  });

  it("restores an empty set when returning with no note-root stash", () => {
    const anchored: TreeState = { ...initialTreeState(), anchorKey: "annot-1" };
    const backToRoot = setAnchor(anchored, null);
    expect(backToRoot.expanded).toEqual(new Set());
  });

  it("preserves the note-root stash across anchor-to-anchor swaps", () => {
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const firstAnchor = setAnchor(withExpansion, "annot-1");
    const expandedWhileAnchored = toggleNode(firstAnchor, "x");
    const secondAnchor = setAnchor(expandedWhileAnchored, "annot-2");

    expect(secondAnchor.noteRootExpanded).toEqual(new Set(["a", "b"]));
    expect(secondAnchor.expanded).toEqual(new Set());
    expect(secondAnchor.anchorKey).toBe("annot-2");
  });

  it("preserves the pre-filter expanded snapshot for the eventual return to note root", () => {
    // Regression: setAnchor must not touch `expanded` as part of clearing the
    // filter, because during a filter `toggleNode` only ever mutates
    // `filterCollapsed` — `expanded` stays exactly the pre-filter snapshot the
    // whole time, so the note-root stash captured on the anchor swap is
    // correct even though a filter was active moments before.
    const withExpansion: TreeState = {
      ...initialTreeState(),
      expanded: new Set(["a", "b"]),
    };
    const filtering = setFilter(withExpansion, "foo");
    const toggledWhileFiltering = toggleNode(filtering, "c");
    const anchored = setAnchor(toggledWhileFiltering, "annot-1");

    expect(anchored.noteRootExpanded).toEqual(new Set(["a", "b"]));

    const backToRoot = setAnchor(anchored, null);
    expect(backToRoot.expanded).toEqual(new Set(["a", "b"]));
  });
});
