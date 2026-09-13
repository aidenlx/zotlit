import annotationEta from "@defaults/annotation.eta?raw";
import annotationLiquid from "@defaults/annotation.liquid?raw";
import citeLiquid from "@defaults/cite.liquid?raw";
import cite2Liquid from "@defaults/cite2.liquid?raw";
import contentEta from "@defaults/content.eta?raw";
import contentLiquid from "@defaults/content.liquid?raw";
import filenameEta from "@defaults/filename.eta?raw";
import filenameLiquid from "@defaults/filename.liquid?raw";
import noteEta from "@defaults/note.eta?raw";
import noteLiquid from "@defaults/note.liquid?raw";
import { describe, expect, it } from "vitest";

import { TemplateFacade } from "./facade";
import { managedRegionTransform, MARKER_END, MARKER_START } from "./obsidian";

const wrapContent = managedRegionTransform("content");

function defineLiquidDefaults(facade: TemplateFacade): void {
  facade.define("annotation", annotationLiquid, "liquid");
  facade.define("content", contentLiquid, "liquid");
  facade.define("note", noteLiquid, "liquid");
  facade.define("cite", citeLiquid, "liquid");
  facade.define("cite2", cite2Liquid, "liquid");
}

describe("Liquid default templates via the facade", () => {
  it("resolves includes by registered name", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationLiquid, "liquid");
    facade.define("content", contentLiquid, "liquid");

    const rendered = facade.render("content", {
      notes: [],
      annotations: [
        {
          pageLabel: "4",
          imgLink: null,
          text: "Highlighted text",
          comment: null,
        },
      ],
    });

    expect(rendered).toContain("Page 4");
    expect(rendered).toContain("Highlighted text");
  });

  it("renders a tight notes list under a heading", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationLiquid, "liquid");
    facade.define("content", contentLiquid, "liquid");

    const rendered = facade.render("content", {
      notes: [{ noteLink: () => "[[a|A]]" }, { noteLink: () => "[[b|B]]" }],
      annotations: [],
    });

    expect(rendered).toContain("## Notes");
    expect(rendered).toContain("- [[a|A]]\n- [[b|B]]");
    expect(rendered).not.toContain("## Annotations");
  });

  it("embeds the excerpt image via the embed filter when imgLink is present", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationLiquid, "liquid");

    const rendered = facade.render("annotation", {
      pageLabel: "5",
      imgLink: () => "[[ANNOT.png]]",
      text: "with image",
      comment: null,
    });

    expect(rendered).toContain("> ![[ANNOT.png]]with image");
  });

  it("keeps multi-line annotation text and comment inside the callout", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationLiquid, "liquid");

    const rendered = facade.render("annotation", {
      pageLabel: "5",
      imgLink: null,
      text: "first line\nsecond line",
      comment: "comment A\ncomment B",
    });

    expect(rendered).toBe(
      [
        "> [!note] Page 5",
        ">",
        "> first line",
        "> second line",
        ">",
        "> comment A",
        "> comment B",
        "",
      ].join("\n"),
    );
  });

  it("omits the comment block when comment is null (normalized empty)", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationLiquid, "liquid");

    const rendered = facade.render("annotation", {
      pageLabel: "5",
      imgLink: null,
      text: "only text",
      comment: null,
    });

    expect(rendered).toBe(
      ["> [!note] Page 5", ">", "> only text", ""].join("\n"),
    );
  });

  const noteContext = {
    title: "Paper",
    backlink: "zotero://select/items/1",
    attachments: [],
    annotations: [],
    notes: [],
  };

  it("wraps content includes in managed-region markers via transformRender", () => {
    const facade = new TemplateFacade({ transformRender: wrapContent });
    defineLiquidDefaults(facade);

    expect(facade.render("note", noteContext)).toContain(
      `${MARKER_START}\n\n${MARKER_END}`,
    );
  });

  it('wraps a direct render("content") identically to the include path', () => {
    const facade = new TemplateFacade({ transformRender: wrapContent });
    facade.define("annotation", annotationLiquid, "liquid");
    facade.define("content", contentLiquid, "liquid");

    expect(facade.render("content", { annotations: [], notes: [] })).toBe(
      `${MARKER_START}\n\n${MARKER_END}`,
    );
  });

  it("does not wrap content without a transformRender", () => {
    const facade = new TemplateFacade();
    defineLiquidDefaults(facade);

    expect(facade.render("note", noteContext)).not.toContain(MARKER_START);
  });

  it("changes the composed note/content output when annotation is redefined", () => {
    const facade = new TemplateFacade();
    defineLiquidDefaults(facade);

    const data = {
      ...noteContext,
      annotations: [
        { pageLabel: "1", imgLink: null, text: "hi", comment: null },
      ],
    };

    const before = facade.render("note", data);
    facade.define("annotation", "CUSTOM {{ zt.text }}", "liquid");
    const after = facade.render("note", data);

    expect(after).not.toBe(before);
    expect(after).toContain("CUSTOM hi");
  });

  it("drops attachments whose fileLink returns null from the attachments line", () => {
    const facade = new TemplateFacade();
    defineLiquidDefaults(facade);

    const rendered = facade.render("note", {
      title: "T",
      backlink: "zotero://x",
      notes: [],
      annotations: [],
      attachments: [
        { fileLink: () => "[paper.pdf](file:///paper.pdf)" },
        { fileLink: () => null },
        { fileLink: () => "[supp.pdf](file:///supp.pdf)" },
      ],
    });

    expect(rendered).toContain(
      "[Zotero](zotero://x) [paper.pdf](file:///paper.pdf) [supp.pdf](file:///supp.pdf)",
    );
  });
});

