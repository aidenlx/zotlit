import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { agentSkillAssets } from "./agent-skills";
import { zotlitBetaUrl } from "./shared";

const packageRoot = resolve(import.meta.dirname, "../..");
const indexRoute = "/.well-known/agent-skills/index.json";

describe("agentSkillAssets", () => {
  it("publishes beta archive URLs on the beta origin", async () => {
    const assets = await agentSkillAssets(packageRoot, "beta");
    const index = JSON.parse(
      new TextDecoder().decode(assets.get(indexRoute)),
    ) as { skills: Array<{ url: string }> };

    expect(index.skills.map(({ url }) => new URL(url).origin)).toEqual(
      index.skills.map(() => zotlitBetaUrl),
    );
  });
});
