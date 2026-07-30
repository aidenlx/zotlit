import { strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createAgentSkillArchive,
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
const OPENAI_METADATA = new TextEncoder().encode(`interface:
  display_name: "ZotLit Template Workbench"
`);

describe("Agent Skill distribution", () => {
  it("packages the complete Codex skill", () => {
    const archive = createAgentSkillArchive({
      skill: SKILL,
      openAiMetadata: OPENAI_METADATA,
    });
    const files = unzipSync(archive);

    expect(Object.keys(files).sort()).toEqual([
      "SKILL.md",
      "agents/openai.yaml",
    ]);
    expect(strFromU8(files["SKILL.md"]!)).toBe(strFromU8(SKILL));
    expect(strFromU8(files["agents/openai.yaml"]!)).toBe(
      strFromU8(OPENAI_METADATA),
    );
  });

  it("builds a pinned discovery index from the archive bytes", () => {
    const archive = createAgentSkillArchive({
      skill: SKILL,
      openAiMetadata: OPENAI_METADATA,
    });
    const index = JSON.parse(
      createAgentSkillsIndex({
        skill: SKILL,
        archive,
        commitSha: COMMIT_SHA,
      }),
    );
    const digest = createHash("sha256").update(archive).digest("hex");

    expect(index).toEqual({
      $schema: AGENT_SKILLS_SCHEMA,
      skills: [
        {
          name: SKILL_NAME,
          type: "archive",
          description: "Author and debug ZotLit templates.",
          url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${SKILL_NAME}/${COMMIT_SHA}/archive.zip`,
          digest: `sha256:${digest}`,
        },
      ],
    });
  });

  it("keeps the root skill directory, frontmatter, and index aligned", async () => {
    const skill = await readAgentSkill();
    const archive = createAgentSkillArchive({
      skill,
      openAiMetadata: OPENAI_METADATA,
    });
    const index = JSON.parse(
      createAgentSkillsIndex({ skill, archive, commitSha: COMMIT_SHA }),
    );

    expect(SKILL_REPOSITORY_PATH).toBe(`skills/${SKILL_NAME}/SKILL.md`);
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0].name).toBe(SKILL_NAME);
  });
});
