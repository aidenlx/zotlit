// Serves the ZotLit Native Pandoc Workflow skill archive for this deployment.

import {
  agentSkillArchiveStaticParams,
  serveAgentSkillArchive,
} from "@/lib/agent-skills";

export { agentSkillArchiveStaticParams as generateStaticParams };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ commitSha: string }> },
) {
  return serveAgentSkillArchive("zotlit-pandoc", params);
}
