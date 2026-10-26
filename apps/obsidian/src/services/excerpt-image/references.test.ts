import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";
import type { VaultSource } from "@/lib/obsidian-vault";

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

/** The referenced paths of the note at {@link PATH}, read through the host's tags. */
const referenced = (host: ReturnType<typeof vaultWith>["host"]) =>
  referencedExcerptPaths(host.file(PATH)).pipe(
    Effect.provide(
      layerHost({
        vault: host.vault as unknown as VaultSource,
        metadataCache: host.metadataCache as unknown as MetadataCacheSource,
        workspace: host.workspace,
      }),
    ),
  );

const scan = (content: string) =>
  Effect.gen(function* () {
    const { host, resolve } = vaultWith(content);
    return { paths: yield* referenced(host), resolve };
  });

it.effect("reads the links of an open note's unsaved text", () =>
  Effect.gen(function* () {
    const { host } = vaultWith("![[Images/saved.png]]");
    host.openInEditor(host.file(PATH)).edit("![[Images/typed.png]]");

    expect(yield* referenced(host)).toEqual(["Images/typed.png"]);
  }),
);

it.effect.each([
  "![[Images/current.png|200]]",
  "[[Images/current.png|Figure]]",
  "![Figure](Images/current.png)",
  "[Figure](Images/current.png)",
  "![Figure][current]\n\n[current]: Images/current.png",
  "[current][]\n\n[current]: Images/current.png",
  "[Current]\n\n[current]: Images/current.png",
])("resolves the current target from %s with no cached references", (content) =>
  Effect.gen(function* () {
    const result = yield* scan(content);
    expect(result.paths).toEqual(["Images/current.png"]);
    expect(result.resolve).toHaveBeenCalledExactlyOnceWith(
      "Images/current.png",
      "Notes/Paper.md",
    );
  }),
);

it.effect(
  "excludes inline code, fenced code, escaped links and unused reference definitions",
  () =>
    Effect.gen(function* () {
      const { paths } = yield* scan(
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
    }),
);

it.effect(
  "decodes Markdown destinations and strips subpaths before Obsidian resolution",
  () =>
    Effect.gen(function* () {
      const { paths } = yield* scan(
        "[One](Images/space%20name.png)\n[Two](<Images/angle name.png>)\n[Three](Images/round\\(name\\).png)\n[[Images/wiki.png#heading|Figure]]\n[Hash](Images/hash%23name.png#section)",
      );
      expect(paths).toEqual([
        "Images/space name.png",
        "Images/angle name.png",
        "Images/round(name).png",
        "Images/wiki.png",
        "Images/hash#name.png",
      ]);
    }),
);
