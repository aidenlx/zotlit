// Serves a complete ZotLit Template skill archive pinned to a Git commit.

import {
  createAgentSkillArchive,
  OPENAI_METADATA_REPOSITORY_PATH,
  SKILL_REPOSITORY_PATH,
} from "@/lib/agent-skills";
import { gitConfig } from "@/lib/shared";

const REPOSITORY_RAW_URL = `https://raw.githubusercontent.com/${gitConfig.user}/${gitConfig.repo}`;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ commitSha: string }> },
) {
  const { commitSha } = await params;
  if (!isCommitSha(commitSha)) return new Response(null, { status: 404 });

  const [skill, openAiMetadata] = await Promise.all([
    readPublishedFile(commitSha, SKILL_REPOSITORY_PATH),
    readPublishedFile(commitSha, OPENAI_METADATA_REPOSITORY_PATH),
  ]);
  if (skill === null || openAiMetadata === null) {
    return new Response(null, { status: 404 });
  }

  return new Response(createAgentSkillArchive({ skill, openAiMetadata }), {
    headers: {
      "Cache-Control": IMMUTABLE_CACHE,
      "Content-Type": "application/zip",
    },
  });
}

function isCommitSha(value: string): boolean {
  if (value.length !== 40) return false;
  for (const character of value) {
    if (!"0123456789abcdef".includes(character)) return false;
  }
  return true;
}

async function readPublishedFile(
  commitSha: string,
  repositoryPath: string,
): Promise<Uint8Array | null> {
  const response = await fetch(
    `${REPOSITORY_RAW_URL}/${commitSha}/${repositoryPath}`,
  );
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}
