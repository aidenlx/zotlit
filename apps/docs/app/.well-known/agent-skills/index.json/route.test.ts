import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import {
  createAgentSkillArchive,
  OPENAI_METADATA_REPOSITORY_PATH,
  readAgentSkill,
  readOpenAiMetadata,
  SKILL_NAME,
  SKILL_REPOSITORY_PATH,
} from "@/lib/agent-skills";

import { GET } from "./route";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const COMMITTED_SKILL = Buffer.from(`---
name: zotlit-template
description: "Committed skill bytes."
---

# ZotLit Template
`);
const COMMITTED_OPENAI_METADATA = Buffer.from(`interface:
  display_name: "ZotLit Template Workbench"
`);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("serves the Vercel-pinned Agent Skills index", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await GET();
  const index = await response.json();
  const skill = await readAgentSkill();
  const openAiMetadata = await readOpenAiMetadata();
  const archive = createAgentSkillArchive({ skill, openAiMetadata });
  const digest = createHash("sha256").update(archive).digest("hex");

  expect(response.headers.get("content-type")).toContain("application/json");
  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      type: "archive",
      url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${SKILL_NAME}/${COMMIT_SHA}/archive.zip`,
      digest: `sha256:${digest}`,
    }),
  ]);
  expect(execFileSync).not.toHaveBeenCalled();
});

it("uses the pinned commit's skill bytes outside Vercel", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync
    .mockReturnValueOnce(`${COMMIT_SHA}\n`)
    .mockReturnValueOnce(COMMITTED_SKILL)
    .mockReturnValueOnce(COMMITTED_OPENAI_METADATA);

  const response = await GET();
  const index = await response.json();
  const archive = createAgentSkillArchive({
    skill: COMMITTED_SKILL,
    openAiMetadata: COMMITTED_OPENAI_METADATA,
  });
  const digest = createHash("sha256").update(archive).digest("hex");

  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      type: "archive",
      description: "Committed skill bytes.",
      url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${SKILL_NAME}/${COMMIT_SHA}/archive.zip`,
      digest: `sha256:${digest}`,
    }),
  ]);
  expect(execFileSync).toHaveBeenNthCalledWith(
    1,
    "git",
    ["rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
  expect(execFileSync).toHaveBeenNthCalledWith(2, "git", [
    "show",
    `${COMMIT_SHA}:${SKILL_REPOSITORY_PATH}`,
  ]);
  expect(execFileSync).toHaveBeenNthCalledWith(3, "git", [
    "show",
    `${COMMIT_SHA}:${OPENAI_METADATA_REPOSITORY_PATH}`,
  ]);
});
