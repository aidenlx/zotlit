// Builds the ZotLit Template Agent Skill archive and discovery index.

import { findWorkspaceDir } from "@pnpm/find-workspace-dir";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { baseURL } from "./shared";

export const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const SKILL_NAME = "zotlit-template";
export const SKILL_REPOSITORY_PATH = `skills/${SKILL_NAME}/SKILL.md`;
export const OPENAI_METADATA_REPOSITORY_PATH = `skills/${SKILL_NAME}/agents/openai.yaml`;

const workspaceDir = await findWorkspaceDir(process.cwd());
if (!workspaceDir) throw new Error("Could not find the pnpm workspace root.");
const repoRoot = workspaceDir;

const SKILL_PATH = join(repoRoot, SKILL_REPOSITORY_PATH);
const OPENAI_METADATA_PATH = join(repoRoot, OPENAI_METADATA_REPOSITORY_PATH);

interface CreateAgentSkillsIndexOptions {
  skill: Uint8Array;
  archive: Uint8Array;
  commitSha: string;
}

interface CreateAgentSkillArchiveOptions {
  skill: Uint8Array;
  openAiMetadata: Uint8Array;
}

export function createAgentSkillArchive({
  skill,
  openAiMetadata,
}: CreateAgentSkillArchiveOptions): Uint8Array<ArrayBuffer> {
  return zipSync(
    {
      "SKILL.md": skill,
      "agents/openai.yaml": openAiMetadata,
    },
    { level: 9, mtime: new Date(2000, 0, 1) },
  );
}

export function createAgentSkillsIndex({
  skill,
  archive,
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
          type: "archive",
          description,
          url: `${baseURL}/.well-known/agent-skills/${SKILL_NAME}/${commitSha}/archive.zip`,
          digest: digest(archive),
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

export function readOpenAiMetadata(): Promise<Buffer> {
  return readFile(OPENAI_METADATA_PATH);
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
