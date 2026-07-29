import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import filenameSchema from "./generated/filename.schema.json";
import ir from "./generated/ir.json";
import { CONTRACT_VERSION, templateSlotsForRoot } from "./roots";

describe("contract IR", () => {
  it("stamps the contract version and the extracted roots", () => {
    expect(ir.contractVersion).toBe(CONTRACT_VERSION);
    expect(ir.roots.filename).toEqual({
      type: "TemplateFilenameItemData",
      templates: templateSlotsForRoot("filename"),
    });
  });

  it("carries a generated-file banner", () => {
    expect(ir.$comment).toMatch(/DO NOT EDIT/);
  });
});

describe("filename root schema", () => {
  const root = filenameSchema.$defs.TemplateFilenameItemData;
  const properties = root.properties;

  it("compiles as a draft 2020-12 schema", () => {
    const ajv = new Ajv2020({ strict: true });
    expect(() => ajv.compile(filenameSchema)).not.toThrow();
  });

  it("stamps the contract version in its identifier", () => {
    expect(filenameSchema.$id).toBe(
      `urn:zotlit:template-contract:v${CONTRACT_VERSION}:filename`,
    );
  });

  it("represents a function-valued member in its serialized marker form", () => {
    expect(properties.noteLink).toMatchObject({
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
  });

  it("serializes a Temporal value as its string form", () => {
    expect(properties.dateAdded).toMatchObject({ type: "string" });
  });

  it("keeps the item-field index signature open", () => {
    expect(root.additionalProperties).not.toBe(false);
  });

  it("drops the non-enumerable toString from every shape", () => {
    expect(JSON.stringify(filenameSchema.$defs)).not.toContain('"toString"');
  });

  it("resolves JSDoc link tags into plain prose", () => {
    expect(JSON.stringify(filenameSchema)).not.toContain("{@link");
    expect(properties.indexedKey.description).toBe(
      "`key` for the personal library, `KEYgGROUPID` for a group library.",
    );
  });
});
