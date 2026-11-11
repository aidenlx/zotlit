import { describe, expect, it } from "vitest";

import { pageHead } from "./seo";
import { docsArticleSchema, faqPageSchema } from "./structured-data";

describe("pageHead", () => {
  it("publishes each schema as its own JSON-LD script, in order, with `<` escaped", () => {
    const article = docsArticleSchema({
      title: "Compare </script> plugins",
      url: "/docs/answers/compare",
    });
    const faq = faqPageSchema({
      url: "/docs/answers/compare",
      entries: [{ question: "Which one?", answer: "This one." }],
    });

    const { scripts } = pageHead({
      title: "Compare plugins",
      path: "/docs/answers/compare",
      card: { type: "docs", alt: "Compare plugins" },
      schemas: [article, faq],
    });

    expect(scripts.map((script) => script.type)).toEqual([
      "application/ld+json",
      "application/ld+json",
    ]);
    expect(scripts[0]!.children).not.toContain("</script>");
    expect(scripts.map((script) => JSON.parse(script.children))).toEqual([
      article,
      faq,
    ]);
  });
});
