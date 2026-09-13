// Release availability: what a page's Introduced/Updated Release means once
// it is read against the Docs Release Line this deployment represents.
//
// Server-only in practice — the page tree is decorated before it crosses the
// `createServerFn` boundary and a page's availability rides on its loader
// payload, so `semver` stays out of the browser bundle.

import type * as PageTree from "fumadocs-core/page-tree";
import { gt, lt, major, minor, patch, valid } from "semver";

// `release.ts` is the sole writer of the Docs Release Line, and writes it to
// the package root — see ADR 0002. `package.json` maps the subpath import.
import zotlitRelease from "#zotlit-release.json" with { type: "json" };

/** The Docs Release Line this deployment represents. */
export const DOCS_RELEASE_VERSION = zotlitRelease.version;

export interface DocsAvailability {
  introduced: string;
  state: DocsAvailabilityState;
}

export type DocsAvailabilityState = "new" | "historical";
export type DocsSidebarBadge = "new" | "updated";

/**
 * A page's Introduced/Updated Release. Both are unset for a page that
 * hasn't gone through a release cycle yet — see ADR 0002.
 */
export interface DocsReleaseMetadata {
  introduced?: string;
  updated?: string;
}

/** A page-tree page carrying the badge the sidebar renders beside its name. */
export type DocsPageTreeItem = PageTree.Item & {
  docsAvailability?: DocsSidebarBadge;
};

/** The non-prerelease major, minor, and patch version for a release. */
export function getStableReleaseLine(version: string) {
  if (!valid(version)) throw new Error(`Invalid docs release: ${version}`);
  return `${major(version)}.${minor(version)}.${patch(version)}`;
}

/** Classify one docs release value against the current Docs Release Line. */
function getDocsReleaseState(
  release: string,
  docsReleaseLine: string,
): DocsAvailabilityState {
  const releaseLine = getStableReleaseLine(release);

  if (gt(releaseLine, docsReleaseLine)) {
    throw new Error(
      `Docs release ${release} is ahead of current Docs Release Line ${docsReleaseLine}`,
    );
  }

  return releaseLine === docsReleaseLine ? "new" : "historical";
}

/**
 * Resolve page-level availability from its Introduced Release.
 * @returns undefined for a page with no Introduced Release yet (has not gone
 *   through a release cycle — see ADR 0002).
 */
export function getDocsAvailability(
  introduced: string,
  docsRelease?: string,
): DocsAvailability;
export function getDocsAvailability(
  introduced: string | undefined,
  docsRelease?: string,
): DocsAvailability | undefined;
export function getDocsAvailability(
  introduced: string | undefined,
  docsRelease = DOCS_RELEASE_VERSION,
): DocsAvailability | undefined {
  if (introduced === undefined) return undefined;
  const docsReleaseLine = getStableReleaseLine(docsRelease);
  return {
    introduced,
    state: getDocsReleaseState(introduced, docsReleaseLine),
  };
}

/**
 * Derive one sidebar badge from a page's feature and content history.
 * @returns undefined when either release is unset (unreleased page) or
 *   neither release falls in the current Docs Release Line.
 */
export function getDocsSidebarBadge(
  metadata: DocsReleaseMetadata,
  docsRelease = DOCS_RELEASE_VERSION,
): DocsSidebarBadge | undefined {
  const { introduced, updated } = metadata;
  if (introduced === undefined || updated === undefined) return undefined;

  if (lt(updated, introduced)) {
    throw new Error(
      `Updated Release ${updated} predates Introduced Release ${introduced}`,
    );
  }

  const docsReleaseLine = getStableReleaseLine(docsRelease);
  const introducedState = getDocsReleaseState(introduced, docsReleaseLine);
  const updatedState = getDocsReleaseState(updated, docsReleaseLine);

  if (introducedState === "new") return "new";
  if (updatedState === "new") return "updated";
  return undefined;
}

/** Add sidebar-only release status without mutating fumadocs' cached page tree. */
export function withDocsAvailability(
  tree: PageTree.Root,
  getMetadata: (item: PageTree.Item) => DocsReleaseMetadata | undefined,
  docsRelease = DOCS_RELEASE_VERSION,
): PageTree.Root {
  const docsReleaseLine = getStableReleaseLine(docsRelease);
  const mapItem = (item: PageTree.Item): DocsPageTreeItem => {
    const metadata = getMetadata(item);

    return {
      ...item,
      docsAvailability: metadata
        ? getDocsSidebarBadge(metadata, docsReleaseLine)
        : undefined,
    };
  };

  const mapNode = (node: PageTree.Node): PageTree.Node => {
    if (node.type === "page") return mapItem(node);
    if (node.type === "separator") return node;
    return {
      ...node,
      index: node.index ? mapItem(node.index) : undefined,
      children: node.children.map(mapNode),
    };
  };

  const mapRoot = (root: PageTree.Root): PageTree.Root => ({
    ...root,
    $id: `${root.$id ?? "docs"}:release-${docsReleaseLine}`,
    children: root.children.map(mapNode),
    fallback: root.fallback ? mapRoot(root.fallback) : undefined,
  });

  return mapRoot(tree);
}

/** Availability copy shared by a page's Markdown edition and llms-full.txt. */
export function renderAvailabilityMarkdown(
  availability: DocsAvailability,
  changelogUrl?: string,
) {
  const version = changelogUrl
    ? `[${availability.introduced}](${changelogUrl})`
    : availability.introduced;

  return `_Available since ZotLit ${version}._`;
}
