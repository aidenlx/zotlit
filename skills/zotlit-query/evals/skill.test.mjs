import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await test("research guidance routes contract questions to the live guide and schema", async () => {
  const skill = await readFile(new URL("../SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes("zotlit:query-schema"));
  for (const topic of [
    "datasets",
    "filter",
    "fields",
    "sort",
    "group",
    "results",
    "schema",
    "cancel",
  ])
    assert.ok(
      skill.includes(`zotlit:query-guide topic=${topic}`),
      `Live lookup for ${topic}`,
    );
});
