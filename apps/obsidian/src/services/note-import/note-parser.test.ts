// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TurndownService from "turndown";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  citekeysToCiteTemplateData,
  fetchAnnotationsTemplateData,
  getAttachmentByKey,
  getItemsByKey,
  getLibraryByGroupID,
} from "@zotlit/db";
import { makeItem } from "@zotlit/db/test-utils";
import { getPackageRoot } from "@zotlit/scripts/package-roots";
import { TemplateEngine } from "@zotlit/templates";
import defaultCite from "@zotlit/templates/defaults/cite.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import { renderAnnotations } from "@/lib/annotation-render";
import type {
  AttachmentSource,
  ResolveLinkOptions,
  SourceOrigin,
} from "@/services/attachment-import/service";

import { parseNote } from "./note-parser";
import type { ParseNoteDeps } from "./note-parser";

const packageRoot = getPackageRoot(import.meta.filename);

// Keep the real DOM-free parsers; only the DB-backed legs are stubbed per test.
vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getItemsByKey: vi.fn(),
    getAttachmentByKey: vi.fn(),
    getLibraryByGroupID: vi.fn(),
    fetchAnnotationsTemplateData: vi.fn(),
  };
});

/**
 * Mock `getItemsByKey` to return a live DB row for each `key -> citationKey`
 * entry within `libraryID`, mirroring how `resolveCitekey` now reads the
 * citekey off the already-fetched item instead of a second query.
 */
function mockDbCitekeys(entries: Record<string, string | null>, libraryID = 1) {
  vi.mocked(getItemsByKey).mockImplementation((_db, lib, keys) =>
    lib === libraryID
      ? keys
          .filter((key) => key in entries)
          .map((key) =>
            makeItem(
              { itemType: "journalArticle", citationKey: entries[key]! },
              { key, indexedKey: key, libraryID: lib },
            ),
          )
      : [],
  );
}

const ITEMS = "http://zotero.org/users/local/BOtEiq6p/items";
const ATTACHMENT = `${ITEMS}/T2P8T29G`;

/**
 * Render cited items as `[@key; @key]`, dropping the unresolved ones. Mirrors
 * the default `cite` template's citation-prop rendering (9.2-CSL #02):
 * `-@key` when suppressed, `, <labelShort> <locator>` when a locator is
 * present. Locator/labelShort/suppressAuthor are optional so this stub still
 * matches every citekey-only test unchanged.
 */
const renderCite = (
  items: readonly {
    citationKey: string | null;
    locator?: string | null;
    labelShort?: string;
    suppressAuthor?: boolean;
  }[],
) =>
  `[${items
    .filter((c) => c.citationKey)
    .map((c) => {
      const key = `${c.suppressAuthor ? "-" : ""}@${c.citationKey}`;
      return c.locator ? `${key}, ${c.labelShort ?? "p."} ${c.locator}` : key;
    })
    .join("; ")}]`;

/** Stand-in decision port: every source blocks, so no test copies a file. */
const blockedDecide = vi.fn(
  (path: string, origin: SourceOrigin): AttachmentSource => ({
    approved: false,
    path,
    origin,
    reason: "no-trusted-root",
  }),
);

/** A resolveLink stub echoing the requested vault name as a wikilink embed body. */
const echoResolveLink = vi.fn(
  (opts: ResolveLinkOptions) => () => `[[${opts.vaultName}]]`,
);

/** Full {@link ParseNoteDeps} for the resolving path; `client` is unused by the stubs. */
const deps: ParseNoteDeps = {
  client: {} as never,
  libraryID: 1,
  useColoredHighlightSyntax: false,
  renderCite,
  pathContext: { dataDir: "/data", baseAttachmentPath: null },
  attachmentImport: { decide: blockedDecide, resolveLink: echoResolveLink },
};

/** A storage-mode (linkMode 4) attachment row; the common case for note images. */
function storageAttachment(key: string, filename = "img.png") {
  return { key, path: `storage:${filename}`, linkMode: 4 };
}

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * Mirror the real batch renderer: map each key to its render, omitting only
 * unresolved keys (`null`). Blank callouts stay in the map — the prepass drops
 * them — so a `() => "  "` stub exercises that guard.
 */
const batchRender = (fn: (key: string) => string | null) =>
  vi.fn((keys: readonly string[]) => {
    const out = new Map<string, string>();
    for (const key of keys) {
      const callout = fn(key);
      if (callout !== null) out.set(key, callout);
    }
    return out;
  });

