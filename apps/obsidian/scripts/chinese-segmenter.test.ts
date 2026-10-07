import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { resolveChineseSegmenterPin } from "./chinese-segmenter.ts";

const VERSION = "2.4.0";
const BINARY = new TextEncoder().encode("\0asm pretend jieba");

/** Writes the layout `resolveChineseSegmenterPin` reads an installed package as. */
async function installedPackage() {
  const packageDir = await mkdtemp(join(tmpdir(), "zotlit-jieba-wasm-"));
  onTestFinished(() => rm(packageDir, { recursive: true, force: true }));
  await mkdir(join(packageDir, "pkg", "web"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "jieba-wasm", version: VERSION }),
  );
  await writeFile(
    join(packageDir, "pkg", "web", "jieba_rs_wasm_bg.wasm"),
    BINARY,
  );
  return {
    packageDir,
    cachePath: join(packageDir, "cache", "chinese-segmenter.json"),
  };
}

const ASSET_URL =
  "https://cdn.jsdelivr.net/npm/jieba-wasm@2.4.0/pkg/web/jieba_rs_wasm_bg.wasm";

/** Serves the asset, counting the requests so a cache hit is observable. */
function upstream(asset: Uint8Array | Response = BINARY) {
  const requests: string[] = [];
  const fetch = ((input: string) => {
    requests.push(input);
    return Promise.resolve(
      asset instanceof Response ? asset : new Response(asset),
    );
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

describe("resolveChineseSegmenterPin", () => {
  it("pins the installed version and web binary hash to the published asset", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch, requests } = upstream();

    await expect(
      resolveChineseSegmenterPin({ packageDir, cachePath, fetch }),
    ).resolves.toEqual({
      version: VERSION,
      url: ASSET_URL,
      sha256: createHash("sha256").update(BINARY).digest("hex"),
    });
    expect(requests).toEqual([ASSET_URL]);
  });

  it("reuses a cached pin for unchanged bytes instead of downloading again", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const pin = await resolveChineseSegmenterPin({
      packageDir,
      cachePath,
      fetch: upstream().fetch,
    });
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(pin);

    const second = upstream();
    await expect(
      resolveChineseSegmenterPin({
        packageDir,
        cachePath,
        fetch: second.fetch,
      }),
    ).resolves.toEqual(pin);
    expect(second.requests).toEqual([]);
  });

  it("fails when the published asset carries a different binary", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream(new TextEncoder().encode("other"));

    await expect(
      resolveChineseSegmenterPin({ packageDir, cachePath, fetch }),
    ).rejects.toThrow("The installed jieba-wasm binary hashes to");
  });

  it("fails when the asset cannot be downloaded", async () => {
    const { packageDir, cachePath } = await installedPackage();
    const { fetch } = upstream(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      resolveChineseSegmenterPin({ packageDir, cachePath, fetch }),
    ).rejects.toThrow(`404 Not Found for ${ASSET_URL}`);
  });
});
