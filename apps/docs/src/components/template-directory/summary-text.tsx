// An entry's one-line summary, with the property names it puts between backticks set as code.

import { Fragment } from "react";

export function SummaryText({ text }: { text: string }) {
  // Split on the backticks: the odd segments sit between a pair of them.
  return text.split("`").map((segment, index) =>
    index % 2 === 1 ? (
      <code key={index} className="font-mono text-[0.9em] not-italic">
        {segment}
      </code>
    ) : (
      <Fragment key={index}>{segment}</Fragment>
    ),
  );
}
