/**
 * Source id — a stable identifier for the Zotero install a notify event came
 * from, so the Obsidian listener can discard events from a Zotero profile /
 * data directory it isn't configured to read.
 *
 * Both sides compute the id independently from the same two directories
 * (`Zotero.Profile.dir` + `Zotero.DataDirectory.dir`), so the inputs MUST
 * canonicalize identically across the two runtimes (Gecko's
 * `Services.io.newFileURI().spec` on the Zotero side, Node's
 * `pathToFileURL().href` on the Obsidian side). {@link normalizeFileUri}
 * absorbs the known divergences (trailing slash, Windows drive-letter casing,
 * Unicode form); the rest of each `file://` URI is produced identically by both
 * serializers for ordinary paths.
 */

/**
 * HTTP header carrying the sender's {@link sourceIdFromUris source id} on
 * `POST /notify` and `PUT /literature-notes`. Checked once at the transport
 * edge so the listener can discard pushes from a Zotero install it isn't
 * configured to read.
 */
export const SOURCE_ID_HEADER = "X-Zotlit-Source-Id";

/** @see https://github.com/sindresorhus/djb2a/blob/main/index.js */
const DJB2A_SEED = 5381;

/** djb2a string hash, returned as an unsigned 32-bit integer. */
export function djb2a(input: string): number {
  let hash = DJB2A_SEED;
  for (let index = 0; index < input.length; index++) {
    // hash * 33 ^ charCode
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return hash >>> 0;
}

/**
 * Canonicalize a `file://` URI so the same directory hashes identically
 * regardless of which runtime produced the URI:
 * - strip a trailing slash (Gecko appends one to existing directories, Node
 *   does not),
 * - upper-case a Windows drive letter (`file:///c:/…` → `file:///C:/…`),
 * - apply Unicode NFC (filesystems may hand back NFD on macOS).
 */
export function normalizeFileUri(uri: string): string {
  return uri
    .normalize("NFC")
    .replace(/\/+$/, "")
    .replace(/^(file:\/\/\/)([a-z]):/i, (_, prefix, drive) => {
      return `${prefix}${(drive as string).toUpperCase()}:`;
    });
}

/**
 * Stable id for a Zotero install, hashed from its profile and data directory
 * file URIs. Returned as an 8-char lowercase hex string.
 *
 * @param profileUri file URI of `Zotero.Profile.dir`
 * @param dataUri file URI of `Zotero.DataDirectory.dir`
 */
export function sourceIdFromUris(profileUri: string, dataUri: string): string {
  const input = `${normalizeFileUri(profileUri)}\0${normalizeFileUri(dataUri)}`;
  return djb2a(input).toString(16).padStart(8, "0");
}
