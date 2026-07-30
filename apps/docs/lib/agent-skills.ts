// Builds the Agent Skills discovery index from the repository skill.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const SKILL_NAME = "zotlit-template";
export const SKILL_REPOSITORY_PATH = `skills/${SKILL_NAME}/SKILL.md`;

const REPOSITORY = "aidenlx/zotlit";
const SKILL_PATH = resolve("..", "..", SKILL_REPOSITORY_PATH);

interface CreateAgentSkillsIndexOptions {
  skill: Uint8Array;
  commitSha: string;
}

export function createAgentSkillsIndex({
  skill,
  commitSha,
}: CreateAgentSkillsIndexOptions): string {
  const { name, description } = parseSkillMetadata(
    new TextDecoder().decode(skill),
  );
  if (name !== SKILL_NAME) {
    throw new Error(
      `SKILL.md frontmatter name must match its '${SKILL_NAME}' directory.`,
    );
  }

  return `${JSON.stringify(
    {
      $schema: AGENT_SKILLS_SCHEMA,
      skills: [
        {
          name,
          type: "skill-md",
          description,
          url: `https://raw.githubusercontent.com/${REPOSITORY}/${commitSha}/${SKILL_REPOSITORY_PATH}`,
          digest: digest(skill),
        },
      ],
    },
    null,
    2,
  )}\n`;
}

export function readAgentSkill(): Promise<Buffer> {
  return readFile(SKILL_PATH);
}

function digest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function parseSkillMetadata(content: string): {
  name: string;
  description: string;
} {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is not closed.");
  }

  const name = readFrontmatterString(lines.slice(1, end), "name");
  const description = readFrontmatterString(lines.slice(1, end), "description");
  return { name, description };
}

function readFrontmatterString(
  lines: readonly string[],
  field: string,
): string {
  const prefix = `${field}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`SKILL.md frontmatter is missing '${field}'.`);
  const value = line.slice(prefix.length).trim();
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (!value) throw new Error(`SKILL.md frontmatter '${field}' is empty.`);
  return value;
}
