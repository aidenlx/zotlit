import { ActionLink } from "@/components/action-link.tsx";
import { useReleaseSnapshot } from "@/components/release-snapshot.tsx";
import { releasesUrl } from "@/lib/github-releases.ts";
import type { ReleaseChannel } from "@/lib/github-releases.ts";

export interface XpiDownloadProps {
  channel?: ReleaseChannel;
}

/**
 * Direct download link for the newest companion `.xpi`, so readers skip the
 * releases page. Falls back to the releases listing when the release could not
 * be resolved — the channel has no release yet, or GitHub was unreachable.
 */
export function XpiDownload({ channel = "pre-release" }: XpiDownloadProps) {
  const companion = useReleaseSnapshot()?.companion[channel];

  if (!companion) {
    return (
      <ActionLink href={releasesUrl} kind="external">
        Browse releases for the latest <code>.xpi</code>
      </ActionLink>
    );
  }

  return (
    <ActionLink
      href={companion.xpiUrl}
      kind="download"
      filename={`zotlit-zotero-${companion.version}.xpi`}
    >
      Download the <code>.xpi</code>
    </ActionLink>
  );
}
