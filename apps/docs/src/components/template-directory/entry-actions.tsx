// An entry page's copy and download actions: the text the reader pastes, and the artifact byte for byte.

import { Copy, Download } from "lucide-react";

import { toast } from "@/components/ui/toast";
import type { EntryKind } from "@/lib/template-directory/entry";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

/** The copy action's name, which the entry's steps also quote. */
export function copyLabel(kind: EntryKind): string {
  if (kind === "profile") return m.docs_directory_copy_profile();
  if (kind === "property") return m.docs_directory_copy_rule();
  return m.docs_directory_copy_template();
}

const ACTION =
  "inline-flex min-h-10 cursor-pointer items-center gap-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring [&_svg]:size-4";

export function EntryActions({
  entry,
}: {
  entry: Pick<SiteEntry, "kind" | "copyText" | "file">;
}) {
  function copy() {
    navigator.clipboard.writeText(entry.copyText).then(
      () => toast.add({ title: m.docs_directory_copied(), type: "success" }),
      () => toast.add({ title: m.docs_directory_copy_failed(), type: "error" }),
    );
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([entry.file.text], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = entry.file.name;
    link.click();
    URL.revokeObjectURL(url);
    toast.add({
      title: m.docs_directory_downloaded({ file: entry.file.name }),
      type: "success",
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={copy}
        className={`${ACTION} bg-fd-foreground text-fd-background hover:bg-fd-primary hover:text-fd-primary-foreground`}
      >
        <Copy aria-hidden />
        {copyLabel(entry.kind)}
      </button>
      <button
        type="button"
        onClick={download}
        className={`${ACTION} border border-fd-border bg-fd-card hover:border-fd-primary hover:text-fd-primary`}
      >
        <Download aria-hidden />
        {m.docs_directory_download()}
      </button>
      <span className="font-mono text-xs break-all text-fd-muted-foreground">
        {entry.file.name}
      </span>
    </div>
  );
}
