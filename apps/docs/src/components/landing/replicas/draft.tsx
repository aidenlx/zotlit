// The draft "Chapter 3 - Presenting the results" in Live Preview, its
// citations rendered as ZotLit renders them away from the cursor (the
// `zt-citation` widget, apps/obsidian/src/services/citekey-editor/), shared by
// the connections and export replicas.

import { cn } from "@/lib/cn";

import { DRAFT, DRAFT_TEXT, chicagoCite, paper } from "./papers";

export function DraftBody({
  active,
  plain = false,
  className,
}: {
  /** The citation key the reader is stepping through, marked in the text. */
  active?: string | null;
  /** Citations in the text colour, as an exported document prints them. */
  plain?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid content-start gap-3 text-[14px] leading-relaxed",
        className,
      )}
    >
      <p className="font-serif text-[20px] leading-snug font-medium">{DRAFT}</p>
      {DRAFT_TEXT.map((para, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- a fixed draft
        <p key={i}>
          {para.map((run, k) =>
            typeof run === "string" ? (
              run
            ) : (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- a fixed draft
                key={k}
                className={cn(
                  "rounded-sm transition-[background-color] duration-150 ease-out",
                  !plain && "text-(--zt-cite)",
                  active === run.key && "bg-fd-accent",
                )}
              >
                {chicagoCite(paper(run.key), run.page)}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
