// A note open in a loaded text view keeps its live text in that view, not on
// disk. The view's own save writes the text it captured before a disk write
// that lands during that save, and that disk write is lost. Obsidian's
// Properties editor edits an open note through its view for this reason; a
// read or rewrite here does the same, and reads or writes any other note on
// disk.

import type { ChangeSpec } from "@codemirror/state";
import { diffChars } from "diff";
import {
  getFrontMatterInfo,
  MarkdownView,
  parseYaml,
  stringifyYaml,
  TextFileView,
} from "obsidian";
import type { TFile, Vault, Workspace } from "obsidian";

/** The host a live-text read or write needs: the vault, and the views it shows. */
export type LiveTextApp = {
  vault: Pick<Vault, "process">;
  workspace: Pick<Workspace, "iterateAllLeaves">;
};

/** The loaded text view that edits `file`, in any window; `null` when none. */
export function loadedTextFileView(
  app: { workspace: Pick<Workspace, "iterateAllLeaves"> },
  file: TFile,
  exclude?: TextFileView,
): TextFileView | null {
  let found: TextFileView | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (
      found === null &&
      view !== exclude &&
      view instanceof TextFileView &&
      view.file === file &&
      view.lastSavedData !== null &&
      view.data !== null
    )
      found = view;
  });
  return found;
}

/** `file`'s live text: its loaded view's text, else the vault's. */
export async function readLiveText(
  app: {
    vault: Pick<Vault, "cachedRead">;
    workspace: Pick<Workspace, "iterateAllLeaves">;
  },
  file: TFile,
): Promise<string> {
  return (
    loadedTextFileView(app, file)?.getViewData() ??
    (await app.vault.cachedRead(file))
  );
}

/**
 * Rewrite `file`'s live text with `fn`, which runs synchronously on the text it
 * replaces. When a loaded view edits the note, the view takes the new text as
 * an external change and saves it; else one `vault.process` writes it. An
 * output equal to its input writes nothing, and a throw leaves the note as is.
 *
 * A view that holds other text than it was given — one that normalizes line
 * endings, or one still binding its file — is set back to its own text, and
 * the write goes through the vault as any disk change. `fn` then runs a second
 * time, on the disk's text, so it must hold no effect a rerun would repeat.
 *
 * When the view's own save is in progress, the view writes the new text right
 * after that save, so the returned promise can settle before the disk has it.
 *
 * @param fn - The rewrite; it may throw to refuse, and runs at most twice.
 */
export async function processLiveText(
  app: LiveTextApp,
  file: TFile,
  fn: (text: string) => string,
): Promise<void> {
  const view = loadedTextFileView(app, file);
  if (view !== null) {
    const text = view.getViewData();
    const next = fn(text);
    if (next === text) return;
    setViewDataKeepingScroll(view, next);
    if (view.getViewData() === next) {
      await view.save();
      return;
    }
    setViewDataKeepingScroll(view, text);
  }
  await app.vault.process(file, fn);
}

/** Native text replacement keeps persistence and history; a mapped snapshot keeps the viewport. */
function setViewDataKeepingScroll(view: TextFileView, text: string): void {
  const editor =
    view instanceof MarkdownView && view.getMode() === "source"
      ? view.editor.cm
      : null;
  const state = editor?.state;
  const scroll = editor?.scrollSnapshot();
  view.setViewData(text, false);
  if (!editor || !state || !scroll || state.doc === editor.state.doc) return;

  // Obsidian replaces the span between the first and last changed lines. An
  // anchor inside that span maps to its start, even when its text is unchanged.
  // Map through the individual edits to retain the block the reader is viewing.
  const changes: ChangeSpec[] = [];
  let offset = 0;
  for (const part of diffChars(
    state.doc.toString(),
    editor.state.doc.toString(),
  )) {
    if (part.added) changes.push({ from: offset, insert: part.value });
    else {
      if (part.removed)
        changes.push({ from: offset, to: offset + part.value.length });
      offset += part.value.length;
    }
  }
  const mapped = scroll.map(state.changes(changes));
  if (mapped) editor.dispatch({ effects: mapped });
}

/**
 * A note's Properties as `processFrontMatter` hands them to its callback: an
 * empty object for a note without a block or with a block that is not a map.
 *
 * @throws YAMLParseError when the Properties block does not parse.
 */
export function parseFrontMatter(text: string): Record<string, unknown> {
  const info = getFrontMatterInfo(text);
  const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * `text` with its Properties block rewritten from `frontmatter`, the splice
 * Obsidian 1.14.2's `processFrontMatter` performs: each fence keeps its line
 * ending, an empty `frontmatter` removes the block, and a note without one
 * gets it prepended.
 */
export function spliceFrontMatter(
  text: string,
  frontmatter: Record<string, unknown>,
): string {
  const info = getFrontMatterInfo(text);
  if (Object.keys(frontmatter).length === 0)
    return info.exists ? text.slice(info.contentStart) : text;
  const yaml = stringifyYaml(frontmatter);
  return info.exists
    ? text.slice(0, info.from) + yaml + text.slice(info.to)
    : `---\n${yaml}---\n${text}`;
}

/**
 * `processFrontMatter` on `file`'s live text: `fn` mutates the parsed
 * Properties, and {@link spliceFrontMatter} writes them back.
 *
 * @throws YAMLParseError when the Properties block does not parse.
 */
export function processLiveFrontMatter(
  app: LiveTextApp,
  file: TFile,
  fn: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
  return processLiveText(app, file, (text) => {
    const frontmatter = parseFrontMatter(text);
    fn(frontmatter);
    return spliceFrontMatter(text, frontmatter);
  });
}
