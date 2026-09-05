import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DocsImage } from "./docs-image";

const imageProps = {
  src: "/img/changelog/wikilink-citation-runs.webp",
  width: 3512,
  height: 2228,
  alt: "Citations rendered as links",
  sizes: "(max-width: 768px) 100vw, 900px",
  className: "rounded-lg",
};

describe("DocsImage", () => {
  it("serves the original public image during development", () => {
    vi.stubEnv("DEV", true);

    const markup = renderToStaticMarkup(<DocsImage {...imageProps} />);

    expect(markup).toContain(
      'src="/img/changelog/wikilink-citation-runs.webp"',
    );
    expect(markup).toContain(
      'srcSet="/img/changelog/wikilink-citation-runs.webp 3512w"',
    );
    expect(markup).not.toContain("/cdn-cgi/image/");
    expect(markup).toContain('class="rounded-lg"');
  });

  it("serves bounded Cloudflare variants when deployed", () => {
    vi.stubEnv("DEV", false);

    const markup = renderToStaticMarkup(<DocsImage {...imageProps} />);

    expect(markup).toContain("/cdn-cgi/image/");
    expect(markup).toContain("f=auto");
    expect(markup).toContain("fit=scale-down");
    expect(markup).toContain("onerror=redirect");
    for (const width of [480, 768, 960, 1280, 1600, 1920]) {
      expect(markup).toContain(`${width}w`);
    }
    expect(markup).not.toContain("2048w");
    expect(markup).not.toContain("width=3512");
    expect(markup).toContain("width=1920,height=1218");
    expect(markup).toContain(
      "background-image:url(/cdn-cgi/image/width=24,height=15,f=auto,fit=cover/img/changelog/wikilink-citation-runs.webp)",
    );
    expect(markup).toContain('sizes="(max-width: 768px) 100vw, 900px"');
    expect(markup).toContain('class="rounded-lg"');
  });
});
