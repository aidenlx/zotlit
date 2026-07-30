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

  it("represents an evaluated helper with no inert branch when the schema marks it non-inert-capable", () => {
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
    // TemplateFilenameItemData.noteLink carries no @ztInert tag.
    expect(properties.noteLink.oneOf).toHaveLength(1);
  });

  it("appends the inert branch only for an inert-capable helper", () => {
    const noteLinkOnNoteLink =
      noteSchema.$defs.TemplateNoteLink.properties.noteLink;
    expect(noteLinkOnNoteLink.oneOf).toHaveLength(2);
    expect(noteLinkOnNoteLink.oneOf[1]).toEqual({
      type: "object",
      properties: { $inert: { type: "string" } },
      required: ["$inert"],
      additionalProperties: false,
    });
    expect(
      annotationSchema.$defs.AnnotationTemplateContext.properties.imgLink
        .anyOf![0]!.oneOf![0]!.properties.$helper,
    ).toEqual({ const: "imgLink" });
    expect(
      annotationSchema.$defs.AnnotationTemplateContext.properties.imgLink
        .anyOf![0]!.oneOf,
    ).toHaveLength(2);
  });

  it("serializes Temporal values as strings and shared cycles as ref-marker unions", () => {
    expect(properties.dateAdded).toMatchObject({ type: "string" });
    const parentItem = noteSchema.$defs.TemplateAnnotation.properties
      .parentItem as { oneOf: unknown[]; description: string };
    expect(parentItem.oneOf).toEqual([
      {
        type: "object",
        properties: { $ref: { const: "zt" } },
        required: ["$ref"],
        additionalProperties: false,
      },
      { type: "null" },
    ]);
    expect(parentItem.description).toMatch(/\S/);
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

describe("inert precision", () => {
  interface HelperLike {
    kind: string;
    inert?: boolean;
    options?: HelperLike[];
  }
  interface ObjectLike {
    kind: string;
    members?: { name: string; type: HelperLike }[];
  }

  /** Every (owner, member) helper occurrence in the IR, with whether it carries `inert`. */
  function helperOccurrences(): {
    owner: string;
    member: string;
    inert: boolean;
  }[] {
    const results: { owner: string; member: string; inert: boolean }[] = [];
    for (const [owner, type] of Object.entries(ir.types) as [
      string,
      ObjectLike,
    ][]) {
      if (type.kind !== "object") continue;
      for (const member of type.members ?? []) {
        const memberType = member.type;
        const helper =
          memberType.kind === "helper"
            ? memberType
            : memberType.options?.find((option) => option.kind === "helper");
        if (helper) {
          results.push({
            owner,
            member: member.name,
            inert: helper.inert === true,
          });
        }
      }
    }
    return results;
  }

  /** The `oneOf` array holding a helper's evaluated (and maybe inert) branches. */
  function findHelperOneOf(node: unknown): unknown[] | undefined {
    if (!node || typeof node !== "object") return undefined;
    const record = node as { oneOf?: unknown[] };
    if (
      Array.isArray(record.oneOf) &&
      typeof record.oneOf[0] === "object" &&
      record.oneOf[0] !== null &&
      "properties" in record.oneOf[0] &&
      (record.oneOf[0] as { properties?: { $helper?: unknown } }).properties
        ?.$helper
    ) {
      return record.oneOf;
    }
    for (const value of Object.values(node)) {
      const found = findHelperOneOf(value);
      if (found) return found;
    }
    return undefined;
  }

  it("carries the inert branch on exactly the tagged helpers, in every schema that reaches them", () => {
    for (const { owner, member, inert } of helperOccurrences()) {
      for (const schema of Object.values(schemas)) {
        const ownerDef = (schema.$defs as Record<string, JsonSchemaObject>)[
          owner
        ];
        if (!ownerDef) continue;
        const memberNode = (ownerDef.properties as Record<string, unknown>)[
          member
        ];
        const oneOf = findHelperOneOf(memberNode);
        expect(
          oneOf,
          `${owner}.${member} in ${String(schema.$id)}`,
        ).toBeDefined();
        expect(
          oneOf!.length,
          `${owner}.${member} in ${String(schema.$id)}`,
        ).toBe(inert ? 2 : 1);
      }
    }
  });
});

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

describe("no orphan $defs", () => {
  it("references every $defs key from elsewhere in the document", () => {
    for (const schema of Object.values(schemas)) {
      const defs = schema.$defs as Record<string, unknown>;
      for (const name of Object.keys(defs)) {
        // Exclude the def's own subtree so a self-reference can't count as
        // its own referrer — only the top-level `$ref` or another `$defs`
        // entry proves this def is actually reached.
        const { [name]: _own, ...otherDefs } = defs;
        const text = JSON.stringify({ ...schema, $defs: otherDefs });
        const refToken = `"#/$defs/${name}"`;
        const occurrences = text.split(refToken).length - 1;
        expect(occurrences, `${String(schema.$id)}: ${name}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("drops TemplateParentItemData from the note schema's $defs", () => {
    expect(noteSchema.$defs).not.toHaveProperty("TemplateParentItemData");
  });
});

describe("item-fields index-signature prose", () => {
  const owners = [
    "NoteTemplateContext",
    "TemplateParentItemData",
    "TemplateRelatedItem",
    "TemplateFilenameItemData",
  ];

  it("keeps the prose on the IR's additional.description", () => {
    for (const owner of owners) {
      const type = ir.types[owner as keyof typeof ir.types] as {
        additional?: { description?: string };
      };
      expect(type.additional?.description, owner).toMatch(
        /Item-type-specific Zotero fields beyond the typed ones above/,
      );
    }
  });

  it("folds the prose into the owning $defs entry's top-level description", () => {
    for (const [root, schema] of Object.entries(schemas)) {
      for (const owner of owners) {
        const def = (schema.$defs as Record<string, JsonSchemaObject>)[owner];
        if (!def) continue;
        expect(def.description, `${owner} in ${root}`).toMatch(
          /Item-type-specific Zotero fields beyond the typed ones above/,
        );
      }
    }
  });
});

describe("docs data", () => {
  const nodes = [...walkIR(ir)];

  it("names the Liquid filter of every helper", () => {
    const helpers = nodes.filter((node) => node.kind === "helper");
    expect(helpers.length).toBeGreaterThan(0);
    for (const helper of helpers) {
      expect(helper.filter, `helper ${String(helper.name)}`).toBeTypeOf(
        "string",
      );
    }
    expect([
      ...new Set(
        helpers.map(
          (helper) => `${String(helper.name)}/${String(helper.filter)}`,
        ),
      ),
    ]).toEqual(
      expect.arrayContaining([
        "noteLink/note_link",
        "fileLink/file_link",
        "imgLink/img_link",
      ]),
    );
  });

  it("carries every @example block as a structured example", () => {
    const documented = nodes.filter((node) => node.examples !== undefined);
    expect(documented.length).toBeGreaterThan(0);
    for (const node of documented) {
      expect(node.examples, `member ${String(node.name)}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: expect.any(String) }),
        ]),
      );
    }
    expect(
      documented.find((node) => node.name === "dateAdded")?.examples,
    ).toEqual([
      { lang: "liquid", code: '{{ zt.dateAdded | date: "%Y-%m-%d" }}' },
    ]);
  });

  it("describes the annotation shape", () => {
    expect(ir.types.TemplateAnnotation.description).toBeTypeOf("string");
  });

  it("keeps doc-tag text out of descriptions", () => {
    for (const node of nodes) {
      if (typeof node.description !== "string") continue;
      expect(node.description).not.toMatch(/@example|@ztFilter/);
    }
  });

  it("keeps docs-only fields out of the JSON Schemas", () => {
    for (const schema of Object.values(schemas)) {
      expect(JSON.stringify(schema)).not.toMatch(/"(examples|filter)":/);
    }
  });
});

/** Every object node of the IR, so one assertion can hold across the whole tree. */
function* walkIR(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkIR(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  yield value as Record<string, unknown>;
  for (const child of Object.values(value)) yield* walkIR(child);
}

describe("annotation root schema", () => {
  const root = annotationSchema.$defs.AnnotationTemplateContext;

  it("includes the typed citation field", () => {
    expect(root.properties.citation).toMatchObject({
      type: ["string", "null"],
    });
    expect(root.required).toContain("citation");
  });

  it("literalizes every resolved annotation type, documented and in declaration order", () => {
    const options = annotationSchema.$defs.ResolvedAnnotationTypeName.oneOf;
    expect(options.map(({ const: value }) => value)).toEqual([
      "highlight",
      "note",
      "image",
      "ink",
      "underline",
      "text",
      "unknown",
    ]);
    for (const option of options) {
      expect(option.description).toMatch(/\S/);
    }
  });
});
