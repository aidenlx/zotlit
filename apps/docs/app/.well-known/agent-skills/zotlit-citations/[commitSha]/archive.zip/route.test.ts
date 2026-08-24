import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";

import { readAgentSkillFiles } from "@/lib/agent-skills";

import { GET, generateStaticParams } from "./route";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function getArchive(commitSha: string) {
  return GET(new Request("https://example.com"), {
    params: Promise.resolve({ commitSha }),
  });
}

it("serves the deploy commit's ZotLit citations skill archive", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await getArchive(COMMIT_SHA);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const expected = await readAgentSkillFiles("zotlit-citations");

  expect(response.status).toBe(200);
  expect(strFromU8(files["SKILL.md"]!)).toBe(
    Buffer.from(expected.skill).toString(),
  );
  expect(strFromU8(files["agents/openai.yaml"]!)).toBe(
    Buffer.from(expected.openAiMetadata).toString(),
  );
});

it("returns 404 for a commit other than the deploy commit", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  expect((await getArchive("f".repeat(40))).status).toBe(404);
});

it("prerenders the archive for the deploy commit", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  expect(generateStaticParams()).toEqual([{ commitSha: COMMIT_SHA }]);
});
