// The changelog's companion-release aside: a leading accent add-on mark on a
// muted italic line, shared by the release list and the release detail page.
import { Puzzle } from "lucide-react";

export interface CompanionNoteProps {
  /** Companion version released alongside this plugin version. */
  version: string;
}

/**
 * Notes the Zotero companion version that shipped with a release. Companion
 * releases have no changelog entry of their own, so this line is where the
 * reader learns one happened.
 */
export function CompanionNote({ version }: CompanionNoteProps) {
  return (
    <p className="text-[14.5px] text-fd-muted-foreground italic">
      <Puzzle
        aria-hidden
        className="mr-[0.2em] inline size-[1em] shrink-0 align-[-0.14em] text-fd-primary select-none"
      />
      Companion {version} released alongside.
    </p>
  );
}
