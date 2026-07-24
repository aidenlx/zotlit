// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { postProcessComment } from "./comment-postprocess";

const render = (html: string): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = html;
  postProcessComment(el);
  return el;
};

describe("postProcessComment", () => {
  it("unwraps a tag anchor into plain text", () => {
    const el = render('<p><a href="#todo" class="tag">#todo</a></p>');
    expect(el.innerHTML).toBe("<p>#todo</p>");
  });

  it("keeps surrounding text and inline markup around the tag", () => {
    const el = render(
      '<p>see <a href="#todo" class="tag">#todo</a> and <em>this</em></p>',
    );
    expect(el.innerHTML).toBe("<p>see #todo and <em>this</em></p>");
  });

  it("unwraps every tag anchor, however deeply nested", () => {
    const el = render(
      '<ul><li><a href="#a" class="tag">#a</a></li>' +
        '<li><strong><a href="#b" class="tag">#b</a></strong></li></ul>',
    );
    expect(el.innerHTML).toBe(
      "<ul><li>#a</li><li><strong>#b</strong></li></ul>",
    );
  });

  it("leaves internal and external links untouched", () => {
    const html =
      '<p><a data-href="Note" href="Note" class="internal-link">Note</a>' +
      '<a href="https://example.com" class="external-link">site</a></p>';
    expect(render(html).innerHTML).toBe(html);
  });

  it("leaves a container with no tags untouched", () => {
    const html = "<h2>Title</h2><p>plain <code>code</code></p>";
    expect(render(html).innerHTML).toBe(html);
  });
});
