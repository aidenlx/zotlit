// "Copy citation" renders an Annotation's page-pinned citation from one ZoteroReads read.
import { describe, expect, it, vi } from "vitest";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { inlineCitation } from "@zotlit/templates";
import defaultCitation from "@zotlit/templates/defaults/citation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";

import type { TemplateService } from "@/services/template/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { renderAnnotationCitation } from "./annotation-citation";

/**
 * A journal article with the citation key `Hensher2011` (or none) and an
 * attachment that holds one highlight on page 62, in the personal library.
 */
function seed(citekey: string | null) {
  return `
    insert into version (schema, version) values ('userdata', 129);
    insert into libraries (libraryID, type, version) values (1, 'user', 0);
    insert into itemTypes (itemTypeID, typeName)
      values (1, 'journalArticle'), (2, 'attachment'), (4, 'annotation');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (11, 'citationKey', 0);
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
        (2, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
        (3, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2345');
    insert into itemDataValues (valueID, value)
      values (1, 'Travel demand'), (2, '${citekey ?? ""}');
    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 1)${citekey === null ? "" : ", (1, 11, 2)"};
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
    insert into itemAnnotations (
      itemID, parentItemID, type, text, color, pageLabel, sortIndex, position
    )
      values (3, 2, 1, 'excerpt', '#ffd400', '62', '00000|000000|00000',
        '{"pageIndex":61,"rects":[[0,0,1,1]]}');
  `;
}

function citationTemplate(
  source = defaultCitation,
  language: TemplateLanguage = "liquid",
): Pick<TemplateService, "ready" | "renderCitation"> {
  const facade = new TemplateFacade();
  facade.define("citation", source, language);
  return {
    ready: Promise.resolve(),
    renderCitation: (refs, variant) =>
      inlineCitation(
        facade.render("citation", citekeysToCiteTemplateData(refs, variant)),
      ),
  };
}

async function render(
  annotationKey: string,
  options: {
    citekey?: string | null;
    template?: Pick<TemplateService, "ready" | "renderCitation">;
  } = {},
) {
  await using stack = new AsyncDisposableStack();
  const client = stack.adopt(createClient(":memory:"), (db) =>
    db.$client.close(),
  );
  createFixtureSchema(client.$client);
  client.$client.exec(
    seed(options.citekey === undefined ? "Hensher2011" : options.citekey),
  );
  const zoteroReads = stack.use(
    inProcessReadsService(sharedClientOpener(client)),
  );
  return await renderAnnotationCitation(
    {
      template: options.template ?? citationTemplate(),
      profile: { ready: Promise.resolve() },
      zoteroReads,
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    },
    annotationKey,
  );
}

describe("renderAnnotationCitation", () => {
  it("produces a page-pinned Pandoc cite from the parent item and page label", async () => {
    expect(await render("ANNT2345")).toEqual({
      kind: "citation",
      text: expect.stringContaining("[@Hensher2011, {p. 62}]"),
    });
  });

  it("routes the citation through the user's Citation Template with the page as locator", async () => {
    const template = citationTemplate(
      "<%= zt.citations.map(c => `{{${c.item.citationKey}|${c.locator}}}`).join('') %>",
      "eta",
    );
    const renderCitation = vi.spyOn(template, "renderCitation");

    expect(await render("ANNT2345", { template })).toEqual({
      kind: "citation",
      text: expect.stringContaining("{{Hensher2011|62}}"),
    });
    expect(renderCitation).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          citationKey: "Hensher2011",
          label: "page",
          locator: "62",
        }),
      ],
      "main",
    );
  });

  it("answers no citation key when the parent item has none", async () => {
    expect(await render("ANNT2345", { citekey: null })).toEqual({
      kind: "no-citation-key",
    });
  });

  it("answers not in the database for an Annotation the database does not hold", async () => {
    expect(await render("MISS2345")).toEqual({ kind: "not-in-database" });
  });
});
