import { execFileSync } from "node:child_process";

import {
  createAgentSkillsIndex,
  readAgentSkill,
  SKILL_REPOSITORY_PATH,
} from "@/lib/agent-skills";

export const dynamic = "force-static";

export async function GET() {
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commitSha =
    vercelCommitSha ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const skill =
    vercelCommitSha === undefined
      ? execFileSync("git", ["show", `${commitSha}:${SKILL_REPOSITORY_PATH}`])
      : await readAgentSkill();

  return new Response(createAgentSkillsIndex({ skill, commitSha }), {
    headers: { "Content-Type": "application/json" },
  });
}