/**
 * Wrap body HTML in the schema container `parseNote` gates on, optionally
 * hoisting `citationItems` onto the container's `data-citation-items`.
 */
function note(body: string, version = 10, citationItems?: unknown): string {
  const attr =
    citationItems === undefined
      ? ""
      : ` data-citation-items="${encodeURIComponent(JSON.stringify(citationItems))}"`;
  return `<div data-schema-version="${version}"${attr}>${body}</div>`;
}

/** A `span.citation` mark carrying the URL-encoded `data-citation` payload. */
function cite(payload: Record<string, unknown>, text = "(citation)"): string {
  const attr = encodeURIComponent(JSON.stringify(payload));
  return `<span class="citation" data-citation="${attr}">${text}</span>`;
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
    const md = parseNote(TurndownService, note("<p>x</p>", 5), deps);
    expect(md).toContain("[!warning]");
    expect(md).toContain("schema version 5");
  });

  it("returns an empty string for empty input", () => {
    expect(parseNote(TurndownService, "", deps)).toBe("");
  });

  it("returns an empty string when no schema container is present", () => {
    expect(parseNote(TurndownService, "<p>plain note</p>", deps)).toBe("");
  });

  it("sees through the zotero-note znv1 storage wrapper", () => {
    const md = parseNote(
      TurndownService,
      `<div class="zotero-note znv1">${note("<p>hello</p>")}</div>`,
      deps,
    );
    expect(md).toBe("hello");
  });
});

describe("blank lines", () => {
  it("preserves intentional blank lines instead of collapsing them", () => {
    const md = parseNote(
      TurndownService,
      note("<p>a</p><hr><hr><p>b</p>"),
      deps,
    );
    // Two horizontal rules between paragraphs survive as raw Turndown output.
    expect(md).toBe("a\n\n---\n\n---\n\nb");
  });

  it("keeps a fenced code block's internal blank lines in the note body", () => {
    // The callout-scoped blank-run collapse (subsumeAnnotationParagraphs)
    // must not leak into the note body: a fenced block's textContent is
    // copied verbatim by the fence rule, untouched by this parser.
    const md = parseNote(
      TurndownService,
      note("<pre><code>line1\n\n\n\nline2</code></pre>"),
      deps,
    );
    expect(md).toBe("```\nline1\n\n\n\nline2\n```");
  });
});

describe("highlight annotation", () => {
  const md = parseNote(
    TurndownService,
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
    deps,
  );

  it("wraps the excerpt in a linked, colored <mark>", () => {
    expect(md).toBe(
      '[<mark class="zotlit-hl" data-color="magenta" ' +
        'style="background-color: var(--zotlit-hl-magenta, #e56eee);">' +
        "might aid in our understanding</mark>]" +
        "(zotero://open/library/items/T2P8T29G?annotation=C2DF35H3&page=62)",
    );
  });

  it("uses linked emoji-based syntax when enabled", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "C2DF35H3",
            color: "#2ea8e5",
            pageLabel: "62",
          },
          "might aid in our understanding",
        ),
      ),
      { ...deps, useColoredHighlightSyntax: true },
    );

    expect(md).toBe(
      "[==🔵might aid in our understanding==]" +
        "(zotero://open/library/items/T2P8T29G?annotation=C2DF35H3&page=62)",
    );
  });

  it.each(["#e56eee", "#aaaaaa", "#a6507b"])(
    "maps %s excerpts to a custom emoji and preserves the backlink",
    (color) => {
      const md = parseNote(
        TurndownService,
        note(
          annot(
            "highlight",
            {
              attachmentURI: ATTACHMENT,
              annotationKey: "C2DF35H3",
              color,
              pageLabel: "62",
            },
            "Highlighted text",
          ),
        ),
        {
          ...deps,
          useColoredHighlightSyntax: true,
          highlightMappings: {
            magenta: { output: "custom", customEmoji: "👩‍🔬" },
            gray: { output: "custom", customEmoji: "👩‍🔬" },
            plum: { output: "custom", customEmoji: "👩‍🔬" },
          },
        },
      );

      expect(md).toBe(
        "[==👩‍🔬Highlighted text==](zotero://open/library/items/T2P8T29G?annotation=C2DF35H3&page=62)",
      );
    },
  );

  it.each(["", "🔴🔵"])(
    "keeps linked HTML for an incomplete custom mapping: %j",
    (customEmoji) => {
      const md = parseNote(
        TurndownService,
        note(
          annot(
            "highlight",
            {
              attachmentURI: ATTACHMENT,
              annotationKey: "C2DF35H3",
              color: "#2ea8e5",
            },
            "Highlighted text",
          ),
        ),
        {
          ...deps,
          useColoredHighlightSyntax: true,
          highlightMappings: { blue: { output: "custom", customEmoji } },
        },
      );

      expect(md).toContain('[<mark class="zotlit-hl" data-color="blue"');
      expect(md).toContain(
        "](zotero://open/library/items/T2P8T29G?annotation=C2DF35H3)",
      );
    },
  );

  it("keeps linked HTML for an unsupported color when enabled", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "C2DF35H3",
            color: "#e56eee",
          },
          "might aid in our understanding",
        ),
      ),
      { ...deps, useColoredHighlightSyntax: true },
    );

    expect(md).toContain('[<mark class="zotlit-hl" data-color="magenta"');
    expect(md).toContain(
      "](zotero://open/library/items/T2P8T29G?annotation=C2DF35H3)",
    );
  });
});

