import { unzipSync } from "fflate";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { agentSkillAssets } from "./agent-skills";
import { zotlitBetaUrl } from "./shared";

const packageRoot = resolve(import.meta.dirname, "../..");
const indexRoute = "/.well-known/agent-skills/index.json";

describe("agentSkillAssets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("publishes the ZotLit Query skill pinned to the CLI's contract version", async () => {
    const assets = await agentSkillAssets(packageRoot, "production");
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as {
      skills: Array<{ name: string; url: string; digest: string }>;
    };
    const skill = index.skills.find(({ name }) => name === "zotlit-query");
    expect(skill).toBeDefined();
    const archiveBytes = assets.get(new URL(skill!.url).pathname)!;
    expect(skill!.digest).toBe(
      `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`,
    );
    const archive = unzipSync(archiveBytes);
    // Publish the installable skill; keep the evaluation runtime in the repo.
    expect(Object.keys(archive).sort()).toEqual([
      "SKILL.md",
      "agents/openai.yaml",
    ]);
    const metadata = frontmatter(
      new TextDecoder().decode(archive["SKILL.md"]),
    ).data;
    const workspaceRoot = await getWorkspaceRoot(packageRoot);
    const version = JSON.parse(
      await readFile(
        resolve(
          workspaceRoot,
          "apps/obsidian/src/services/item-query/contract-version.json",
        ),
        "utf8",
      ),
    ) as {
      contractVersion: number;
    };
    expect(metadata).toMatchObject({
      metadata: { "cli-contract-version": String(version.contractVersion) },
    });
  });

  it("publishes beta archive URLs on the beta origin", async () => {
    const assets = await agentSkillAssets(packageRoot, "beta");
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as { skills: Array<{ url: string }> };

    expect(index.skills.map(({ url }) => new URL(url).origin)).toEqual([
      zotlitBetaUrl,
      zotlitBetaUrl,
      zotlitBetaUrl,
      zotlitBetaUrl,
    ]);
  });

  it("pins archive URLs to the GitHub build commit", async () => {
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("GITHUB_SHA", commitSha);

    const assets = await agentSkillAssets(packageRoot, "production");
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as { skills: Array<{ url: string }> };

    expect(
      index.skills.map(({ url }) => new URL(url).pathname.split("/").at(-2)),
    ).toEqual([commitSha, commitSha, commitSha, commitSha]);
  });
});
