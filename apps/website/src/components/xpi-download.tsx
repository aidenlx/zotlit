import { ActionLink } from "@/components/action-link.tsx";
import { releasesUrl } from "@/lib/github-releases.ts";
import type { ReleaseChannel } from "@/lib/github-releases.ts";

export interface XpiDownloadProps {
  channel?: ReleaseChannel;
}

/**
 * Download link for the newest companion `.xpi`. Resolving the exact asset
 * needs release facts from GitHub at request time, which the routing shell does
 * not fetch yet, so the link falls back to the releases listing — the same form
 * it takes whenever GitHub is unreachable.
 */
// oxlint-disable-next-line no-unused-vars -- the props are the contract the MDX writes against
export function XpiDownload(props: XpiDownloadProps) {
  return (
    <ActionLink href={releasesUrl} kind="external">
      Browse releases for the latest <code>.xpi</code>
    </ActionLink>
  );
}
