// Release-build pin for the Chinese Segmenter: version and hash come from the installed
// `jieba-wasm` package, the download URL from that same package version on the npm CDN.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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

/**
 * The segmenter download a build commits to. The plugin never ships the
 * binary; it downloads {@link url} at runtime and admits it only once it
 * hashes to {@link sha256}.
 */
export interface ChineseSegmenterPin {
  /** Installed `jieba-wasm` version, e.g. `2.4.0`. */
  version: string;
  /** Exact URL of the web-target `jieba_rs_wasm_bg.wasm` for that version. */
  url: string;
  /** Lowercase hex SHA-256 of that `.wasm` file. */
  sha256: string;
}

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
): Promise<ChineseSegmenterPin> {
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

  const cached = await readCache(cachePath);
  if (cached?.version === version && cached.sha256 === sha256) return cached;

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

  const pin: ChineseSegmenterPin = { version, url, sha256 };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(pin, null, 2));
  return pin;
}

/** An unreadable or stale cache is a miss; the pin is re-resolved and rewritten. */
async function readCache(
  cachePath: string,
): Promise<ChineseSegmenterPin | undefined> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as ChineseSegmenterPin;
  } catch {
    return undefined;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
