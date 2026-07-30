import { execFileSync } from "node:child_process";

import {
  createAgentSkillArchive,
  createAgentSkillsIndex,
  OPENAI_METADATA_REPOSITORY_PATH,
  readAgentSkill,
  readOpenAiMetadata,
  SKILL_REPOSITORY_PATH,
} from "@/lib/agent-skills";

export const dynamic = "force-static";

export async function GET() {
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commitSha =
    vercelCommitSha ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const [skill, openAiMetadata] =
    vercelCommitSha === undefined
      ? [
          execFileSync("git", [
            "show",
            `${commitSha}:${SKILL_REPOSITORY_PATH}`,
          ]),
          execFileSync("git", [
            "show",
            `${commitSha}:${OPENAI_METADATA_REPOSITORY_PATH}`,
          ]),
        ]
      : await Promise.all([readAgentSkill(), readOpenAiMetadata()]);
  const archive = createAgentSkillArchive({ skill, openAiMetadata });

  return new Response(createAgentSkillsIndex({ skill, archive, commitSha }), {
    headers: { "Content-Type": "application/json" },
  });
}
