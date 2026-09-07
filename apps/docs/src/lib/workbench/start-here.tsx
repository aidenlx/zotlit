// The three lines a reader meets the first time Obsidian opens this page in
// their browser: where the fields are, where the note is written, and where
// Save sends it. The strip is dismissed once and stays dismissed in that
// browser, so it never nags; a page opened standalone never carries it.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

/** Where this browser records that the strip has been read. */
const DISMISSED_KEY = "zotlit.workbench.start-here.dismissed";

export function StartHereStrip() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <section
      aria-label={m.workbench_start_here_heading()}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-s-2 border-b border-s-fd-primary border-b-fd-border bg-fd-accent/40 px-3 py-2 text-xs leading-normal"
    >
      <p className="font-semibold">{m.workbench_start_here_heading()}</p>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-pretty text-fd-muted-foreground">
        <li>{m.workbench_start_here_field()}</li>
        <li>{m.workbench_start_here_note()}</li>
        <li>{m.workbench_start_here_save()}</li>
      </ol>
      <Button
        variant="ghost"
        size="xs"
        className="ms-auto"
        onClick={() => {
          writeDismissed();
          setDismissed(true);
        }}
      >
        {m.workbench_start_here_dismiss()}
      </Button>
    </section>
  );
}

/** Whether this browser has already read the strip. */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    // A browser with site data blocked records no dismissal, so the strip
    // stands for this visit and leaves with it.
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // Nothing was recorded, so the next visit is offered the strip again.
  }
}