/**
 * Both defaults' bq/annotation output funnels through the shared, pure
 * `formatBlockquote` helper — so pinning the pre-formatting captured text to
 * match line-for-line makes the final render byte-identical too.
 */
describe("Liquid defaults match Eta defaults byte-for-byte", () => {
  function annotationFacades(): {
    eta: TemplateFacade;
    liquid: TemplateFacade;
  } {
    const eta = new TemplateFacade();
    eta.define("annotation", annotationEta, "eta");
    const liquid = new TemplateFacade();
    liquid.define("annotation", annotationLiquid, "liquid");
    return { eta, liquid };
  }

  const annotationFixtures = [
    [
      "no comment",
      { pageLabel: "5", imgLink: null, text: "only text", comment: null },
    ],
    [
      "multi-line text and comment",
      {
        pageLabel: "5",
        imgLink: null,
        text: "first line\nsecond line",
        comment: "comment A\ncomment B",
      },
    ],
    [
      "with image",
      {
        pageLabel: "5",
        imgLink: () => "[[ANNOT.png]]",
        text: "with image",
        comment: null,
      },
    ],
    [
      "different pageLabel with single-line comment",
      {
        pageLabel: "12",
        imgLink: null,
        text: "text",
        comment: "single comment",
      },
    ],
  ] as const;

  it.each(annotationFixtures)("annotation: %s", (_label, fixture) => {
    const { eta, liquid } = annotationFacades();

    expect(liquid.render("annotation", fixture)).toBe(
      eta.render("annotation", fixture),
    );
  });

  it("content: renders equivalent output for notes and annotations", () => {
    const eta = new TemplateFacade();
    eta.define("annotation", annotationEta, "eta");
    eta.define("content", contentEta, "eta");
    const liquid = new TemplateFacade();
    liquid.define("annotation", annotationLiquid, "liquid");
    liquid.define("content", contentLiquid, "liquid");

    const data = {
      notes: [{ noteLink: () => "[[a|A]]" }, { noteLink: () => "[[b|B]]" }],
      annotations: [
        {
          pageLabel: "4",
          imgLink: null,
          text: "Highlighted text",
          comment: null,
        },
      ],
    };

    const etaOut = eta.render("content", data);
    const liquidOut = liquid.render("content", data);

    for (const needle of [
      "## Notes",
      "- [[a|A]]\n- [[b|B]]",
      "## Annotations",
      "Page 4",
      "Highlighted text",
    ]) {
      expect(etaOut).toContain(needle);
      expect(liquidOut).toContain(needle);
    }
  });

  it("note: renders identically to the Eta default across the include chain", () => {
    const eta = new TemplateFacade();
    eta.define("annotation", annotationEta, "eta");
    eta.define("content", contentEta, "eta");
    eta.define("note", noteEta, "eta");
    const liquid = new TemplateFacade();
    liquid.define("annotation", annotationLiquid, "liquid");
    liquid.define("content", contentLiquid, "liquid");
    liquid.define("note", noteLiquid, "liquid");

    const data = {
      title: "A Study of Templates",
      backlink: "zotero://select/library/items/ABCD1234",
      attachments: [
        { fileLink: () => "[paper.pdf](file:///paper.pdf)" },
        { fileLink: () => null },
      ],
      notes: [{ noteLink: () => "[[Imported child note]]" }],
      annotations: [
        {
          pageLabel: "42",
          imgLink: null,
          text: "The highlighted text",
          comment: null,
        },
        {
          pageLabel: "57",
          imgLink: () => "[[ANNOT.png]]",
          text: "Second highlight",
          comment: "My thoughts",
        },
      ],
    };

    expect(liquid.render("note", data)).toBe(eta.render("note", data));
  });

  it('eta renders a normalized null field identically to the old "" value', () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotationEta, "eta");
    const base = { pageLabel: "5", imgLink: null, text: "only text" };

    expect(facade.render("annotation", { ...base, comment: null })).toBe(
      facade.render("annotation", { ...base, comment: "" }),
    );
  });

  const filenameFixtures = [
    [
      "citationKey wins",
      {
        citationKey: "smith2024",
        DOI: "10.1/x",
        title: "Paper",
        key: "ABCD1234",
      },
    ],
    [
      "DOI when no citationKey",
      { citationKey: null, DOI: "10.1/x", title: "Paper", key: "ABCD1234" },
    ],
    [
      "title when no citationKey/DOI",
      { citationKey: null, DOI: null, title: "Paper", key: "ABCD1234" },
    ],
    [
      "key as last resort",
      { citationKey: null, DOI: null, title: null, key: "ABCD1234" },
    ],
  ] as const;

  it.each(filenameFixtures)("filename: %s", (_label, fixture) => {
    const eta = new TemplateFacade();
    eta.define("filename", filenameEta, "eta");
    const liquid = new TemplateFacade();
    liquid.define("filename", filenameLiquid, "liquid");

    expect(liquid.render("filename", fixture)).toBe(
      eta.render("filename", fixture),
    );
  });
});

describe("Liquid filename default", () => {
  it("prefers citationKey, DOI, then title over the item key", () => {
    const facade = new TemplateFacade();
    facade.define("filename", filenameLiquid, "liquid");

    const rendered = facade.render("filename", {
      citationKey: "smith2024",
      DOI: null,
      title: "Paper",
      key: "ABCD1234",
    });

    expect(rendered.trim()).toBe("smith2024%zt-suffix:6:_:%");
  });

  it("falls back to the item key when citationKey, DOI, and title are all null", () => {
    const facade = new TemplateFacade();
    facade.define("filename", filenameLiquid, "liquid");

    const rendered = facade.render("filename", {
      citationKey: null,
      DOI: null,
      title: null,
      key: "ABCD1234",
    });

    expect(rendered.trim()).toBe("ABCD1234%zt-suffix:6:_:%");
  });
});
