// An entry page's actions: one-click import for a Profile, the text the reader pastes, and the artifact byte for byte.

import { Copy, Download, Import } from "lucide-react";

import { Command } from "@/components/command";
import { Message } from "@/components/message";
import { UiLabel } from "@/components/ui-label";
import { toast } from "@/components/ui/toast";
import { openProfileInObsidian } from "@/lib/profile-handoff";
import type { SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { copyLabel } from "./labels";

const ACTION =
  "inline-flex min-h-10 cursor-pointer items-center gap-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring [&_svg]:size-4";
/** The entry's first action: import for a Profile, copy for a recipe. */
const PRIMARY =
  "bg-fd-foreground text-fd-background hover:bg-fd-primary hover:text-fd-primary-foreground";
const SECONDARY =
  "border border-fd-border bg-fd-card hover:border-fd-primary hover:text-fd-primary";

export function EntryActions({
  entry,
}: {
  entry: Pick<SiteEntry, "kind" | "copyText" | "file">;
}) {
  const profile = entry.kind === "profile";

  function copy() {
    navigator.clipboard.writeText(entry.copyText).then(
      () => toast.add({ title: m.docs_directory_copied(), type: "success" }),
      () => toast.add({ title: m.docs_directory_copy_failed(), type: "error" }),
    );
  }

  function importProfile() {
    openProfileInObsidian(entry.copyText).then(
      () =>
        toast.add({
          title: m.docs_directory_import_started(),
          type: "success",
        }),
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {profile && (
          <button
            type="button"
            onClick={importProfile}
            className={`${ACTION} ${PRIMARY}`}
          >
            <Import aria-hidden />
            {m.docs_directory_import()}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          className={`${ACTION} ${profile ? SECONDARY : PRIMARY}`}
        >
          <Copy aria-hidden />
          {copyLabel(entry.kind)}
        </button>
        <button
          type="button"
          onClick={download}
          className={`${ACTION} ${SECONDARY}`}
        >
          <Download aria-hidden />
          {m.docs_directory_download()}
        </button>
        <span className="font-mono text-xs break-all text-fd-muted-foreground">
          {entry.file.name}
        </span>
      </div>
      {profile && (
        <p className="max-w-[60ch] text-sm text-pretty text-fd-muted-foreground">
          <Message
            text={m.docs_directory_import_fallback({
              copy: "{copy}",
              command: "{command}",
              clipboard: "{clipboard}",
            })}
            slots={{
              copy: <UiLabel name={m.docs_directory_copy_profile()} />,
              command: (
                <Command inline name={m.command_import_profile_name()} />
              ),
              clipboard: <UiLabel name={m.profile_import_clipboard()} />,
            }}
          />
        </p>
      )}
    </div>
  );
}
