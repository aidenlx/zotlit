// A note embed, `![[Reading list]]`, in a template's note preview draws a
// placeholder in place of the embedded note.
// Obsidian renders Markdown in two steps: the Markdown becomes HTML, where an
// embed is an empty `.internal-embed` span, and then the post-processors run,
// after which Obsidian loads each span not marked `is-loaded`. This
// post-processor runs in that gap and replaces each note embed with a
// placeholder that names the note and says whether the vault holds it. The
// preview is not the note, so it neither shows the note's text nor offers to
// create a missing note. Embeds of other files the vault holds, such as
// images, PDFs and Query Files, keep their own rendering.
import { parseLinktext, setIcon } from "obsidian";
import type { App, MarkdownPostProcessor, TFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { isDraftMarkdown } from "@/lib/reading-view";

/** The note an embed in the preview links to; `null` for an embed of another file. */
function embeddedNote(
  app: App,
  linktext: string,
  sourcePath: string,
): { path: string; subpath: string; file: TFile | null } | null {
  const { path, subpath } = parseLinktext(linktext);
  const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (file !== null)
    return file.extension === "md" ? { path, subpath, file } : null;
  // A link with no file behind it is a note Obsidian offers to create,
  // whatever its name holds, such as "Smith et al. 2020".
  return { path, subpath, file: null };
}

/** The post-processor that draws the placeholder for each note embed in a preview. */
export function noteEmbedPlaceholders(app: App): MarkdownPostProcessor {
  return (el, ctx) => {
    if (!isDraftMarkdown(el)) return;
    for (const embed of el.querySelectorAll<HTMLElement>(
      ".internal-embed:not(.is-loaded)",
    )) {
      const linktext = embed.getAttribute("src");
      if (linktext === null) continue;
      const note = embeddedNote(app, linktext, ctx.sourcePath);
      if (note === null) continue;
      embed.replaceWith(placeholder(embed.ownerDocument, linktext, note));
    }
  };
}

function placeholder(
  doc: Document,
  linktext: string,
  note: { path: string; subpath: string; file: TFile | null },
): HTMLElement {
  const box = doc.createElement("div");
  box.className =
    "zt:my-2 zt:flex zt:flex-col zt:gap-1 zt:rounded-md zt:border-(length:--border-width) zt:border-solid zt:border-(--background-modifier-border) zt:px-3 zt:py-2 zt:text-sm zt:text-muted-foreground";
  box.dataset["previewEmbed"] = note.file === null ? "missing" : "found";
  const header = box.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2",
  });
  setIcon(
    header.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-faint" }),
    note.file === null ? "file-question" : "file-text",
  );
  const name = note.file?.basename ?? (note.path || linktext);
  const target = note.subpath
    ? `${name} › ${note.subpath.replace(/^#\^?/, "").replaceAll("#", " › ")}`
    : name;
  header.createSpan({
    cls: "zt:[font-weight:var(--font-medium)] zt:text-foreground",
    text: target,
  });
  header.createSpan({ text: m.note_preview_embed_label() });
  box.createDiv({
    text:
      note.file === null
        ? m.note_preview_embed_missing({ name })
        : m.note_preview_embed_found({ path: note.file.path }),
  });
  return box;
}