describe("underline annotation", () => {
  it("wraps the excerpt in a linked, colored <u>", () => {
    const md = parseNote(
      TurndownService,
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
      deps,
    );
    expect(md).toBe(
      '[<u class="zotlit-ul" data-color="yellow" ' +
        'style="text-decoration-color: var(--zotlit-ul-yellow, #ffd400);">' +
        "reference alternative as valu</u>]" +
        "(zotero://open/library/items/T2P8T29G?annotation=7SUQ86WL&page=62)",
    );
  });
});

describe("annotation edge cases", () => {
  it("preserves user-edited span text (not the DB annotation text)", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "edited by the user",
        ),
      ),
      deps,
    );
    expect(md).toContain(">edited by the user</mark>");
  });

  it("emits a plain mark without a link when the attachment URI is malformed", () => {
    const md = parseNote(
      TurndownService,
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
      deps,
    );
    expect(md).toBe(
      '<mark class="zotlit-hl" data-color="yellow" ' +
        'style="background-color: var(--zotlit-hl-yellow, #ffd400);">no link</mark>',
    );
  });

  it("falls back to inline hex for an unmapped color", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#123456" },
          "odd color",
        ),
      ),
      deps,
    );
    expect(md).toContain(
      '<mark class="zotlit-hl" style="background-color: #123456;">',
    );
    expect(md).not.toContain("data-color");
    expect(md).not.toContain("var(");
  });

  it("builds a group-library backlink for a group attachment", () => {
    const md = parseNote(
      TurndownService,
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
      deps,
    );
    expect(md).toContain(
      "(zotero://open/groups/9/items/T2P8T29G?annotation=K)",
    );
  });

  it("omits the page hint when the payload has no pageLabel", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "no page",
        ),
      ),
      deps,
    );
    expect(md).toContain("items/T2P8T29G?annotation=K)");
    expect(md).not.toContain("page=");
  });
});

describe("embedded image resolution", () => {
  const img = (key: string) =>
    `<p><img data-attachment-key="${key}" alt=""></p>`;

  it("resolves a storage image to a vault embed via resolveLink", () => {
    vi.mocked(getAttachmentByKey).mockReturnValue(
      storageAttachment("U5WTYIJK", "diagram.png") as never,
    );
    const md = parseNote(TurndownService, note(img("U5WTYIJK")), deps);
    expect(md).toBe("![[U5WTYIJK-diagram.png]]");
    // The parser classifies the origin and hands the location to the decision
    // port; approving it is the import service's job, not the parser's.
    expect(blockedDecide).toHaveBeenCalledWith(
      "/data/storage/U5WTYIJK/diagram.png",
      "storage",
    );
    expect(echoResolveLink).toHaveBeenCalledWith({
      source: {
        approved: false,
        path: "/data/storage/U5WTYIJK/diagram.png",
        origin: "storage",
        reason: "no-trusted-root",
      },
      vaultName: "U5WTYIJK-diagram.png",
    });
  });

  it("resolves an image-excerpt embed to a bare embed (no annotation branch)", () => {
    vi.mocked(getAttachmentByKey).mockReturnValue(
      storageAttachment("DUPB2GWX") as never,
    );
    const md = parseNote(
      TurndownService,
      note(
        '<img data-attachment-key="DUPB2GWX" ' +
          'data-annotation="%7B%22annotationKey%22%3A%22DBKE89L9%22%7D">',
      ),
      deps,
    );
    expect(md).toBe("![[DUPB2GWX-img.png]]");
  });

  it("passes a missing attachment through as raw HTML", () => {
    vi.mocked(getAttachmentByKey).mockReturnValue(null);
    const md = parseNote(TurndownService, note(img("GONE1234")), deps);
    expect(md).toContain('data-attachment-key="GONE1234"');
    expect(md.startsWith("<img")).toBe(true);
    expect(echoResolveLink).not.toHaveBeenCalled();
  });

  it("passes a path-unresolved attachment through as raw HTML", () => {
    // linkMode 3 (linked_url) has no filesystem path, so attachmentAbsPath is null.
    vi.mocked(getAttachmentByKey).mockReturnValue({
      key: "URL12345",
      path: "http://example.com/a.png",
      linkMode: 3,
    } as never);
    const md = parseNote(TurndownService, note(img("URL12345")), deps);
    expect(md).toContain('data-attachment-key="URL12345"');
    expect(echoResolveLink).not.toHaveBeenCalled();
  });
});

