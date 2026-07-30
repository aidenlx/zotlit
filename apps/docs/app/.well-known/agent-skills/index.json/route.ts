import {
  createAgentSkillArchive,
  createAgentSkillsIndex,
  readAgentSkillFiles,
  resolvePinnedCommitSha,
} from "@/lib/agent-skills";

export const dynamic = "force-static";

export async function GET() {
  const commitSha = resolvePinnedCommitSha();
  const files = await readAgentSkillFiles();
  const archive = createAgentSkillArchive(files);

  return new Response(
    createAgentSkillsIndex({ skill: files.skill, archive, commitSha }),
    { headers: { "Content-Type": "application/json" } },
  );
}
