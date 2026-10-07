// The verified-pin cache and hash every Managed Binary pin script shares.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** What a Managed Binary build pins: the release, its download, and the binary's hash. */
export interface BinaryPin {
  version: string;
  url: string;
  sha256: string;
}

/**
 * The pin a previous build verified for this version and these bytes, so a
 * repeat build skips the cross-check download. An unreadable or stale cache is
 * a miss.
 */
export async function readVerifiedPin<Pin extends BinaryPin>(
  cachePath: string,
  { version, sha256 }: Pick<BinaryPin, "version" | "sha256">,
): Promise<Pin | undefined> {
  let cached: Pin;
  try {
    cached = JSON.parse(await readFile(cachePath, "utf8")) as Pin;
  } catch {
    return undefined;
  }
  return cached.version === version && cached.sha256 === sha256
    ? cached
    : undefined;
}

export async function writeVerifiedPin(
  cachePath: string,
  pin: BinaryPin,
): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(pin, null, 2));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
