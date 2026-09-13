import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Message } from "./message";

describe("Message", () => {
  it("renders reordered and repeated slots while escaping translated text", () => {
    const markup = renderToStaticMarkup(
      <Message
        text="{date} <updated> {link} {date}"
        slots={{
          link: <a href="/docs">Read docs</a>,
          date: <time dateTime="2026-09-06">September 6</time>,
        }}
      />,
    );

    expect(markup).toBe(
      '<time dateTime="2026-09-06">September 6</time> &lt;updated&gt; <a href="/docs">Read docs</a> <time dateTime="2026-09-06">September 6</time>',
    );
  });
});
