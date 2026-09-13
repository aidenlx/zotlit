import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePandocEnginePin } from "./pandoc-engine.ts";

const VERSION = "3.10";
const BINARY = new TextEncoder().encode("\0asm pretend pandoc");

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Writes the layout `resolvePandocEnginePin` reads an installed package as. */
async function installedPackage() {
  const packageDir = await mkdtemp(join(tmpdir(), "zotlit-pandoc-wasm-"));
  await mkdir(join(packageDir, "src"));
  await writeFile(join(packageDir, "pandoc-version.txt"), `${VERSION}\n`);
  await writeFile(join(packageDir, "src", "pandoc.wasm"), BINARY);
  return {
    packageDir,
    cachePath: join(packageDir, "cache", "pandoc-engine.json"),
  };
}

interface Upstream {
  assets?: { name: string; browser_download_url: string; digest: string }[];
  archive?: Uint8Array;
}

const ASSET_URL =
  "https://github.com/jgm/pandoc/releases/download/3.10/pandoc-3.10.wasm.zip";

/**
 * Serves one Pandoc release and its asset, counting the requests so a cache hit
 * is observable.
 */
function upstream({ assets, archive }: Upstream = {}) {
  const zip = archive ?? zipSync({ "pandoc/pandoc.wasm": BINARY });
  const requests: string[] = [];
  const fetch = ((input: string) => {
    requests.push(input);
    if (input.startsWith("https://api.github.com/")) {
      return Promise.resolve(
        Response.json({
          assets: assets ?? [
            {
              name: "pandoc-3.10-linux-amd64.tar.gz",
              browser_download_url: "https://example.com/linux.tar.gz",
              digest: `sha256:${"a".repeat(64)}`,
            },
            {
              name: "pandoc-3.10.wasm.zip",
              browser_download_url: ASSET_URL,
              digest: `sha256:${sha256Hex(zip)}`,
            },
          ],
        }),
      );
    }
    return Promise.resolve(new Response(zip));
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

describe("resolvePandocEnginePin", () => {
  it("pins the installed version and binary hash against the matching upstream asset", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream();

    await expect(
      resolvePandocEnginePin({ packageDir, cachePath, fetch }),
    ).resolves.toEqual({
      version: VERSION,
      url: ASSET_URL,
      sha256: sha256Hex(BINARY),
    });
  });

  it("reuses a cached pin for unchanged bytes instead of downloading again", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const first = upstream();
    const pin = await resolvePandocEnginePin({
      packageDir,
      cachePath,
      fetch: first.fetch,
    });
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(pin);

    const second = upstream();
    await expect(
      resolvePandocEnginePin({ packageDir, cachePath, fetch: second.fetch }),
    ).resolves.toEqual(pin);
    expect(second.requests).toEqual([]);
  });

  it("fails when the downloaded asset does not hash to GitHub's digest", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream({
      assets: [
        {
          name: "pandoc-3.10.wasm.zip",
          browser_download_url: ASSET_URL,
          digest: `sha256:${"b".repeat(64)}`,
        },
      ],
    });

    await expect(
      resolvePandocEnginePin({ packageDir, cachePath, fetch }),
    ).rejects.toThrow("GitHub reports sha256:bbb");
  });

  it("fails when the upstream asset carries a different binary", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream({
      archive: zipSync({
        "pandoc/pandoc.wasm": new TextEncoder().encode("other"),
      }),
    });

    await expect(
      resolvePandocEnginePin({ packageDir, cachePath, fetch }),
    ).rejects.toThrow("The installed pandoc-wasm binary hashes to");
  });

  it("fails when the release carries no WASM asset", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream({ assets: [] });

    await expect(
      resolvePandocEnginePin({ packageDir, cachePath, fetch }),
    ).rejects.toThrow("Expected one .wasm.zip asset");
  });
});