describe("annotation template mode", () => {
  /** Declines for the `GONE` key (DB miss); otherwise renders a callout. */
  const render = batchRender((key) =>
    key === "GONE" ? null : `> [!note]\n>\n> callout ${key}`,
  );
  const withRender = (): ParseNoteDeps => ({
    ...deps,
    renderAnnotationParagraph: render,
  });

  const citation = cite({
    citationItems: [{ uris: [`${ITEMS}/KX67D9YM`] }],
    properties: {},
  });

  /** A clean highlight/underline insertion `<p>`: excerpt, citation, comment. */
  const spanPara = (className: string, key: string) =>
    `<p>${annot(
      className,
      { attachmentURI: ATTACHMENT, annotationKey: key, color: "#ffd400" },
      "excerpt",
    )} ${citation} trailing comment</p>`;

  it("subsumes a highlight paragraph into the rendered callout", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("highlight", "K1")),
      withRender(),
    );
    // The multi-line callout survives the sentinel round-trip intact.
    expect(md).toBe("> [!note]\n>\n> callout K1");
    expect(render).toHaveBeenCalledExactlyOnceWith(["K1"]);
  });

  it("subsumes an underline paragraph too", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("underline", "K2")),
      withRender(),
    );
    expect(md).toBe("> [!note]\n>\n> callout K2");
  });

  it("subsumes an image excerpt without resolving its storage attachment", () => {
    vi.mocked(getAttachmentByKey).mockReturnValue(
      storageAttachment("IMG1") as never,
    );
    const imgAnnot = encodeURIComponent(
      JSON.stringify({ attachmentURI: ATTACHMENT, annotationKey: "K3" }),
    );
    const body = `<p><img data-attachment-key="IMG1" data-annotation="${imgAnnot}"><br>${citation} caption</p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(md).toBe("> [!note]\n>\n> callout K3");
    // The inner <img> is removed before the embed rule runs — no orphan copy.
    expect(getAttachmentByKey).not.toHaveBeenCalled();
  });

  it("falls back to an inline mark when the renderer declines", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("highlight", "GONE")),
      withRender(),
    );
    expect(md).toContain('<mark class="zotlit-hl"');
    expect(md).not.toContain("[!note]");
  });

  it("falls back to an inline mark when the renderer omits the key (blank render)", () => {
    const md = parseNote(TurndownService, note(spanPara("highlight", "K1")), {
      ...deps,
      renderAnnotationParagraph: batchRender(() => "   \n"),
    });
    expect(md).toContain('<mark class="zotlit-hl"');
    expect(md).not.toContain("[!note]");
  });

  it("bails to inline when prose precedes the excerpt", () => {
    const body = `<p>this is the one to exclude ${annot(
      "highlight",
      { attachmentURI: ATTACHMENT, annotationKey: "K5", color: "#ffd400" },
      "excerpt",
    )} ${citation}</p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("this is the one to exclude");
    expect(md).toContain("<mark");
  });

  it("subsumes despite trailing prose after the citation", () => {
    // Zotero serializes the annotation comment into this slot; under
    // DB-as-truth the snapshot text is discarded for the rendered callout.
    const body = `<p>${annot(
      "underline",
      { attachmentURI: ATTACHMENT, annotationKey: "K6", color: "#ffd400" },
      "excerpt",
    )} ${citation} hand-typed trailing note</p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(md).toBe("> [!note]\n>\n> callout K6");
  });

  it("bails to inline when an extra element joins the paragraph", () => {
    const body = `<p>${annot(
      "highlight",
      { attachmentURI: ATTACHMENT, annotationKey: "K4", color: "#ffd400" },
      "excerpt",
    )} <em>hand-written aside</em></p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("<mark");
    expect(md).toContain("_hand-written aside_");
  });

  it("leaves an annotation paragraph nested in a list inline, preserving structure", () => {
    // Only "Add to note" top-level paragraphs are subsumed; a `<p>` a user
    // moved into a list is restructured prose, so the block callout would
    // detach and break the list. It falls through to the inline excerpt rule.
    const body = `<ul><li>${spanPara("highlight", "K7")}</li></ul>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("<mark");
    expect(md).not.toContain("[!note]");
    expect(md).toMatch(/^- /m);
  });

  it("ignores a citation-only paragraph", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(`<p>${citation} plain note text</p>`),
      withRender(),
    );
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("[@Hensher2011]");
    expect(md).toContain("plain note text");
  });

  it("collapses a blank-line run inside a custom template's callout and trims its edges", () => {
    // A custom `annotation` template that doesn't wrap its output in bq()
    // (autoTrim is [false, false]) can emit internal or trailing blank runs;
    // subsumeAnnotationParagraphs normalizes those before they're sealed into
    // the sentinel attribute, since Turndown only caps newlines *between*
    // blocks, never inside one rule's returned string.
    const md = parseNote(TurndownService, note(spanPara("highlight", "K8")), {
      ...deps,
      renderAnnotationParagraph: batchRender((key) =>
        key === "K8"
          ? "> [!note]\n>\n> line one\n\n\n\n> line two\n\n\n"
          : null,
      ),
    });
    expect(md).toBe("> [!note]\n>\n> line one\n\n> line two");
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("leaves a callout without excess blank lines unchanged", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("highlight", "K1")),
      withRender(),
    );
    expect(md).toBe("> [!note]\n>\n> callout K1");
  });

  it("carries zt.citation onto a subsumed annotation paragraph via the real render path (9.2-CSL #05)", () => {
    // The import leg wires `renderAnnotationParagraph` to `renderAnnotations`,
    // whose annotation-template data must expose `zt.citation` — the parent
    // item rendered through the `cite` template with the annotation's page
    // label as locator. A custom template referencing it should surface the
    // same `[@citekey, p. N]` the annot-view drag-insert produces.
    const facade = new TemplateFacade();
    facade.define("cite", defaultCite, "liquid");
    facade.define("annotation", "> [!note]\n>\n> <%= zt.citation %>", "eta");
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([
        [
          "K1",
          {
            key: "K1",
            pageLabel: "62",
            parentItem: { citationKey: "Hensher2011", citekey: "Hensher2011" },
          } as never,
        ],
      ]),
    );
    const renderAnnotationParagraph = (keys: readonly string[]) =>
      renderAnnotations(
        deps.client as never,
        keys.map((key) => ({ key }) as never),
        {
          template: facade as never,
          zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
          attachmentImport: {
            decide: blockedDecide,
            resolveLink: echoResolveLink,
          },
        },
      );
    const md = parseNote(TurndownService, note(spanPara("highlight", "K1")), {
      ...deps,
      renderAnnotationParagraph,
    });
    expect(md).toContain("[@Hensher2011, {p. 62}]");
  });
});

describe("citation resolution", () => {
  /** A single-item citation mark referencing `KX67D9YM`. */
  const oneCite = cite({
    citationItems: [{ uris: [`${ITEMS}/KX67D9YM`] }],
    properties: {},
  });

  it("resolves a cited item to its live DB citation key, emitted verbatim", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(TurndownService, note(oneCite), deps);
    expect(md).toContain("[@Hensher2011]");
    // The cite syntax is emitted unescaped — no `\[` from Turndown.
    expect(md).not.toContain("\\[");
  });

  it("falls back to the embedded snapshot map when the DB misses", () => {
    const md = parseNote(
      TurndownService,
      note(oneCite, 10, [
        {
          uris: [`${ITEMS}/KX67D9YM`],
          itemData: { id: `${ITEMS}/KX67D9YM`, "citation-key": "Embedded2020" },
        },
      ]),
      deps,
    );
    expect(md).toContain("[@Embedded2020]");
  });

  it("emits a visible sentinel when the DB and embedded map both miss", () => {
    const md = parseNote(TurndownService, note(oneCite), deps);
    expect(md).toContain("[@KX67D9YM?]");
  });

  it("leaves an unresolvable (no-ref) citation as raw-HTML passthrough", () => {
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: ["not-a-uri"] }], properties: {} })),
      deps,
    );
    expect(md).toContain("data-citation");
    expect(md).not.toContain("[@");
  });

  it("renders a multi-item mark through one joined cite render", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/KX67D9YM`] },
            { uris: [`${ITEMS}/4FQVQ6ZQ`] },
          ],
          properties: {},
        }),
        10,
        [
          {
            uris: [`${ITEMS}/4FQVQ6ZQ`],
            itemData: { id: `${ITEMS}/4FQVQ6ZQ`, "citation-key": "Kang2013" },
          },
        ],
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011; @Kang2013]");
  });

  it("still resolves via embedded and sentinel when the DB is degraded", () => {
    // A degraded DB makes the DB leg miss uniformly; embedded + sentinel run.
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/KX67D9YM`] },
            { uris: [`${ITEMS}/NOEMBED0`] },
          ],
          properties: {},
        }),
        10,
        [
          {
            uris: [`${ITEMS}/KX67D9YM`],
            itemData: {
              id: `${ITEMS}/KX67D9YM`,
              "citation-key": "Embedded2020",
            },
          },
        ],
      ),
      deps,
    );
    expect(md).toContain("[@Embedded2020; @NOEMBED0?]");
  });

  it("resolves a group-library citation via the group's own libraryID, not the note's", () => {
    // deps.libraryID is 1 (the note's personal library); the ref points at
    // group 9, which lives in libraryID 7.
    vi.mocked(getLibraryByGroupID).mockReturnValue({
      libraryID: 7,
      type: "group",
      groupID: 9,
      name: "Team Group",
    });
    mockDbCitekeys({ GRP1TEM: "GroupCite2020" }, 7);
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`http://zotero.org/groups/9/items/GRP1TEM`] },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(getLibraryByGroupID).toHaveBeenCalledWith(deps.client, 9);
    expect(getItemsByKey).toHaveBeenCalledWith(deps.client, 7, ["GRP1TEM"]);
    expect(md).toContain("[@GroupCite2020]");
  });

  it("falls back to the note's libraryID when the group can't be resolved", () => {
    vi.mocked(getLibraryByGroupID).mockReturnValue(null);
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`http://zotero.org/groups/9/items/GRP1TEM`] },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(getItemsByKey).toHaveBeenCalledWith(deps.client, deps.libraryID, [
      "GRP1TEM",
    ]);
    expect(md).toContain("[@GRP1TEM?]");
  });

  it("trims the rendered cite so it stays inline (cite.eta's trailing \\n)", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(TurndownService, note(`x ${oneCite} y`), {
      ...deps,
      renderCite: (items) => `${renderCite(items)}\n`,
    });
    expect(md).toBe("x [@Hensher2011] y");
  });

  it("threads a page locator through to the rendered citation (9.2-CSL #02)", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [{ uris: [`${ITEMS}/KX67D9YM`], locator: "62" }],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011, p. 62]");
  });

  it("renders a non-page label with its Pandoc abbreviation", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            {
              uris: [`${ITEMS}/KX67D9YM`],
              locator: "3",
              label: "chapter",
            },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011, chap. 3]");
  });

  it("threads locator/label/suppress-author through the production renderCite glue (citekeysToCiteTemplateData + the real default cite template)", () => {
    // Exercises the actual service.ts wiring (renderCite → citekeysToCiteTemplateData →
    // ctx.template.render("cite", ...)), not the hand-written `renderCite` stub used by
    // every other test in this file.
    const facade = new TemplateFacade();
    facade.define("cite", defaultCite, "liquid");
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            {
              uris: [`${ITEMS}/KX67D9YM`],
              locator: "62",
              "suppress-author": true,
            },
          ],
          properties: {},
        }),
      ),
      {
        ...deps,
        renderCite: (items) =>
          facade.render("cite", citekeysToCiteTemplateData(items)),
      },
    );
    expect(md).toContain("[-@Hensher2011, {p. 62}]");
  });

  it("renders suppress-author as a Pandoc -@key prefix", () => {
    mockDbCitekeys({ KX67D9YM: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/KX67D9YM`], "suppress-author": true },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[-@Hensher2011]");
  });

  it("composes suppress-author with the unresolved-key sentinel", () => {
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/KX67D9YM`], "suppress-author": true },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[-@KX67D9YM?]");
  });

  it("falls back to raw-HTML passthrough when a citation prop has the wrong type", () => {
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/KX67D9YM`], "suppress-author": "yes" },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("data-citation");
    expect(md).not.toContain("[@");
  });
});

describe("citation resolution — DB item data (9.2-CSL #03)", () => {
  /** A single-item citation mark referencing `KX67D9YM`. */
  const oneCite = cite({
    citationItems: [{ uris: [`${ITEMS}/KX67D9YM`] }],
    properties: {},
  });

  it("exposes the DB-resolved item's title/date to a custom author-year cite template through the production renderCite glue", () => {
    const engine = new TemplateEngine();
    engine.define(
      "cite",
      "<%= zt.citations.map(c => `${c.item.title} (${c.item.date?.year ?? 'n.d.'})`).join('; ') %>",
    );
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        date: "2011",
        citationKey: "Hensher2011",
      }),
    ]);
    const md = parseNote(TurndownService, note(oneCite), {
      ...deps,
      renderCite: (items) =>
        engine.render("cite", citekeysToCiteTemplateData(items)),
    });
    expect(md).toContain("Stated choice methods (2011)");
  });

  it("still uses the note's embedded snapshot citekey when the DB item carries none, while keeping the DB item's other data", () => {
    const engine = new TemplateEngine();
    engine.define(
      "cite",
      "<%= zt.citations.map(c => `${c.item.citekey}: ${c.item.title}`).join('; ') %>",
    );
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        citationKey: null,
      }),
    ]);
    const md = parseNote(
      TurndownService,
      note(oneCite, 10, [
        {
          uris: [`${ITEMS}/KX67D9YM`],
          itemData: { id: `${ITEMS}/KX67D9YM`, "citation-key": "Embedded2020" },
        },
      ]),
      {
        ...deps,
        renderCite: (items) =>
          engine.render("cite", citekeysToCiteTemplateData(items)),
      },
    );
    expect(md).toContain("Embedded2020: Stated choice methods");
  });
});

describe("citation resolution — embedded item data (9.2-CSL #04)", () => {
  /** A data-driven cite template reading item data the snapshot must supply. */
  const dataDrivenCite =
    "<%= zt.citations.map(c => `${c.item.citekey}: ${c.item.title} " +
    "(${c.item.date?.year ?? 'n.d.'}) — ${c.item.containerTitle}`).join('; ') %>";

  /** Full CSL-JSON `itemData` for a cited item, as Zotero embeds it. */
  const embedded = (uri: string, over: Record<string, unknown> = {}) => ({
    uris: [uri],
    itemData: {
      id: uri,
      type: "article-journal",
      title: "Stated choice methods",
      "container-title": "Transport Reviews",
      issued: { "date-parts": [[2011]] },
      "citation-key": "Kang2013",
      ...over,
    },
  });

  function withDataTemplate(): ParseNoteDeps {
    const engine = new TemplateEngine();
    engine.define("cite", dataDrivenCite);
    return {
      ...deps,
      renderCite: (items) =>
        engine.render("cite", citekeysToCiteTemplateData(items)),
    };
  }

  it("renders full item data from the embedded snapshot for a cross-library cite the DB can't resolve", () => {
    // group 9 is not synced locally → getLibraryByGroupID misses; the local DB
    // has no such item, so item data must come from the embedded snapshot.
    vi.mocked(getLibraryByGroupID).mockReturnValue(null);
    const uri = "http://zotero.org/groups/9/items/GRP1TEM";
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain(
      "Kang2013: Stated choice methods (2011) — Transport Reviews",
    );
  });

  it("resolves full embedded item data when the DB is degraded (client not ready)", () => {
    // getItemsByKey is unconfigured → returns undefined (the degraded-DB path);
    // the embedded snapshot alone must carry item data plus the citekey.
    const uri = `${ITEMS}/KX67D9YM`;
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain(
      "Kang2013: Stated choice methods (2011) — Transport Reviews",
    );
  });

  it("keeps the live DB item's data over the embedded snapshot when both resolve", () => {
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        itemType: "journalArticle",
        title: "Live DB title",
        publicationTitle: "Live DB journal",
        citationKey: "Hensher2011",
      }),
    ]);
    const uri = `${ITEMS}/KX67D9YM`;
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri, {
          title: "Stale snapshot title",
          "citation-key": "Snapshot2020",
        }),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain("Hensher2011: Live DB title");
    expect(md).not.toContain("Stale snapshot title");
    expect(md).not.toContain("Snapshot2020");
  });
});

