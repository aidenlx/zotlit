import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AGENT_SKILLS_SCHEMA,
  createAgentSkillsIndex,
  readAgentSkill,
  SKILL_NAME,
  SKILL_REPOSITORY_PATH,
} from "./agent-skills";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const SKILL = new TextEncoder().encode(`---
name: zotlit-template
description: "Author and debug ZotLit templates."
---

# ZotLit Template Workbench
`);

describe("Agent Skill distribution", () => {
  it("builds a pinned discovery index from the SKILL.md bytes", () => {
    const index = JSON.parse(
      createAgentSkillsIndex({ skill: SKILL, commitSha: COMMIT_SHA }),
    );
    const digest = createHash("sha256").update(SKILL).digest("hex");

    expect(index).toEqual({
      $schema: AGENT_SKILLS_SCHEMA,
      skills: [
        {
          name: SKILL_NAME,
          type: "skill-md",
          description: "Author and debug ZotLit templates.",
          url: `https://raw.githubusercontent.com/aidenlx/zotlit/${COMMIT_SHA}/${SKILL_REPOSITORY_PATH}`,
          digest: `sha256:${digest}`,
        },
      ],
    });
  });

  it("keeps the root skill directory, frontmatter, and index aligned", async () => {
    const skill = await readAgentSkill();
    const index = JSON.parse(
      createAgentSkillsIndex({ skill, commitSha: COMMIT_SHA }),
    );

    expect(SKILL_REPOSITORY_PATH).toBe(`skills/${SKILL_NAME}/SKILL.md`);
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0].name).toBe(SKILL_NAME);
  });
});
