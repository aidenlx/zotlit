// Node's hashing, as a browser trial sees it: Chromium has no synchronous
// SHA-256, so the cache key is computed by a deterministic 64-bit FNV-1a hash
// instead. What the trials assert is identity — two requests for the same pixels
// hash alike, two edits do not — and never the digest's cryptographic
// properties, which `request.test.ts` covers in Node against real node:crypto.

/** The one hasher {@link createHash} builds: the `node:crypto` surface it uses. */
export interface SyncHash {
  update(value: string): SyncHash;
  digest(encoding: "hex"): string;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64 = (1n << 64n) - 1n;

export function createHash(algorithm: string): SyncHash {
  if (algorithm !== "sha256")
    throw new Error(`Unsupported hash algorithm: ${String(algorithm)}`);
  let hash = FNV_OFFSET;
  const hasher: SyncHash = {
    update(value) {
      for (const byte of new TextEncoder().encode(value))
        hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64;
      return hasher;
    },
    digest(encoding) {
      if (encoding !== "hex")
        throw new Error(`Unsupported digest encoding: ${String(encoding)}`);
      return hash.toString(16).padStart(16, "0");
    },
  };
  return hasher;
}

/** The renderer's own random source, which is the production behavior. */
export function randomUUID(): string {
  return crypto.randomUUID();
}
