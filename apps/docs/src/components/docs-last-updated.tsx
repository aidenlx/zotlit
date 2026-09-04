import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * The `Last updated on <day>` line under a docs page body, from the file's
 * last commit date. The server renders the ISO day, so the prerendered HTML
 * carries the date and hydration sees the same text; after mount the visible
 * text switches to the viewer's locale format. `dateTime` keeps the ISO day
 * throughout, so the value stays machine-readable.
 */
export function DocsLastUpdated({
  date,
  className,
}: {
  date?: Date;
  className?: string;
}) {
  const day = date?.toISOString().slice(0, 10);
  // Starts as the ISO day on both sides, so hydration matches the server HTML.
  const [label, setLabel] = useState(day);
  useEffect(() => {
    // Format in UTC so the visible day is the same calendar day as `dateTime`
    // in every viewer time zone.
    if (date) setLabel(date.toLocaleDateString(undefined, { timeZone: "UTC" }));
  }, [date]);
  if (!day) return null;
  return (
    <p className={cn("text-sm text-fd-muted-foreground", className)}>
      Last updated on{" "}
      <time dateTime={day} className="whitespace-nowrap">
        {label}
      </time>
    </p>
  );
}
