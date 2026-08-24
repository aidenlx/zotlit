// Release-build pin for the Pandoc WASM engine: version and hash come from the installed
// `pandoc-wasm` package, the download URL from the matching official upstream release.

import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");

/** Name the official WASM asset carries the binary under, inside its archive. */
const BINARY_ENTRY = "pandoc.wasm";
const RELEASE_API = "https://api.github.com/repos/jgm/pandoc/releases/tags";

/**
 * The engine download a build commits to. The plugin never ships the binary; it
 * downloads {@link url} at runtime and admits it only once it hashes to
 * {@link sha256}.
 */
export interface PandocEnginePin {
  /** Upstream Pandoc release tag, e.g. `3.10`. */
  version: string;
  /** Exact `jgm/pandoc` release asset carrying the WASM binary. */
  url: string;
  /** Lowercase hex SHA-256 of the uncompressed `pandoc.wasm` inside that asset. */
  sha256: string;
}

export interface ResolvePandocEnginePinOptions {
  /**
   * Root of the installed `pandoc-wasm` package.
   * @default the copy pnpm links under this package
   */
  packageDir?: string;
  /**
   * Where a verified pin is remembered, so repeat builds of the same bytes skip
   * the cross-check download.
   * @default node_modules/.cache/zotlit/pandoc-engine.json
   */
  cachePath?: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/** One release asset, as GitHub's releases API reports it. */
interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  /** GitHub's own digest of the asset bytes, as `sha256:<hex>`. */
  digest: string | null;
}

/**
 * Resolves the pinned engine download and proves the pin honest: the upstream
 * asset must hash to the digest GitHub reports for it, and must carry the very
 * binary the installed `pandoc-wasm` package holds.
 *
 * @throws when the release carries no WASM asset, when GitHub's digest and the
 *   downloaded asset disagree, or when the asset's binary and the installed
 *   binary disagree.
 */
export async function resolvePandocEnginePin(
  options: ResolvePandocEnginePinOptions = {},
): Promise<PandocEnginePin> {
  const {
    packageDir = join(packageRoot, "node_modules", "pandoc-wasm"),
    cachePath = join(
      packageRoot,
      "node_modules",
      ".cache",
      "zotlit",
      "pandoc-engine.json",
    ),
    fetch = globalThis.fetch,
  } = options;

  const version = (
    await readFile(join(packageDir, "pandoc-version.txt"), "utf8")
  ).trim();
  const sha256 = sha256Hex(
    await readFile(join(packageDir, "src", BINARY_ENTRY)),
  );

  const cached = await readCache(cachePath);
  if (cached?.version === version && cached.sha256 === sha256) return cached;

  const asset = selectBinaryAsset(await fetchReleaseAssets(fetch, version));
  await verifyAsset(fetch, asset, sha256);

  const pin: PandocEnginePin = {
    version,
    url: asset.browser_download_url,
    sha256,
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(pin, null, 2));
  return pin;
}

/**
 * Upstream asset names carry the Pandoc version and have changed shape between
 * releases, so the archive is picked by its suffix rather than composed.
 */
function selectBinaryAsset(assets: readonly ReleaseAsset[]): ReleaseAsset {
  const matches = assets.filter((asset) => asset.name.endsWith(".wasm.zip"));
  const [asset] = matches;
  if (matches.length !== 1 || !asset) {
    throw new Error(
      `Expected one .wasm.zip asset on the Pandoc release, found ${matches.length} among: ${assets.map((entry) => entry.name).join(", ")}`,
    );
  }
  return asset;
}

async function fetchReleaseAssets(
  fetch: typeof globalThis.fetch,
  version: string,
): Promise<ReleaseAsset[]> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const response = await fetch(`${RELEASE_API}/${version}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub answered ${response.status} ${response.statusText} for the jgm/pandoc ${version} release`,
    );
  }
  const release = (await response.json()) as { assets: ReleaseAsset[] };
  return release.assets;
}

async function verifyAsset(
  fetch: typeof globalThis.fetch,
  asset: ReleaseAsset,
  binarySha256: string,
): Promise<void> {
  if (asset.digest === null) {
    throw new Error(`GitHub reports no digest for ${asset.name}`);
  }
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) {
    throw new Error(
      `GitHub answered ${response.status} ${response.statusText} for ${asset.browser_download_url}`,
    );
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  const archiveDigest = `sha256:${sha256Hex(archive)}`;
  if (archiveDigest !== asset.digest) {
    throw new Error(
      `${asset.name} hashes to ${archiveDigest}, but GitHub reports ${asset.digest}`,
    );
  }

  // The archive nests the binary under a release-named directory.
  const entries = unzipSync(archive, {
    filter: (file) => file.name.split("/").at(-1) === BINARY_ENTRY,
  });
  const [binary] = Object.values(entries);
  if (!binary) {
    throw new Error(`${asset.name} carries no ${BINARY_ENTRY} entry`);
  }
  const assetSha256 = sha256Hex(binary);
  if (assetSha256 !== binarySha256) {
    throw new Error(
      `The installed pandoc-wasm binary hashes to ${binarySha256}, but ${asset.name} carries ${assetSha256}`,
    );
  }
}

/** An unreadable or stale cache is a miss; the pin is re-resolved and rewritten. */
async function readCache(
  cachePath: string,
): Promise<PandocEnginePin | undefined> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as PandocEnginePin;
  } catch {
    return undefined;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
