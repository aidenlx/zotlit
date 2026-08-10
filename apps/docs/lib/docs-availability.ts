import type * as PageTree from "fumadocs-core/page-tree";
import { gt, lt, major, minor, patch, valid } from "semver";

import packageJson from "@/../obsidian/package.json" with { type: "json" };

export const DOCS_RELEASE_VERSION = packageJson.version;

export interface DocsAvailability {
  introduced: string;
  state: DocsAvailabilityState;
}

export type DocsAvailabilityState = "new" | "historical";
export type DocsSidebarBadge = "new" | "updated";

export interface DocsReleaseMetadata {
  introduced: string;
  updated: string;
}

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

/** Resolve page-level availability from its Introduced Release. */
export function getDocsAvailability(
  introduced: string,
  docsRelease = DOCS_RELEASE_VERSION,
): DocsAvailability {
  const docsReleaseLine = getStableReleaseLine(docsRelease);
  return {
    introduced,
    state: getDocsReleaseState(introduced, docsReleaseLine),
  };
}

/** Derive one sidebar badge from a page's feature and content history. */
export function getDocsSidebarBadge(
  metadata: DocsReleaseMetadata,
  docsRelease = DOCS_RELEASE_VERSION,
): DocsSidebarBadge | undefined {
  if (lt(metadata.updated, metadata.introduced)) {
    throw new Error(
      `Updated Release ${metadata.updated} predates Introduced Release ${metadata.introduced}`,
    );
  }

  const docsReleaseLine = getStableReleaseLine(docsRelease);
  const introduced = getDocsReleaseState(metadata.introduced, docsReleaseLine);
  const updated = getDocsReleaseState(metadata.updated, docsReleaseLine);

  if (introduced === "new") return "new";
  if (updated === "new") return "updated";
  return undefined;
}

/** Resolve current availability from the checked-out Obsidian package version. */
export function resolveDocsAvailability(introduced: string): DocsAvailability {
  return getDocsAvailability(introduced);
}

/** Add sidebar-only release status without mutating Fumadocs' cached page tree. */
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

function markdownVersion(version: string, changelogUrl?: string) {
  return changelogUrl ? `[${version}](${changelogUrl})` : version;
}

/** Availability copy shared by per-page Markdown and llms-full.txt. */
export function renderAvailabilityMarkdown(
  availability: DocsAvailability,
  changelogUrl?: string,
) {
  const version = markdownVersion(availability.introduced, changelogUrl);
  return `_Available since ZotLit ${version}._`;
}
