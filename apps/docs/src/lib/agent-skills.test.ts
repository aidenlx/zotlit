import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agentSkillAssets } from "./agent-skills";
import { zotlitBetaUrl } from "./shared";

const packageRoot = resolve(import.meta.dirname, "../..");
const indexRoute = "/.well-known/agent-skills/index.json";

describe("agentSkillAssets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("publishes beta archive URLs on the beta origin", async () => {
    const assets = await agentSkillAssets(packageRoot, "beta");
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as { skills: Array<{ url: string }> };

    expect(index.skills.map(({ url }) => new URL(url).origin)).toEqual(
      index.skills.map(() => zotlitBetaUrl),
    );
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
    ).toEqual(index.skills.map(() => commitSha));
  });
});
