import { describe, expect, it } from "vitest";

import {
  docsArticleSchema,
  faqPageSchema,
  lessonArticleSchema,
} from "./structured-data";

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

// schema.org: TechArticle is an Article; headline, description,
// datePublished, dateModified, author and image are CreativeWork properties,
// and the dates take an ISO Date. Google reads `mainEntityOfPage` to tie the
// article to its page, and lists datePublished, author and image among an
// Article's recommended properties.
describe("docsArticleSchema", () => {
  it("names the page's canonical URL, headline, description, card, author and its first and last commit days", () => {
    expect(
      docsArticleSchema({
        title: "Insert citations",
        description: "Insert Markdown citations while typing.",
        published: "2026-07-19",
        modified: "2026-11-09",
        url: "/docs/how-to/insert-citations",
        image: "/og/docs/how-to/insert-citations.webp",
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "Insert citations",
      description: "Insert Markdown citations while typing.",
      datePublished: "2026-07-19",
      dateModified: "2026-11-09",
      inLanguage: "en",
      author: publisher,
      publisher,
      url: "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
      mainEntityOfPage:
        "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
      image: "https://zotlit.aidenlx.site/og/docs/how-to/insert-citations.webp",
    });
  });

  it("leaves out the fields a page does not have", () => {
    const schema = docsArticleSchema({
      title: "Docs",
      url: "/docs",
      image: "/og/docs.webp",
    });
    expect(schema).not.toHaveProperty("description");
    expect(schema).not.toHaveProperty("datePublished");
    expect(schema).not.toHaveProperty("dateModified");
  });
});

describe("lessonArticleSchema", () => {
  it("names the lesson's author and its first and last commit days", () => {
    expect(
      lessonArticleSchema({
        title: "Cite Zotero sources as you write in Obsidian",
        description: "Type [@ and pick a paper.",
        published: "2026-10-02",
        modified: "2026-11-12",
        url: "/learn/cite-in-obsidian-with-zotero",
        image: "/og/learn/cite-in-obsidian-with-zotero.webp",
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Cite Zotero sources as you write in Obsidian",
      description: "Type [@ and pick a paper.",
      datePublished: "2026-10-02",
      dateModified: "2026-11-12",
      author: publisher,
      publisher,
      url: "https://zotlit.aidenlx.site/learn/cite-in-obsidian-with-zotero",
      image:
        "https://zotlit.aidenlx.site/og/learn/cite-in-obsidian-with-zotero.webp",
    });
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