/**
 * End-to-end conversion of the real Zotero note fixtures with every resolver
 * wired, exercising image rendering and annotation extraction together.
 */
describe("fixtures (resolving)", () => {
  function fixture(name: string): string {
    return readFileSync(
      join(packageRoot, "src/lib/turndown/__fixtures__", name),
      "utf8",
    );
  }

  it("renders images, citations, and formatting in zt-note-example.html", () => {
    vi.mocked(getAttachmentByKey).mockImplementation(
      (_db, key) => storageAttachment(key) as never,
    );
    const md = parseNote(
      TurndownService,
      fixture("zt-note-example.html"),
      deps,
    );

    // The plain embedded image resolves to a vault embed.
    expect(md).toContain("![[U5WTYIJK-img.png]]");
    expect(md).not.toContain("<img");
    // The multi-item citation resolves through the embedded snapshot map.
    expect(md).toContain("[@Kang2013; @Hensher2011]");
    expect(md).not.toContain("data-citation");
    // Non-DB formatting is untouched by the resolving path.
    expect(md).toContain("$e^{i\\pi}+1=0$");
    expect(md).toContain("$$\\frac{a_1}{b_2}$$");
  });

  it("extracts annotations and image excerpts in zt-excerpt-note.html", () => {
    vi.mocked(getAttachmentByKey).mockImplementation(
      (_db, key) => storageAttachment(key) as never,
    );
    // No annotation-template renderer → inline marks / bare embed (default).
    const md = parseNote(
      TurndownService,
      fixture("zt-excerpt-note.html"),
      deps,
    );

    // Highlight excerpts → linked, colored <mark>.
    expect(md).toContain('<mark class="zotlit-hl" data-color="red"');
    expect(md).toContain("annotation=JDJKX3N6&page=62)");
    expect(md).toContain("annotation=KMV38EI6&page=62)");
    // Underline excerpt → linked, colored <u>.
    expect(md).toContain('<u class="zotlit-ul" data-color="yellow"');
    expect(md).toContain("annotation=V78IHLM9&page=62)");
    // Image-excerpt embed → bare vault embed (no template renderer supplied).
    expect(md).toContain("![[7TTPMKWK-img.png]]");
    expect(md).not.toContain("<img");
    // Citations resolve via the embedded snapshot map, threading the
    // fixture's page-62 locator (9.2-CSL #02).
    expect(md).toContain("[@Hensher2011, p. 62]");
    expect(md).not.toContain("data-citation");
  });

  it("renders every annotation paragraph via the template when enabled", () => {
    vi.mocked(getAttachmentByKey).mockImplementation(
      (_db, key) => storageAttachment(key) as never,
    );
    const renderAnnotationParagraph = batchRender(
      (key) => `> [!note] Page 62\n>\n> excerpt ${key}`,
    );
    const md = parseNote(TurndownService, fixture("zt-excerpt-note.html"), {
      ...deps,
      renderAnnotationParagraph,
    });

    // Every clean insertion paragraph is subsumed, keyed by its annotation key
    // and in document order: highlight, underline, highlight, image, then the
    // two trailing-comment underlines. `AFUVIG9Z` is absent — its leading prose
    // ("this is the one to exclude") makes it user-edited, so the gate bails.
    const subsumed = [
      "JDJKX3N6",
      "V78IHLM9",
      "KMV38EI6",
      "DBKE89L9",
      "XRZMBHKK",
      "NPUZ9NKS",
    ];
    // One batched call carrying every found key in document order; the gated
    // `AFUVIG9Z` (user-edited prose) is excluded from the batch.
    expect(renderAnnotationParagraph).toHaveBeenCalledExactlyOnceWith(subsumed);
    expect(renderAnnotationParagraph.mock.calls[0]![0]).not.toContain(
      "AFUVIG9Z",
    );
    for (const key of subsumed) {
      expect(md).toContain(`> [!note] Page 62\n>\n> excerpt ${key}`);
    }
    // The excluded paragraph keeps its prose and falls back to an inline mark.
    expect(md).toContain("this is the one to exclude");
    expect(md).toContain("annotation=AFUVIG9Z&page=62)");
    // The image excerpt's storage attachment is never resolved — its <img> is
    // removed before the embed rule runs (no orphan copy).
    expect(md).not.toContain("![[7TTPMKWK");
    expect(getAttachmentByKey).not.toHaveBeenCalled();
  });
});
