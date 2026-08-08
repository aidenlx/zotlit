import {
  createAgentSkillArchive,
  createAgentSkillsIndex,
  readAgentSkillFiles,
  resolvePinnedCommitSha,
  SKILL_NAMES,
} from "@/lib/agent-skills";

export const dynamic = "force-static";

export async function GET() {
  const commitSha = resolvePinnedCommitSha();
  const skills = await Promise.all(
    SKILL_NAMES.map(async (name) => {
      const files = await readAgentSkillFiles(name);
      return {
        name,
        skill: files.skill,
        archive: createAgentSkillArchive(files),
      };
    }),
  );

  return new Response(createAgentSkillsIndex({ skills, commitSha }), {
    headers: { "Content-Type": "application/json" },
  });
}
