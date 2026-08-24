// Serves the ZotLit Template skill archive for this deployment. The zip is
// built at deploy time from the same checked-out files the discovery index
// digests, so the bytes always match the published digest — including for
// deploy commits that are never pushed to GitHub. The commit segment pins
// the immutable URL to one deployment.

import {
  agentSkillArchiveStaticParams,
  serveAgentSkillArchive,
} from "@/lib/agent-skills";

// Prerender the archive for the commit the discovery index links to.
export { agentSkillArchiveStaticParams as generateStaticParams };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ commitSha: string }> },
) {
  return serveAgentSkillArchive("zotlit-template", params);
}
