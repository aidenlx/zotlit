// A Profile page's color key: what each Zotero highlight color means in the notes the Profile makes.

import type { ColorKey } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

import { EntryLink } from "./entry-list";
import { colorKeyText } from "./labels";

/**
 * One swatch and one line for each color, in a grid that fits two columns
 * beside the steps and one on a phone. The swatch carries a border in the
 * text color, so a pale color stays visible in the dark theme and a dark one
 * in the light theme; the line names the color in words.
 */
export function ColorKeyList({ colorKey }: { colorKey: ColorKey }) {
  const { rows, changeWith } = colorKey;
  return (
    <section aria-labelledby="color-key" className="flex flex-col gap-3">
      <h2
        id="color-key"
        className="font-mono text-[0.72rem] font-semibold tracking-[0.1em] text-fd-muted-foreground uppercase"
      >
        {m.docs_directory_color_key_heading()}
      </h2>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.color ?? "other"} className="flex items-start gap-2">
            <span
              aria-hidden
              className={
                row.hex === null
                  ? "mt-[3px] size-3.5 shrink-0 border border-dashed border-fd-foreground/50"
                  : "mt-[3px] size-3.5 shrink-0 border border-fd-foreground/40"
              }
              style={
                row.hex === null ? undefined : { backgroundColor: row.hex }
              }
            />
            {colorKeyText(row)}
          </li>
        ))}
      </ul>
      {changeWith !== null && (
        <p className="text-sm">
          <EntryLink
            id={changeWith}
            className="text-fd-primary underline underline-offset-2"
          >
            {m.docs_directory_color_key_change()}
          </EntryLink>
        </p>
      )}
    </section>
  );
}
