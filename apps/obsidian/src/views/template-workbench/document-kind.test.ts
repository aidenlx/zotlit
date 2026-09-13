import { describe, expect, it } from "vitest";

import { templateDocumentKind, templatePartialName } from "./document-kind";

const file = (path: string) => ({ path }) as never;

describe("templateDocumentKind", () => {
  it("names the Citation Template and a Shared Partial inside the folder", () => {
    expect(
      templateDocumentKind(file("templates/zotlit-citation.md"), "templates"),
    ).toBe("citation");
    expect(
      templateDocumentKind(
        file("templates/zotlit-partial.authors.md"),
        "templates",
      ),
    ).toBe("partial");
  });

  it("opens the same filename outside the folder with the Profile tabs", () => {
    // Nothing registers it, so a Partial editor would preview a template no
    // render can reach and offer a caller choice for calls that cannot exist.
    expect(
      templateDocumentKind(
        file("Notes/zotlit-partial.authors.md"),
        "templates",
      ),
    ).toBe("profile");
    expect(
      templateDocumentKind(
        file("templates/nested/zotlit-citation.md"),
        "templates",
      ),
    ).toBe("profile");
    expect(
      templatePartialName("Notes/zotlit-partial.authors.md", "templates"),
    ).toBeNull();
  });

  it("reads a vault-root template folder", () => {
    expect(templateDocumentKind(file("zotlit-citation.md"), "")).toBe(
      "citation",
    );
    expect(templatePartialName("zotlit-partial.authors.md", "")).toBe(
      "authors",
    );
    expect(templateDocumentKind(file("templates/zotlit-citation.md"), "")).toBe(
      "profile",
    );
  });

  it("opens the fileless Default Profile draft with the Profile tabs", () => {
    expect(templateDocumentKind(null, "templates")).toBe("profile");
  });
});
