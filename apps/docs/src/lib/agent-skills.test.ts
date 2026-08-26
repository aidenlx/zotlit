import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agentSkillAssets } from "./agent-skills";
import { zotlitBetaUrl } from "./shared";

const packageRoot = resolve(import.meta.dirname, "../..");
const indexRoute = "/.well-known/agent-skills/index.json";

afterEach(() => vi.unstubAllEnvs());

describe("agentSkillAssets", () => {
  it("publishes beta archive URLs on the beta origin", async () => {
    vi.stubEnv("CLOUDFLARE_ENV", "beta");

    const assets = await agentSkillAssets(packageRoot);
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as { skills: Array<{ url: string }> };

    expect(index.skills.map(({ url }) => new URL(url).origin)).toEqual(
      index.skills.map(() => zotlitBetaUrl),
    );
  });
});
