// The title and the one-line summary that open every entry page, set in the page's serif.

import { SummaryText } from "./summary-text";

export function EntryHeading({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <>
      <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
        {title}
      </h1>
      <p className="max-w-[60ch] text-lg text-pretty text-fd-muted-foreground italic">
        <SummaryText text={summary} />
      </p>
    </>
  );
}
