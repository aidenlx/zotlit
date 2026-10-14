// The one place a Query Block writes its text back into its note. Obsidian's
// own code-block context has a private `replaceCode`, which Bases uses for its
// ` ```base ` blocks: in Live Preview it updates the widget's code before the
// edit, so the widget, and the Query View in it, stays mounted. When an
// Obsidian update removes it, the block writes through public API: the
// section's lines from `getSectionInfo`, and the note's live text through
// `processLiveText`, after a check that the block text did not change. Live
// Preview then builds a new widget. A block that left the page, as its note
// closes, writes through the same public path at the line it last stood at.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import type { MarkdownPostProcessorContext, Vault } from "obsidian";

import { processLiveText } from "@/lib/live-text";
import type { LiveTextApp } from "@/lib/live-text";

/** The host a block write needs. */
export type BlockWriteApp = LiveTextApp & {
  vault: Pick<Vault, "getFileByPath">;
};

/** A rendered code block: its element, and the context it rendered under. */
export interface RenderedBlock {
  readonly ctx: MarkdownPostProcessorContext;
  readonly el: HTMLElement;
}

/** The block's code as it holds it now, and the code to write. */
export interface BlockEdit {
  /** The code the block holds now, as the block last read or wrote it. */
  readonly previous: string;
  readonly next: string;
}

/** The offset line `line` of `text` starts at; `-1` past its last line. */
function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return -1;
    offset = next + 1;
  }
  return offset;
}

/**
 * Replace the code of a rendered block with `edit.next`.
 *
 * @throws Error when the block has no place in a note, or, on the public path,
 *   when its text in the note is no longer `edit.previous` at the line it
 *   rendered.
 */
export async function writeBlockCode(
  app: BlockWriteApp,
  { ctx, el }: RenderedBlock,
  { previous, next }: BlockEdit,
): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (info === null) throw new Error("The Query Block has no place in a note");
  const { replaceCode } = ctx;
  if (typeof replaceCode === "function") {
    replaceCode.call(ctx, next);
    return;
  }
  await writeBlockAt(
    app,
    { sourcePath: ctx.sourcePath, lineStart: info.lineStart },
    { previous, next },
  );
}

/** Where a block stood in its note: the note, and the line of its opening fence. */
export interface BlockPlace {
  readonly sourcePath: string;
  readonly lineStart: number;
}

/**
 * Replace the code of a block at `place` with `edit.next`, through the
 * note's live text. A block that left the page writes this way, at the line
 * it last stood at.
 *
 * @throws Error when the note is gone, or when its text at that line is no
 *   longer `edit.previous`.
 */
export async function writeBlockAt(
  app: BlockWriteApp,
  { sourcePath, lineStart }: BlockPlace,
  { previous, next }: BlockEdit,
): Promise<void> {
  const file = app.vault.getFileByPath(sourcePath);
  if (file === null) throw new Error(`No note at ${sourcePath}`);
  await processLiveText(app, file, (text) => {
    const start = lineOffset(text, lineStart + 1);
    if (start === -1 || text.slice(start, start + previous.length) !== previous)
      throw new Error("The Query Block text changed since it rendered");
    return text.slice(0, start) + next + text.slice(start + previous.length);
  });
}
