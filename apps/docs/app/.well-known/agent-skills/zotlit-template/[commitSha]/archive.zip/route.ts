// Serves the ZotLit Template skill archive for this deployment. The zip is
// built at deploy time from the same checked-out files the discovery index
// digests, so the bytes always match the published digest — including for
// deploy commits that are never pushed to GitHub. The commit segment pins
// the immutable URL to one deployment.

import {
  createAgentSkillArchive,
  readAgentSkillFiles,
  resolvePinnedCommitSha,
} from "@/lib/agent-skills";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

// Prerender the archive for the commit the discovery index links to.
export function generateStaticParams() {
  return [{ commitSha: resolvePinnedCommitSha() }];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ commitSha: string }> },
) {
  const { commitSha } = await params;
  if (!isPinnedCommitSha(commitSha)) return new Response(null, { status: 404 });

  return new Response(createAgentSkillArchive(await readAgentSkillFiles()), {
    headers: {
      "Cache-Control": IMMUTABLE_CACHE,
      "Content-Type": "application/zip",
    },
  });
}

function isPinnedCommitSha(value: string): boolean {
  try {
    return value === resolvePinnedCommitSha();
  } catch {
    return false;
  }
}
