import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import annotationSchema from "./generated/annotation.schema.json";
import filenameSchema from "./generated/filename.schema.json";
import ir from "./generated/ir.json";
import noteSchema from "./generated/note.schema.json";
import { CONTRACT_VERSION, templateSlotsForRoot } from "./roots";

const schemas = {
  note: noteSchema,
  annotation: annotationSchema,
  filename: filenameSchema,
};

describe("contract artifacts", () => {
  it("extracts every root and stamps the shared contract version", () => {
    expect(ir.contractVersion).toBe(CONTRACT_VERSION);
    expect(ir.roots).toEqual({
      note: {
        type: "NoteTemplateContext",
        templates: templateSlotsForRoot("note"),
        references: [
          { owner: "TemplateAnnotation", member: "parentItem", path: "zt" },
        ],
      },
      annotation: {
        type: "AnnotationTemplateContext",
        templates: templateSlotsForRoot("annotation"),
        references: [],
      },
      filename: {
        type: "TemplateFilenameItemData",
        templates: templateSlotsForRoot("filename"),
        references: [],
      },
    });
    for (const [root, schema] of Object.entries(schemas)) {
      expect(schema.$id).toBe(
        `urn:zotlit:template-contract:v${CONTRACT_VERSION}:${root}`,
      );
    }
  });

  it("compiles every root as a draft 2020-12 schema", () => {
    const ajv = new Ajv2020({ strict: true });
    for (const schema of Object.values(schemas)) {
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });

  it("carries generated-file banners and resolved JSDoc links", () => {
    expect(ir.$comment).toMatch(/DO NOT EDIT/);
    for (const schema of Object.values(schemas)) {
      expect(JSON.stringify(schema)).not.toContain("{@link");
      expect(schema.$comment).toMatch(/DO NOT EDIT/);
    }
  });
});

describe("per-item-type fields", () => {
  const branches = filenameSchema.$defs.TemplateFilenameItemData.oneOf;
  const branch = (itemType: string) =>
    branches.find(
      (candidate) => candidate.properties.itemType.const === itemType,
    )!;

  it("emits one closed branch per regular upstream Zotero item type", () => {
    expect(branches).toHaveLength(Object.keys(ir.itemTypes).length);
    expect(
      filenameSchema.$defs.TemplateFilenameItemData.unevaluatedProperties,
    ).toBe(false);
    expect(
      branches.map(({ properties }) => properties.itemType.const),
    ).not.toContain("annotation");
  });

  it("discriminates branches on itemType and keeps fields type-specific", () => {
    expect(branch("journalArticle").properties.itemType).toMatchObject({
      const: "journalArticle",
    });
    expect(branch("journalArticle").properties).toHaveProperty(
      "journalAbbreviation",
    );
    expect(branch("bookSection").properties).not.toHaveProperty(
      "journalAbbreviation",
    );
  });

  it("applies Zotero base-field aliases and zt renames", () => {
    expect(ir.itemTypes.blogPost).not.toContain("blogTitle");
    expect(ir.itemTypes.blogPost).not.toContain("websiteType");
    expect(ir.itemTypes.blogPost).toEqual(
      expect.arrayContaining(["publicationTitle", "containerTitle", "type"]),
    );
  });
});

describe("serialized forms", () => {
  const properties = filenameSchema.$defs.TemplateFilenameItemData.properties;

  it("represents evaluated and inert helpers", () => {
    expect(properties.noteLink.oneOf[0]).toMatchObject({
      type: "object",
      properties: {
        $helper: { const: "noteLink" },
        signature: {
          const: "(alias?: string, subpath?: string) => string | null",
        },
        value: { type: ["string", "null"] },
      },
      required: ["$helper", "signature", "value"],
      additionalProperties: false,
    });
    expect(properties.noteLink.oneOf[1]).toEqual({
      type: "object",
      properties: { $inert: { type: "string" } },
      required: ["$inert"],
      additionalProperties: false,
    });
    expect(
      annotationSchema.$defs.AnnotationTemplateContext.properties.imgLink
        .anyOf![0]!.oneOf![0]!.properties.$helper,
    ).toEqual({ const: "imgLink" });
  });

  it("serializes Temporal values as strings and shared cycles as ref paths", () => {
    expect(properties.dateAdded).toMatchObject({ type: "string" });
    expect(noteSchema.$defs.TemplateAnnotation.properties.parentItem).toEqual({
      type: "object",
      properties: { $ref: { const: "zt" } },
      required: ["$ref"],
      additionalProperties: false,
    });
    expect(
      JSON.stringify(
        annotationSchema.$defs.AnnotationTemplateContext.properties.parentItem,
      ),
    ).not.toContain('"$ref":{"const":"zt"}');
  });

  it("drops the non-enumerable toString from every shape", () => {
    expect(JSON.stringify(filenameSchema.$defs)).not.toContain('"toString"');
  });
});

describe("annotation root schema", () => {
  const root = annotationSchema.$defs.AnnotationTemplateContext;

  it("includes the typed citation field", () => {
    expect(root.properties.citation).toMatchObject({
      type: ["string", "null"],
    });
    expect(root.required).toContain("citation");
  });

  it("literalizes every resolved annotation type", () => {
    expect(annotationSchema.$defs.ResolvedAnnotationTypeName.enum).toEqual([
      "unknown",
      "text",
      "highlight",
      "note",
      "image",
      "ink",
      "underline",
    ]);
  });
});
