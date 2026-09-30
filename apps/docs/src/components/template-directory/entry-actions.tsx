// An entry page's actions: one-click add for a Profile, the text the reader pastes for a recipe, and the artifact byte for byte.

import { Copy, Download, Import } from "lucide-react";

import { Command } from "@/components/command";
import { Message } from "@/components/message";
import { UiLabel } from "@/components/ui-label";
import { toast } from "@/components/ui/toast";
import { openProfileInObsidian } from "@/lib/profile-handoff";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { COPY_LABEL } from "./labels";

const ACTION =
  "inline-flex min-h-10 cursor-pointer items-center gap-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring [&_svg]:size-4";
/** The entry's first action: add to ZotLit for a Profile, copy for a recipe. */
const PRIMARY =
  "bg-fd-foreground text-fd-background hover:bg-fd-primary hover:text-fd-primary-foreground";
const SECONDARY =
  "border border-fd-border bg-fd-card hover:border-fd-primary hover:text-fd-primary";

/** Puts the text on the clipboard and says so in a toast; `failed` names the toast a refusal shows. */
export function copyToClipboard(text: string, failed: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.add({ title: m.docs_directory_copied(), type: "success" }),
    () => toast.add({ title: failed, type: "error" }),
  );
}

/** Saves the entry's file byte for byte and says so in a toast. */
export function downloadFile({ name, text }: SiteEntry["file"]) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  toast.add({
    title: m.docs_directory_downloaded({ file: name }),
    type: "success",
  });
}

export function EntryActions({
  entry,
}: {
  entry: Pick<SiteEntry, "kind" | "copyText" | "file">;
}) {
  function addToZotLit() {
    openProfileInObsidian(entry.copyText).then(
      () =>
        toast.add({
          title: m.docs_directory_import_started(),
          type: "success",
        }),
      () => toast.add({ title: m.docs_directory_add_failed(), type: "error" }),
    );
  }

  if (entry.kind === "profile") {
    return (
      <button
        type="button"
        onClick={addToZotLit}
        className={`${ACTION} ${PRIMARY}`}
      >
        <Import aria-hidden />
        {m.docs_directory_import()}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={() =>
          copyToClipboard(entry.copyText, m.docs_directory_copy_failed())
        }
        className={`${ACTION} ${PRIMARY}`}
      >
        <Copy aria-hidden />
        {COPY_LABEL[entry.kind]()}
      </button>
      <button
        type="button"
        onClick={() => downloadFile(entry.file)}
        className={`${ACTION} ${SECONDARY}`}
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

/**
 * Below a Profile's steps: the way in when the browser does not open Obsidian.
 * Copying the note and running the import command adds it the same way.
 */
export function ImportFallback({ copyText }: Pick<SiteEntry, "copyText">) {
  return (
    <p className="max-w-[60ch] text-sm text-pretty text-fd-muted-foreground">
      <Message
        text={m.docs_directory_import_fallback({
          copy: "{copy}",
          command: "{command}",
          clipboard: "{clipboard}",
        })}
        slots={{
          copy: (
            <button
              type="button"
              onClick={() =>
                copyToClipboard(copyText, m.docs_directory_add_failed())
              }
              className="cursor-pointer text-fd-foreground underline decoration-fd-primary underline-offset-4 hover:text-fd-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
            >
              {m.docs_directory_copy_it()}
            </button>
          ),
          command: <Command inline name={m.command_import_profile_name()} />,
          clipboard: <UiLabel name={m.profile_import_clipboard()} />,
        }}
      />
    </p>
  );
}
