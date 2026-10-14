import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

import { DEFAULT_PROFILE_SOURCE } from "./default-profile";

// The web Workbench opens the same default Profile that Obsidian renders.
it("holds the default content template in its managed block", async () => {
  const content = await readFile(
    new URL(import.meta.resolve("@zotlit/templates/defaults/content.liquid")),
    "utf8",
  );
  const managed = /\{% managed %\}\n([\s\S]*?)\{% endmanaged %\}/.exec(
    DEFAULT_PROFILE_SOURCE,
  );
  expect(managed?.[1]).toBe(content);
});
