import { strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createAgentSkillArchive,
  AGENT_SKILLS_SCHEMA,
  createAgentSkillsIndex,
  readAgentSkillFiles,
  SKILL_NAMES,
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
const PANDOC_SKILL = new TextEncoder().encode(`---
name: zotlit-pandoc
description: "Run ZotLit's Native Pandoc Workflow."
---

# ZotLit Native Pandoc Workflow
`);
const PANDOC_METADATA = new TextEncoder().encode(`interface:
  display_name: "ZotLit Native Pandoc Workflow"
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

  it("builds a pinned discovery index from every skill archive", () => {
    const templateArchive = createAgentSkillArchive({
      skill: SKILL,
      openAiMetadata: OPENAI_METADATA,
    });
    const pandocArchive = createAgentSkillArchive({
      skill: PANDOC_SKILL,
      openAiMetadata: PANDOC_METADATA,
    });
    const index = JSON.parse(
      createAgentSkillsIndex({
        skills: [
          { name: "zotlit-template", skill: SKILL, archive: templateArchive },
          {
            name: "zotlit-pandoc",
            skill: PANDOC_SKILL,
            archive: pandocArchive,
          },
        ],
        commitSha: COMMIT_SHA,
      }),
    );
    const templateDigest = createHash("sha256")
      .update(templateArchive)
      .digest("hex");
    const pandocDigest = createHash("sha256")
      .update(pandocArchive)
      .digest("hex");

    expect(index).toEqual({
      $schema: AGENT_SKILLS_SCHEMA,
      skills: [
        {
          name: "zotlit-template",
          type: "archive",
          description: "Author and debug ZotLit templates.",
          url: `https://zotlit.aidenlx.site/.well-known/agent-skills/zotlit-template/${COMMIT_SHA}/archive.zip`,
          digest: `sha256:${templateDigest}`,
        },
        {
          name: "zotlit-pandoc",
          type: "archive",
          description: "Run ZotLit's Native Pandoc Workflow.",
          url: `https://zotlit.aidenlx.site/.well-known/agent-skills/zotlit-pandoc/${COMMIT_SHA}/archive.zip`,
          digest: `sha256:${pandocDigest}`,
        },
      ],
    });
  });

  it("keeps the root skill directory, frontmatter, and index aligned", async () => {
    const builds = await Promise.all(
      SKILL_NAMES.map(async (name) => {
        const files = await readAgentSkillFiles(name);
        return {
          name,
          skill: files.skill,
          archive: createAgentSkillArchive(files),
        };
      }),
    );
    const index = JSON.parse(
      createAgentSkillsIndex({ skills: builds, commitSha: COMMIT_SHA }),
    );

    expect(index.skills.map((skill: { name: string }) => skill.name)).toEqual(
      SKILL_NAMES,
    );
  });
});
