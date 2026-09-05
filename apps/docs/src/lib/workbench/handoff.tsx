// The one screen an Eta or JavaScript Profile gets. The web host renders
// Liquid and JSON-e only, so such a document is neither edited nor rendered
// here: it is explained, offered back unchanged, and pointed at Obsidian.
// @see docs/adr/0033-web-workbench-is-public-and-standalone.md

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import type { UnsupportedReason } from "./unsupported";

export interface ProfileHandoffProps {
  /** Why the web host cannot take this Profile, one line per reason. */
  reasons: readonly UnsupportedReason[];
  /** Downloads the source as it was read, which is the only copy this page holds. */
  onDownload: () => void;
  onImport: () => void;
  onUndo?: (() => void) | undefined;
  message?: string | null | undefined;
}

export function ProfileHandoff({
  reasons,
  onDownload,
  onImport,
  onUndo,
  message,
}: ProfileHandoffProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-fd-background px-4 py-6 text-fd-foreground">
      <section
        aria-labelledby="workbench-handoff"
        className="flex w-full max-w-xl flex-col gap-4 rounded-md border border-fd-border bg-fd-card p-5 shadow-sm sm:p-6"
      >
        <h1 id="workbench-handoff" className="font-serif text-xl font-medium">
          {m.workbench_unsupported_heading()}
        </h1>
        <p className="text-sm">{m.workbench_unsupported_lede()}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fd-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason.id}>{reason.message}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onDownload}>
            {m.workbench_unsupported_download()}
          </Button>
          <Button variant="outline" onClick={onImport}>
            {m.workbench_import()}
          </Button>
          {onUndo && (
            <Button variant="outline" onClick={onUndo}>
              {m.workbench_undo()}
            </Button>
          )}
          <a
            href="/docs/concepts/javascript-templates"
            className="text-sm text-fd-primary underline underline-offset-2"
          >
            {m.workbench_unsupported_docs()}
          </a>
        </div>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
