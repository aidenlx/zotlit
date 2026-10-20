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

// An Annotation the web Workbench previews carries the same durable link as
// one Obsidian writes into a note.
it("holds the default annotation template as its annotation section", async () => {
  const annotation = await readFile(
    new URL(
      import.meta.resolve("@zotlit/templates/defaults/annotation.liquid"),
    ),
    "utf8",
  );
  const [, section] = DEFAULT_PROFILE_SOURCE.split(
    "--- zotlit:annotation ---\n",
  );
  expect(section).toBe(annotation);
});
