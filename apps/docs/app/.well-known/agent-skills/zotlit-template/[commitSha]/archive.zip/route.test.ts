import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";

import {
  OPENAI_METADATA_REPOSITORY_PATH,
  SKILL_REPOSITORY_PATH,
} from "@/lib/agent-skills";

import { GET } from "./route";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const SKILL = `---
name: zotlit-template
description: "Author and debug ZotLit templates."
---

# ZotLit Template Workbench
`;
const OPENAI_METADATA = `interface:
  display_name: "ZotLit Template Workbench"
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("serves the complete skill archive for a pinned commit", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith(SKILL_REPOSITORY_PATH)) return new Response(SKILL);
    if (url.endsWith(OPENAI_METADATA_REPOSITORY_PATH)) {
      return new Response(OPENAI_METADATA);
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);

  const response = await GET(new Request("https://example.com"), {
    params: Promise.resolve({ commitSha: COMMIT_SHA }),
  });
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(strFromU8(files["SKILL.md"]!)).toBe(SKILL);
  expect(strFromU8(files["agents/openai.yaml"]!)).toBe(OPENAI_METADATA);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith(
    `https://raw.githubusercontent.com/aidenlx/zotlit/${COMMIT_SHA}/${SKILL_REPOSITORY_PATH}`,
  );
  expect(fetch).toHaveBeenCalledWith(
    `https://raw.githubusercontent.com/aidenlx/zotlit/${COMMIT_SHA}/${OPENAI_METADATA_REPOSITORY_PATH}`,
  );
});
