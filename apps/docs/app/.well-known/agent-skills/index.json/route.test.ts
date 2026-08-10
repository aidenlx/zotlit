import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import {
  createAgentSkillArchive,
  readAgentSkillFiles,
  SKILL_NAMES,
} from "@/lib/agent-skills";
import type { AgentSkillName } from "@/lib/agent-skills";

import { GET } from "./route";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

async function expectedDigest(name: AgentSkillName): Promise<string> {
  const archive = createAgentSkillArchive(await readAgentSkillFiles(name));
  return `sha256:${createHash("sha256").update(archive).digest("hex")}`;
}

async function expectPublishedSkills(
  skills: readonly {
    name: AgentSkillName;
    type: string;
    url: string;
    digest: string;
  }[],
): Promise<void> {
  expect(skills.map((skill) => skill.name)).toEqual(SKILL_NAMES);
  for (const skill of skills) {
    expect(skill).toMatchObject({
      type: "archive",
      url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${skill.name}/${COMMIT_SHA}/archive.zip`,
      digest: await expectedDigest(skill.name),
    });
  }
}

it("serves the Vercel-pinned Agent Skills index", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await GET();
  const index = await response.json();

  expect(response.headers.get("content-type")).toContain("application/json");
  await expectPublishedSkills(index.skills);
  expect(execFileSync).not.toHaveBeenCalled();
});

it("pins the index to the local HEAD outside Vercel", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync.mockReturnValueOnce(`${COMMIT_SHA}\n`);

  const response = await GET();
  const index = await response.json();

  await expectPublishedSkills(index.skills);
  expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
    "git",
    ["rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
});
