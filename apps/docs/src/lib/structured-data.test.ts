import { describe, expect, it } from "vitest";

import { docsArticleSchema, faqPageSchema } from "./structured-data";

const publisher = {
  "@type": "Organization",
  name: "ZotLit",
  url: "https://zotlit.aidenlx.site",
  logo: "https://zotlit.aidenlx.site/logo/zotlit-logo-512.png",
  sameAs: [
    "https://github.com/aidenlx/zotlit",
    "https://community.obsidian.md/plugins/zotlit",
  ],
};

// schema.org: TechArticle is an Article; headline, description and
// dateModified are CreativeWork properties, and dateModified takes an ISO
// Date. Google reads `mainEntityOfPage` to tie the article to its page.
describe("docsArticleSchema", () => {
  it("names the page's canonical URL, headline, description and last-commit day", () => {
    expect(
      docsArticleSchema({
        title: "Insert citations",
        description: "Insert Markdown citations while typing.",
        modified: "2026-11-09",
        url: "/docs/how-to/insert-citations",
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "Insert citations",
      description: "Insert Markdown citations while typing.",
      dateModified: "2026-11-09",
      inLanguage: "en",
      publisher,
      url: "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
      mainEntityOfPage:
        "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
    });
  });

  it("leaves out the fields a page does not have", () => {
    const schema = docsArticleSchema({ title: "Docs", url: "/docs" });
    expect(schema).not.toHaveProperty("description");
    expect(schema).not.toHaveProperty("dateModified");
  });
});

// schema.org: FAQPage.mainEntity holds Questions; each Question's `name` is
// the question and its `acceptedAnswer` an Answer whose `text` is the answer.
describe("faqPageSchema", () => {
  it("publishes each question with its accepted answer, in page order", () => {
    expect(
      faqPageSchema({
        url: "/docs/answers/zotero-and-obsidian-versions",
        entries: [
          { question: "Does ZotLit work with Zotero 8?", answer: "No." },
          { question: "Does ZotLit work with Zotero closed?", answer: "Yes." },
        ],
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: "https://zotlit.aidenlx.site/docs/answers/zotero-and-obsidian-versions",
      mainEntity: [
        {
          "@type": "Question",
          name: "Does ZotLit work with Zotero 8?",
          acceptedAnswer: { "@type": "Answer", text: "No." },
        },
        {
          "@type": "Question",
          name: "Does ZotLit work with Zotero closed?",
          acceptedAnswer: { "@type": "Answer", text: "Yes." },
        },
      ],
    });
  });
});
