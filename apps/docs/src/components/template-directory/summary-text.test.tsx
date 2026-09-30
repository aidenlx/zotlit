import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SummaryText } from "./summary-text";

describe("an entry summary", () => {
  it("sets a name between backticks as code, without the backticks", () => {
    const html = renderToStaticMarkup(
      <SummaryText text="Seven properties: `venue`, `citekey`, and a link." />,
    );

    expect(html).not.toContain("`");
    expect(html).toMatch(/<code[^>]*>venue<\/code>/);
    expect(html).toMatch(/<code[^>]*>citekey<\/code>/);
  });

  it("leaves a summary without backticks as plain text", () => {
    expect(renderToStaticMarkup(<SummaryText text="Plain text." />)).toBe(
      "Plain text.",
    );
  });
});
