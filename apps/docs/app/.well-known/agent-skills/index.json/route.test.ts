import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import {
  createAgentSkillArchive,
  readAgentSkillFiles,
  SKILL_NAME,
} from "@/lib/agent-skills";

import { GET } from "./route";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

async function expectedDigest(): Promise<string> {
  const archive = createAgentSkillArchive(await readAgentSkillFiles());
  return `sha256:${createHash("sha256").update(archive).digest("hex")}`;
}

it("serves the Vercel-pinned Agent Skills index", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await GET();
  const index = await response.json();

  expect(response.headers.get("content-type")).toContain("application/json");
  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      type: "archive",
      url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${SKILL_NAME}/${COMMIT_SHA}/archive.zip`,
      digest: await expectedDigest(),
    }),
  ]);
  expect(execFileSync).not.toHaveBeenCalled();
});

it("pins the index to the local HEAD outside Vercel", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync.mockReturnValueOnce(`${COMMIT_SHA}\n`);

  const response = await GET();
  const index = await response.json();

  expect(index.skills).toEqual([
    expect.objectContaining({
      name: SKILL_NAME,
      type: "archive",
      url: `https://zotlit.aidenlx.site/.well-known/agent-skills/${SKILL_NAME}/${COMMIT_SHA}/archive.zip`,
      digest: await expectedDigest(),
    }),
  ]);
  expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
    "git",
    ["rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
});
