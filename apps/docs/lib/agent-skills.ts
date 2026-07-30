// Builds the ZotLit Template Agent Skill archive and discovery index.

import { zipSync } from "fflate";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { baseURL } from "./shared";

export const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const SKILL_NAME = "zotlit-template";
export const SKILL_REPOSITORY_PATH = `skills/${SKILL_NAME}/SKILL.md`;
export const OPENAI_METADATA_REPOSITORY_PATH = `skills/${SKILL_NAME}/agents/openai.yaml`;

interface CreateAgentSkillsIndexOptions {
  skill: Uint8Array;
  archive: Uint8Array;
  commitSha: string;
}

export interface AgentSkillFiles {
  skill: Uint8Array;
  openAiMetadata: Uint8Array;
}

/** Commit this build publishes: the Vercel deploy commit, else local HEAD. */
export function resolvePinnedCommitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  );
}

/**
 * The skill files this deployment publishes, read from the checked-out
 * repository. Both the discovery index and the archive route render from
 * these same bytes at build time, so the digest always matches.
 */
export async function readAgentSkillFiles(): Promise<AgentSkillFiles> {
  const [skill, openAiMetadata] = await Promise.all([
    readWorkspaceFile(SKILL_REPOSITORY_PATH),
    readWorkspaceFile(OPENAI_METADATA_REPOSITORY_PATH),
  ]);
  return { skill, openAiMetadata };
}

export function createAgentSkillArchive({
  skill,
  openAiMetadata,
}: AgentSkillFiles): Uint8Array<ArrayBuffer> {
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

// Resolved lazily so importing this module stays side-effect free — the
// archive route's serverless bundle has no pnpm-workspace.yaml, and an
// import-time lookup would crash every request with a 500.
async function readWorkspaceFile(repositoryPath: string): Promise<Buffer> {
  const workspaceRoot = await getWorkspaceRoot(process.cwd());
  return readFile(join(workspaceRoot, repositoryPath));
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
