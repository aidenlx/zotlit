// Release-build pin for the Chinese Segmenter: version and hash come from the installed
// `jieba-wasm` package, the download URL from that same package version on the npm CDN.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BinaryPin } from "../src/services/managed-binary/service.ts";
import { readVerifiedPin, sha256Hex, writeVerifiedPin } from "./binary-pin.ts";

const packageRoot = resolve(import.meta.dirname, "..");

/**
 * The web-target binary inside the package. The worker loads it through the
 * package's own web glue, so the pin and the glue come from one build.
 */
const BINARY_PATH = "pkg/web/jieba_rs_wasm_bg.wasm";

/**
 * The upstream GitHub releases carry no assets, so the pin names the file the
 * npm tarball holds, as jsDelivr serves it: the bare `.wasm`, no archive.
 */
const CDN_ROOT = "https://cdn.jsdelivr.net/npm/jieba-wasm";

export interface ResolveChineseSegmenterPinOptions {
  /**
   * Root of the installed `jieba-wasm` package.
   * @default the copy pnpm links under this package
   */
  packageDir?: string;
  /**
   * Where a verified pin is remembered, so repeat builds of the same bytes skip
   * the cross-check download.
   * @default node_modules/.cache/zotlit/chinese-segmenter.json
   */
  cachePath?: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * Resolves the pinned segmenter download and proves the pin honest: the
 * published file must carry the very binary the installed `jieba-wasm`
 * package holds, which pnpm verified against the lockfile's integrity.
 *
 * @throws when the download fails, or when the published binary and the
 *   installed binary disagree.
 */
export async function resolveChineseSegmenterPin(
  options: ResolveChineseSegmenterPinOptions = {},
): Promise<BinaryPin> {
  const {
    packageDir = join(packageRoot, "node_modules", "jieba-wasm"),
    cachePath = join(
      packageRoot,
      "node_modules",
      ".cache",
      "zotlit",
      "chinese-segmenter.json",
    ),
    fetch = globalThis.fetch,
  } = options;

  const { version } = JSON.parse(
    await readFile(join(packageDir, "package.json"), "utf8"),
  ) as { version: string };
  const sha256 = sha256Hex(await readFile(join(packageDir, BINARY_PATH)));

  const cached = await readVerifiedPin<BinaryPin>(cachePath, {
    version,
    sha256,
  });
  if (cached) return cached;

  const url = `${CDN_ROOT}@${version}/${BINARY_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `jsDelivr answered ${response.status} ${response.statusText} for ${url}`,
    );
  }
  const published = sha256Hex(new Uint8Array(await response.arrayBuffer()));
  if (published !== sha256) {
    throw new Error(
      `The installed jieba-wasm binary hashes to ${sha256}, but ${url} hashes to ${published}`,
    );
  }

  const pin: BinaryPin = { version, url, sha256 };
  await writeVerifiedPin(cachePath, pin);
  return pin;
}
