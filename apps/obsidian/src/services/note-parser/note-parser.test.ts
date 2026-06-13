// @vitest-environment happy-dom
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";

import { parseNote } from "./index";

const deps = { Turndown: TurndownService };
const ATTACHMENT = "http://zotero.org/users/local/BOtEiq6p/items/T2P8T29G";

/** Wrap body HTML in the schema container `parseNote` gates on. */
function note(body: string, version = 10): string {
  return `<div data-schema-version="${version}">${body}</div>`;
}

/** A `data-annotation` excerpt span carrying the URL-encoded payload. */
function annot(
  className: string,
  payload: Record<string, unknown>,
  text: string,
): string {
  const attr = encodeURIComponent(JSON.stringify(payload));
  return `<span class="${className}" data-annotation="${attr}">${text}</span>`;
}

describe("schema gate", () => {
  it("returns the legacy callout for a pre-v6 note", () => {
    const md = parseNote(deps, note("<p>x</p>", 5));
    expect(md).toContain("[!warning]");
    expect(md).toContain("schema version 5");
  });

  it("returns an empty string for empty input", () => {
    expect(parseNote(deps, "")).toBe("");
  });

  it("returns an empty string when no schema container is present", () => {
    expect(parseNote(deps, "<p>plain note</p>")).toBe("");
  });

  it("sees through the zotero-note znv1 storage wrapper", () => {
    const md = parseNote(
      deps,
      `<div class="zotero-note znv1">${note("<p>hello</p>")}</div>`,
    );
    expect(md).toBe("hello");
  });
});

describe("whitespace post-pass", () => {
  it("collapses 3+ newline runs to a single blank line", () => {
    const md = parseNote(deps, note("<p>a</p><hr><hr><p>b</p>"));
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe("highlight annotation", () => {
  const md = parseNote(
    deps,
    note(
      annot(
        "highlight",
        {
          attachmentURI: ATTACHMENT,
          annotationKey: "C2DF35H3",
          color: "#e56eee",
          pageLabel: "62",
        },
        "might aid in our understanding",
      ),
    ),
  );

  it("wraps the excerpt in a linked, colored <mark>", () => {
    expect(md).toBe(
      '[<mark class="zotlit-hl" data-color="magenta" ' +
        'style="background-color: var(--zotlit-hl-magenta, #e56eee);">' +
        "might aid in our understanding</mark>]" +
        "(zotero://open/library/items/T2P8T29G?page=62&annotation=C2DF35H3)",
    );
  });
});

describe("underline annotation", () => {
  it("wraps the excerpt in a linked, colored <u>", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "underline",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "7SUQ86WL",
            color: "#ffd400",
            pageLabel: "62",
          },
          "reference alternative as valu",
        ),
      ),
    );
    expect(md).toBe(
      '[<u class="zotlit-ul" data-color="yellow" ' +
        'style="text-decoration-color: var(--zotlit-ul-yellow, #ffd400);">' +
        "reference alternative as valu</u>]" +
        "(zotero://open/library/items/T2P8T29G?page=62&annotation=7SUQ86WL)",
    );
  });
});

describe("annotation edge cases", () => {
  it("preserves user-edited span text (not the DB annotation text)", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "edited by the user",
        ),
      ),
    );
    expect(md).toContain(">edited by the user</mark>");
  });

  it("emits a plain mark without a link when the attachment URI is malformed", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "highlight",
          {
            attachmentURI: "not-a-zotero-uri",
            annotationKey: "K",
            color: "#ffd400",
          },
          "no link",
        ),
      ),
    );
    expect(md).toBe(
      '<mark class="zotlit-hl" data-color="yellow" ' +
        'style="background-color: var(--zotlit-hl-yellow, #ffd400);">no link</mark>',
    );
  });

  it("falls back to inline hex for an unmapped color", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#123456" },
          "odd color",
        ),
      ),
    );
    expect(md).toContain(
      '<mark class="zotlit-hl" style="background-color: #123456;">',
    );
    expect(md).not.toContain("data-color");
    expect(md).not.toContain("var(");
  });

  it("builds a group-library backlink for a group attachment", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "highlight",
          {
            attachmentURI: "http://zotero.org/groups/9/items/T2P8T29G",
            annotationKey: "K",
            color: "#ffd400",
          },
          "group excerpt",
        ),
      ),
    );
    expect(md).toContain(
      "(zotero://open/groups/9/items/T2P8T29G?annotation=K)",
    );
  });

  it("omits the page hint when the payload has no pageLabel", () => {
    const md = parseNote(
      deps,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "no page",
        ),
      ),
    );
    expect(md).toContain("items/T2P8T29G?annotation=K)");
    expect(md).not.toContain("page=");
  });
});

describe("image annotation", () => {
  it("passes the raw <img> through for Stage 9 to resolve", () => {
    const md = parseNote(
      deps,
      note(
        '<img data-attachment-key="DUPB2GWX" ' +
          'data-annotation="%7B%22annotationKey%22%3A%22DBKE89L9%22%7D">',
      ),
    );
    expect(md).toContain('data-attachment-key="DUPB2GWX"');
    expect(md.startsWith("<img")).toBe(true);
  });
});
