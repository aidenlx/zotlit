// The ZotLit Agent Skill archives and their discovery index, built from the
// checked-out repository.
//
// Node-only: `vite build` writes these into the client output, so the asset
// layer answers `/.well-known/agent-skills/…` without a Worker invocation. The
// index and the archives render from the same bytes in the same pass, so a
// published digest always matches the archive it names.

import { zipSync } from "fflate";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { baseURL, zotlitBetaUrl } from "./shared.js";

const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SKILL_NAMES = [
  "zotlit-template",
  "zotlit-pandoc",
  "zotlit-citations",
] as const;
type AgentSkillName = (typeof SKILL_NAMES)[number];

/** The URL prefix every agent-skills asset answers under. */
const AGENT_SKILLS_ROUTE = "/.well-known/agent-skills";

/** The SKILL.md frontmatter fields the discovery index publishes. */
const skillMetadata = v.object({
  name: v.string(),
  description: v.string(),
});

/**
 * A fixed archive timestamp in epoch milliseconds (2000-01-01T00:00:00Z), so
 * the archive bytes carry no build clock.
 */
const ARCHIVE_MTIME = 946_684_800_000;

interface AgentSkillFiles {
  skill: Uint8Array;
  openAiMetadata: Uint8Array;
}

/** The commit this build publishes, which every archive URL is pinned to. */
function resolvePinnedCommitSha(workspaceRoot: string): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;

  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();
}

function createArchive({
  skill,
  openAiMetadata,
}: AgentSkillFiles): Uint8Array<ArrayBuffer> {
  return zipSync(
    {
      "SKILL.md": skill,
      "agents/openai.yaml": openAiMetadata,
    },
    { level: 9, mtime: ARCHIVE_MTIME },
  );
}

function digest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function archiveUrl(name: AgentSkillName, commitSha: string): string {
  return `${AGENT_SKILLS_ROUTE}/${name}/${commitSha}/archive.zip`;
}

/**
 * The discovery index and the three archives, keyed by the URL each answers at.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 * @see https://schemas.agentskills.io/discovery/0.2.0/schema.json
 */
export async function agentSkillAssets(
  packageRoot: string,
  docsLine: Cloudflare.Env["DOCS_LINE"],
): Promise<Map<string, Uint8Array>> {
  const workspaceRoot = await getWorkspaceRoot(packageRoot);
  const commitSha = resolvePinnedCommitSha(workspaceRoot);
  const assetBaseURL = docsLine === "beta" ? zotlitBetaUrl : baseURL;

  const built = await Promise.all(
    SKILL_NAMES.map(async (directoryName) => {
      const [skill, openAiMetadata] = await Promise.all([
        readFile(join(workspaceRoot, `skills/${directoryName}/SKILL.md`)),
        readFile(
          join(workspaceRoot, `skills/${directoryName}/agents/openai.yaml`),
        ),
      ]);
      const archive = createArchive({ skill, openAiMetadata });
      const { name, description } = v.parse(
        skillMetadata,
        frontmatter(skill.toString("utf8")).data,
      );
      if (name !== directoryName) {
        throw new Error(
          `SKILL.md frontmatter name must match its '${directoryName}' directory.`,
        );
      }
      return { directoryName, description, archive };
    }),
  );

  const index = `${JSON.stringify(
    {
      $schema: AGENT_SKILLS_SCHEMA,
      skills: built.map(({ directoryName, description, archive }) => ({
        name: directoryName,
        type: "archive",
        description,
        url: `${assetBaseURL}${archiveUrl(directoryName, commitSha)}`,
        digest: digest(archive),
      })),
    },
    null,
    2,
  )}\n`;

  return new Map<string, Uint8Array>([
    [`${AGENT_SKILLS_ROUTE}/index.json`, new TextEncoder().encode(index)],
    ...built.map(({ directoryName, archive }): [string, Uint8Array] => [
      archiveUrl(directoryName, commitSha),
      archive,
    ]),
  ]);
}
