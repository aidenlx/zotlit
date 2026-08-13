// Clipboard writing of one payload in several representations, so the destination takes the one it reads.

import { getLogger } from "@/lib/log";

const logger = getLogger("clipboard");

/** Which representation the platform took. */
export type ClipboardRepresentation = "rich" | "text";

export interface RichClipboardPayload {
  /** An HTML fragment, for a destination that keeps inline formatting. */
  html: string;
  /** The same content as text, for a destination that takes text alone. */
  text: string;
}

/**
 * Write one payload as `text/html` and `text/plain` together, so the
 * destination chooses between them at paste time.
 *
 * A platform without the rich clipboard — an older webview, or one that refuses
 * the richer call — takes the text alone rather than nothing, and says so in
 * the return value, since the caller has told the user rich formatting was on
 * the way.
 *
 * @returns which representation reached the clipboard.
 * @throws whatever the platform refused the text write with, so a total failure
 *   stays a failure rather than a quiet success.
 */
export async function writeClipboardRichText({
  html,
  text,
}: RichClipboardPayload): Promise<ClipboardRepresentation> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  } catch (error) {
    logger.warn("The rich clipboard write did not land; writing text", {
      error,
    });
    await navigator.clipboard.writeText(text);
    return "text";
  }
}
