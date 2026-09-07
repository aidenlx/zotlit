// The revision a Profile document is compared by, on both sides of a save.

import { createHash } from "node:crypto";

/**
 * The revision both sides compare a document by: the SHA-256 of its exact
 * source. A Save carries the revision the page loaded, and the write boundary
 * hashes the file it is about to replace the same way.
 */
export function profileRevision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
