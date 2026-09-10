import { describe, expect, it } from "vitest";

import {
  formatPlainTemplateDocument,
  parsePlainTemplateDocument,
} from "./facade";
import type { PlainTemplateDocumentError } from "./facade";

describe("plain Template Document", () => {
  it("reads a document with no manifest as Liquid source", () => {
    const source = "{{ zt.authors | join: ', ' }}\n";
    const document = parsePlainTemplateDocument(source);

    expect(document).toEqual({
      manifest: { language: "liquid" },
      source,
      sourceStart: 0,
    });
  });

  it("reads the language from the manifest and keeps the source below it", () => {
    const source = "---\nlanguage: eta\n---\n<%= zt.title %>\n";
    const document = parsePlainTemplateDocument(source);

    expect(document.manifest.language).toBe("eta");
    expect(document.source).toBe("<%= zt.title %>\n");
    expect(source.slice(document.sourceStart)).toBe(document.source);
  });

  it("keeps a leading '---' line inside the source as its own template text", () => {
    const source = "---\n---\n---\nA horizontal rule above {{ zt.title }}\n";
    const document = parsePlainTemplateDocument(source);

    expect(document.manifest.language).toBe("liquid");
    expect(document.source).toBe(
      "---\nA horizontal rule above {{ zt.title }}\n",
    );
  });

  it("refuses a manifest key beyond the language", () => {
    expect(() =>
      parsePlainTemplateDocument(
        "---\nlanguage: liquid\nname: Authors\n---\nA",
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PlainTemplateDocumentError>>({
        code: "invalid-manifest",
        recovery: expect.any(String),
      }),
    );
  });

  it("refuses a language the engines do not have", () => {
    expect(() =>
      parsePlainTemplateDocument("---\nlanguage: handlebars\n---\nA"),
    ).toThrowError(
      expect.objectContaining<Partial<PlainTemplateDocumentError>>({
        code: "invalid-manifest",
      }),
    );
  });

  it("refuses a manifest with no closing fence", () => {
    const source = "---\nlanguage: eta\n";

    expect(() => parsePlainTemplateDocument(source)).toThrowError(
      expect.objectContaining<Partial<PlainTemplateDocumentError>>({
        code: "invalid-document",
        offset: source.length,
      }),
    );
  });
});

describe("formatPlainTemplateDocument", () => {
  it("writes the manifest that names the language", () => {
    expect(formatPlainTemplateDocument("{{ zt.title }}\n", "liquid")).toBe(
      "---\nlanguage: liquid\n---\n{{ zt.title }}\n",
    );
  });

  it("round-trips a source that opens with its own '---' line", () => {
    const source = "---\ntitle: {{ zt.title }}\n---\n";
    const document = parsePlainTemplateDocument(
      formatPlainTemplateDocument(source, "eta"),
    );

    expect(document.manifest.language).toBe("eta");
    expect(document.source).toBe(source);
  });
});
