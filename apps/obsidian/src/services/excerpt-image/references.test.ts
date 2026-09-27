import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";

import { referencedExcerptPaths } from "./references";

const PATH = "Notes/Paper.md";

/** A vault holding one note as `content`, whose metadata cache is stale. */
function vaultWith(content: string) {
  const host = createObsidianHost({ [PATH]: content });
  const resolve = vi.fn((path: string, _source: string) => ({ path }));
  Object.assign(host.metadataCache, {
    getFileCache: () => {
      throw new Error("The cached note content is stale");
    },
    getFirstLinkpathDest: resolve,
  });
  return { host, resolve };
}

async function scan(content: string) {
  const { host, resolve } = vaultWith(content);
  return {
    paths: await referencedExcerptPaths(
      host.app as unknown as App,
      host.file(PATH),
    ),
    resolve,
  };
}

it("reads the links of an open note's unsaved text", async () => {
  const { host } = vaultWith("![[Images/saved.png]]");
  host.openInEditor(host.file(PATH)).edit("![[Images/typed.png]]");

  expect(
    await referencedExcerptPaths(host.app as unknown as App, host.file(PATH)),
  ).toEqual(["Images/typed.png"]);
});

it.each([
  "![[Images/current.png|200]]",
  "[[Images/current.png|Figure]]",
  "![Figure](Images/current.png)",
  "[Figure](Images/current.png)",
  "![Figure][current]\n\n[current]: Images/current.png",
  "[current][]\n\n[current]: Images/current.png",
  "[Current]\n\n[current]: Images/current.png",
])(
  "resolves the current target from %s with no cached references",
  async (content) => {
    const result = await scan(content);
    expect(result.paths).toEqual(["Images/current.png"]);
    expect(result.resolve).toHaveBeenCalledExactlyOnceWith(
      "Images/current.png",
      "Notes/Paper.md",
    );
  },
);

it("excludes inline code, fenced code, escaped links and unused reference definitions", async () => {
  const { paths } = await scan(
    [
      "`![[inline.png]]` and `[ordinary](inline-link.png)`",
      "```md\n![[fenced.png]]\n![image](fenced-markdown.png)\n```",
      "\\[[escaped.png]]",
      "[unused]: unused.png",
      "",
      "[Kept](current.png)",
    ].join("\n\n"),
  );
  expect(paths).toEqual(["current.png"]);
});

it("decodes Markdown destinations and strips subpaths before Obsidian resolution", async () => {
  const { paths } = await scan(
    "[One](Images/space%20name.png)\n[Two](<Images/angle name.png>)\n[Three](Images/round\\(name\\).png)\n[[Images/wiki.png#heading|Figure]]\n[Hash](Images/hash%23name.png#section)",
  );
  expect(paths).toEqual([
    "Images/space name.png",
    "Images/angle name.png",
    "Images/round(name).png",
    "Images/wiki.png",
    "Images/hash#name.png",
  ]);
});
