import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import {
  readAgentSkill,
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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("serves the Vercel-pinned Agent Skills index", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await GET();
  const index = await response.json();
  const skill = await readAgentSkill();
  const digest = createHash("sha256").update(skill).digest("hex");

  expect(response.headers.get("content-type")).toContain("application/json");
  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      url: `https://raw.githubusercontent.com/aidenlx/zotlit/${COMMIT_SHA}/skills/${SKILL_NAME}/SKILL.md`,
      digest: `sha256:${digest}`,
    }),
  ]);
  expect(execFileSync).not.toHaveBeenCalled();
});

it("uses the pinned commit's skill bytes outside Vercel", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync
    .mockReturnValueOnce(`${COMMIT_SHA}\n`)
    .mockReturnValueOnce(COMMITTED_SKILL);

  const response = await GET();
  const index = await response.json();
  const digest = createHash("sha256").update(COMMITTED_SKILL).digest("hex");

  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      description: "Committed skill bytes.",
      url: `https://raw.githubusercontent.com/aidenlx/zotlit/${COMMIT_SHA}/${SKILL_REPOSITORY_PATH}`,
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
});
