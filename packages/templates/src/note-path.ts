/**
 * The Note Path rule: turn a rendered Filename Template into a relative note
 * path and join it under the Literature note folder. Pure functions with no
 * localized text, shared by the plugin's note creation and the Workbench.
 */

/**
 * Characters Obsidian forbids in a file name. Beyond the platform-agnostic
 * `\ / :` and Windows `* ? " < > |`, the path doubles as a wikilink /
 * frontmatter-link target, so `# ^ [ ]` are stripped too.
 */
const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Windows reserved device names; an exact (case-insensitive) match is invalid. */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function isBidirectionalFormattingControl(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function stripBidirectionalFormattingControls(input: string): string {
  let result = "";
  for (const character of input) {
    if (!isBidirectionalFormattingControl(character.codePointAt(0)!)) {
      result += character;
    }
  }
  return result;
}

/** Maximum bytes for a single filesystem path component (ext4, HFS+, NTFS). */
export const MAX_SEGMENT_BYTES = 255;

/**
 * Normalize a single path segment into a safe Obsidian file/folder name:
 * replace forbidden characters with `_`, strip leading dots and trailing
 * dots/spaces, and prefix Windows reserved names. Returns `""` for a
 * degenerate segment (empty, `.`, `..`, or all dots/spaces).
 */
export function normalizeFilename(input: string): string {
  let result = input
    .replace(FORBIDDEN_CHARS, "_")
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "");
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  return result;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Truncate `name` so its UTF-8 encoding fits within `maxBytes`, iterating by
 * code point so surrogate pairs are never split. Strips trailing dots/spaces
 * the cut may expose.
 */
export function truncateToByteLimit(name: string, maxBytes: number): string {
  let byteCount = 0;
  let endIndex = 0;
  for (const cp of name) {
    const cpBytes = utf8ByteLength(cp.codePointAt(0)!);
    if (byteCount + cpBytes > maxBytes) break;
    byteCount += cpBytes;
    endIndex += cp.length;
  }
  if (endIndex >= name.length) return name;
  return name.slice(0, endIndex).replace(/[. ]+$/, "");
}

/** UTF-8 byte cost of the `.md` extension {@link joinNotePath} appends. */
const MD_EXT_BYTES = 3;

/**
 * Resolve a rendered name into one safe file name with no subfolders: `/` (and
 * every other forbidden character) becomes `_`. The name is truncated to leave
 * room for the `.md` extension.
 *
 * @returns the file name (no extension), or `null` when it normalizes to empty.
 */
export function resolveFlatNoteName(rendered: string): string | null {
  const name = truncateToByteLimit(
    normalizeFilename(rendered),
    MAX_SEGMENT_BYTES - MD_EXT_BYTES,
  );
  return name === "" ? null : name;
}

/**
 * Resolve a rendered Filename Template into a relative note path (no `.md`
 * extension), routing `/`-separated segments into nested subfolders.
 *
 * The last segment is the file name; preceding segments are folders. Degenerate
 * folder segments (empty / `.` / `..`) are dropped, so no `..` traversal is
 * honored. Every segment is sanitized per {@link normalizeFilename} and
 * truncated to the filesystem byte limit ({@link MAX_SEGMENT_BYTES}).
 *
 * @param rendered the rendered template, or `null` when it rendered no name.
 * @returns the relative path, or `null` when there is no rendered name or the
 *   file name slot normalizes to empty.
 */
export function resolveNoteRelPath(rendered: string | null): string | null {
  if (rendered === null) return null;
  const segments = stripBidirectionalFormattingControls(rendered).split("/");
  const filename = resolveFlatNoteName(segments.pop() ?? "");
  if (filename === null) return null;

  const folders = segments
    .map((segment) =>
      truncateToByteLimit(normalizeFilename(segment), MAX_SEGMENT_BYTES),
    )
    .filter((segment) => segment !== "");
  return [...folders, filename].join("/");
}

/** The no-break spaces Obsidian's `normalizePath` turns into plain spaces. */
const NO_BREAK_SPACES = / | /g;

/**
 * Normalize a folder setting the way Obsidian's `normalizePath` does: `\` and
 * repeated slashes become one `/`, surrounding slashes go, no-break spaces
 * become plain spaces, and the text is NFC-composed.
 *
 * @returns the folder path, or `""` for the vault root (empty, `/`, or `.`).
 */
function normalizeNoteFolder(folder: string): string {
  const dir = folder
    .replaceAll(/[\\/]+/g, "/")
    .replaceAll(/^\/|\/$/g, "")
    .replaceAll(NO_BREAK_SPACES, " ")
    .normalize("NFC");
  return dir === "." ? "" : dir;
}

/**
 * Join a relative note path (from {@link resolveNoteRelPath}) under a folder and
 * append `.md`. The folder is normalized as Obsidian's `normalizePath` does; an
 * empty folder, `/`, or `.` is the vault root.
 */
export function joinNotePath(folder: string, rel: string): string {
  const dir = normalizeNoteFolder(folder);
  return dir === "" ? `${rel}.md` : `${dir}/${rel}.md`;
}
