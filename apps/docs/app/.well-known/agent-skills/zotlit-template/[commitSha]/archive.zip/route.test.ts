import { strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

import { GET as getIndex } from "@/app/.well-known/agent-skills/index.json/route";
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

it("serves the deploy commit's archive from the checked-out files", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await getArchive(COMMIT_SHA);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const { skill, openAiMetadata } = await readAgentSkillFiles();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(strFromU8(files["SKILL.md"]!)).toBe(Buffer.from(skill).toString());
  expect(strFromU8(files["agents/openai.yaml"]!)).toBe(
    Buffer.from(openAiMetadata).toString(),
  );
  expect(execFileSync).not.toHaveBeenCalled();
});

it("serves bytes matching the discovery index digest", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const index = await (await getIndex()).json();
  const archive = new Uint8Array(
    await (await getArchive(COMMIT_SHA)).arrayBuffer(),
  );
  const digest = createHash("sha256").update(archive).digest("hex");

  expect(index.skills[0].url).toContain(`/${COMMIT_SHA}/archive.zip`);
  expect(index.skills[0].digest).toBe(`sha256:${digest}`);
});

it("pins to the local HEAD outside Vercel", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync.mockReturnValue(`${COMMIT_SHA}\n`);

  const response = await getArchive(COMMIT_SHA);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
});

it("returns 404 for commits other than the pinned commit", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  const response = await getArchive("f".repeat(40));

  expect(response.status).toBe(404);
});

it("returns 404 when no pinned commit resolves", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
  execFileSync.mockImplementation(() => {
    throw new Error("git unavailable");
  });

  const response = await getArchive(COMMIT_SHA);

  expect(response.status).toBe(404);
});

it("prerenders the archive for the pinned commit", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", COMMIT_SHA);

  expect(generateStaticParams()).toEqual([{ commitSha: COMMIT_SHA }]);
});
