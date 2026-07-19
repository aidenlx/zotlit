// Resolves the latest companion `.xpi` and renders a direct download link.
import { ActionLink } from "@/components/action-link";
import {
  getZoteroCompanion,
  releasesUrl,
  type ReleaseChannel,
} from "@/lib/github-releases";

export interface XpiDownloadProps {
  channel?: ReleaseChannel;
}

/**
 * Direct download link for the newest companion `.xpi`, so readers skip the
 * releases page. Falls back to the releases listing when the release can't be
 * resolved (manifest missing or GitHub unreachable).
 */
export async function XpiDownload({
  channel = "pre-release",
}: XpiDownloadProps) {
  const companion = await getZoteroCompanion(channel).catch(() => null);

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
