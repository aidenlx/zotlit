import { ActionLink } from "@/components/action-link";
import { Message } from "@/components/message";
import { useReleaseSnapshot } from "@/components/release-snapshot";
import { releasesUrl } from "@/lib/github-releases";
import type { ReleaseChannel } from "@/lib/github-releases";
import * as m from "@/paraglide/messages.js";

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
        <Message
          text={m.docs_browse_xpi({ extension: "{extension}" })}
          slots={{ extension: <code>.xpi</code> }}
        />
      </ActionLink>
    );
  }

  return (
    <ActionLink
      href={companion.xpiUrl}
      kind="download"
      filename={`zotlit-zotero-${companion.version}.xpi`}
    >
      <Message
        text={m.docs_download_xpi({ extension: "{extension}" })}
        slots={{ extension: <code>.xpi</code> }}
      />
    </ActionLink>
  );
}
