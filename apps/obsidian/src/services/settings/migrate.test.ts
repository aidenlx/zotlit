import { describe, expect, it } from "vitest";

import {
  migrateLegacyV0,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
} from "./migrate";

describe("migrateLegacyV0", () => {
  it("returns an empty object for non-plain inputs", () => {
    expect(migrateLegacyV0(null)).toEqual({});
    expect(migrateLegacyV0(undefined)).toEqual({});
    expect(migrateLegacyV0("string")).toEqual({});
    expect(migrateLegacyV0(42)).toEqual({});
    expect(migrateLegacyV0([1, 2, 3])).toEqual({});
    expect(migrateLegacyV0(new Map())).toEqual({});
  });

  it("returns an empty object for an empty plain object", () => {
    expect(migrateLegacyV0({})).toEqual({});
  });

  it("remaps every non-default v0 key to its v1 dotted equivalent", () => {
    expect(
      migrateLegacyV0({
        logLevel: "DEBUG",
        citationEditorSuggester: false,
        showCitekeyInSuggester: true,
        literatureNoteFolder: "Notes",
        enableServer: true,
        serverPort: 9099,
        serverHostname: "localhost",
        template: {
          folder: "Templates",
          templates: { filename: "<%= it.title %>.md" },
        },
        autoPairEta: true,
        autoTrim: ["nl", "slurp"],
        autoRefresh: false,
        citationLibrary: 2,
        imgExcerptImport: false,
        imgExcerptPath: "ZtImg",
      }),
    ).toEqual({
      "log.level": "debug",
      "citation.editor-suggester": false,
      "citation.show-citekey-in-suggester": true,
      "note.literature-folder": "Notes",
      "server.enabled": true,
      "server.port": 9099,
      "server.hostname": "localhost",
      "template.folder": "Templates",
      "template.auto-pair-eta": true,
      "template.auto-trim-leading": "nl",
      "template.auto-trim-trailing": "slurp",
      "zotero.auto-refresh": false,
      "zotero.citation-library": 2,
      "attachment.import": false,
      "attachment.folder-path": "ZtImg",
    });
  });

  describe("log level mapping", () => {
    it.each([
      ["ALL", "trace"],
      ["TRACE", "trace"],
      ["DEBUG", "debug"],
      ["WARN", "warning"],
      ["ERROR", "error"],
      ["FATAL", "fatal"],
    ] as const)("maps log4js %s → logtape %s", (input, expected) => {
      expect(migrateLegacyV0({ logLevel: input })).toEqual({
        "log.level": expected,
      });
    });

    it("maps OFF to null so disabled logging is preserved", () => {
      expect(migrateLegacyV0({ logLevel: "OFF" })).toEqual({
        "log.level": null,
      });
    });

    it("drops INFO because it matches the legacy default", () => {
      expect(migrateLegacyV0({ logLevel: "INFO" })).toEqual({});
    });

    it("drops MARK because it has no logtape equivalent", () => {
      expect(migrateLegacyV0({ logLevel: "MARK" })).toEqual({});
    });

    it("drops a non-string logLevel", () => {
      expect(migrateLegacyV0({ logLevel: 42 })).toEqual({});
      expect(migrateLegacyV0({ logLevel: null })).toEqual({});
    });
  });

  describe("nested template handling", () => {
    it("extracts template.folder; never migrates the embedded filename template", () => {
      expect(
        migrateLegacyV0({ template: { folder: "T", templates: {} } }),
      ).toEqual({
        "template.folder": "T",
      });
      expect(
        migrateLegacyV0({
          template: { folder: "", templates: { filename: "F" } },
        }),
      ).toEqual({
        "template.folder": "",
      });
    });

    it("drops template entirely when it is not a plain object", () => {
      expect(migrateLegacyV0({ template: null })).toEqual({});
      expect(migrateLegacyV0({ template: "Templates" })).toEqual({});
      expect(migrateLegacyV0({ template: ["a", "b"] })).toEqual({});
    });

    it("drops folder when it is not a string, regardless of templates shape", () => {
      expect(
        migrateLegacyV0({ template: { folder: 5, templates: "nope" } }),
      ).toEqual({});
    });
  });

  describe("autoTrim tuple", () => {
    it("splits a 2-element autoTrim and drops default sides", () => {
      expect(migrateLegacyV0({ autoTrim: [false, "slurp"] })).toEqual({
        "template.auto-trim-trailing": "slurp",
      });
    });

    it("drops autoTrim when it is not a 2-element array", () => {
      expect(migrateLegacyV0({ autoTrim: ["nl"] })).toEqual({});
      expect(migrateLegacyV0({ autoTrim: ["nl", "slurp", "extra"] })).toEqual(
        {},
      );
      expect(migrateLegacyV0({ autoTrim: "nl" })).toEqual({});
    });
  });

  it("drops values equal to legacy defaults except v0 folder paths", () => {
    expect(
      migrateLegacyV0({
        logLevel: "INFO",
        citationEditorSuggester: true,
        showCitekeyInSuggester: false,
        literatureNoteFolder: "LiteratureNotes",
        enableServer: false,
        serverPort: 9091,
        serverHostname: "127.0.0.1",
        template: {
          folder: "ZtTemplates",
          templates: {
            filename: "<%= it.citekey ?? it.DOI ?? it.title ?? it.key %>.md",
          },
        },
        autoPairEta: false,
        autoTrim: [false, false],
        autoRefresh: true,
        citationLibrary: 1,
        imgExcerptImport: "symlink",
        imgExcerptPath: "ZtImgExcerpt",
      }),
    ).toEqual({
      "note.literature-folder": "LiteratureNotes",
      "template.folder": "ZtTemplates",
    });
  });

  it("preserves v0 folder paths even when they match v1 defaults", () => {
    expect(
      migrateLegacyV0({
        literatureNoteFolder: "literatures",
        template: { folder: "templates", templates: {} },
      }),
    ).toEqual({
      "note.literature-folder": "literatures",
      "template.folder": "templates",
    });
  });

  it("maps legacy image import modes to the attachment import setting", () => {
    expect(migrateLegacyV0({ imgExcerptImport: "symlink" })).toEqual({});
    expect(migrateLegacyV0({ imgExcerptImport: "copy" })).toEqual({});
    expect(migrateLegacyV0({ imgExcerptImport: false })).toEqual({
      "attachment.import": false,
    });
  });

  it("passes through values it cannot validate; the service does per-key cleanup", () => {
    expect(
      migrateLegacyV0({
        serverPort: "not-a-number",
        literatureNoteFolder: 42,
      }),
    ).toEqual({
      "server.port": "not-a-number",
      "note.literature-folder": 42,
    });
  });
});

describe("migrateV1ToV2", () => {
  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV1ToV2(null)).toEqual({});
    expect(migrateV1ToV2(undefined)).toEqual({});
    expect(migrateV1ToV2("string")).toEqual({});
    expect(migrateV1ToV2(42)).toEqual({});
    expect(migrateV1ToV2([1, 2, 3])).toEqual({});
    expect(migrateV1ToV2(new Map())).toEqual({});
  });

  it("copies other keys through untouched, including __VERSION__", () => {
    expect(
      migrateV1ToV2({
        __VERSION__: 1,
        "note.literature-folder": "/kept",
        "server.enabled": true,
      }),
    ).toEqual({
      __VERSION__: 1,
      "note.literature-folder": "/kept",
      "server.enabled": true,
    });
  });

  it("passes through note.frontmatter-fields unchanged when it is absent or not an array", () => {
    expect(migrateV1ToV2({ "note.literature-folder": "/x" })).toEqual({
      "note.literature-folder": "/x",
    });
    expect(
      migrateV1ToV2({ "note.frontmatter-fields": "not-an-array" }),
    ).toEqual({
      "note.frontmatter-fields": "not-an-array",
    });
  });

  it("stamps language: javascript onto a custom field", () => {
    expect(
      migrateV1ToV2({
        "note.frontmatter-fields": [
          { key: "custom", expr: "zt.customExpr", merge: "replace" },
        ],
      }),
    ).toEqual({
      "note.frontmatter-fields": [
        {
          key: "custom",
          expr: "zt.customExpr",
          merge: "replace",
          language: "javascript",
        },
      ],
    });
  });

  it("rewrites each byte-exact v1 default JS expr to its Liquid equivalent, preserving key/merge", () => {
    expect(
      migrateV1ToV2({
        "note.frontmatter-fields": [
          { key: "title", expr: "zt.title", merge: "replace" },
          {
            key: "related",
            expr: "zt.relatedItems.map((i) => i.noteLink() ?? `zt-error:${i.indexedKey}`)",
            // user changed merge on a default field
            merge: "append",
          },
          {
            key: "collections",
            expr: 'zt.collections.map((c) => c.path.join("/"))',
            merge: "keep",
          },
        ],
      }),
    ).toEqual({
      "note.frontmatter-fields": [
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
        {
          key: "related",
          expr: "zt.relatedItems | note_links",
          merge: "append",
          language: "liquid",
        },
        {
          key: "collections",
          expr: "zt.collections | collection_paths",
          merge: "keep",
          language: "liquid",
        },
      ],
    });
  });

  it("leaves a near-miss default expr stamped javascript instead of guessing", () => {
    expect(
      migrateV1ToV2({
        "note.frontmatter-fields": [
          // trailing space vs the byte-exact default
          { key: "title", expr: "zt.title ", merge: "replace" },
          // different quotes vs the byte-exact default
          {
            key: "collections",
            expr: "zt.collections.map((c) => c.path.join('/'))",
            merge: "replace",
          },
        ],
      }),
    ).toEqual({
      "note.frontmatter-fields": [
        {
          key: "title",
          expr: "zt.title ",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "collections",
          expr: "zt.collections.map((c) => c.path.join('/'))",
          merge: "replace",
          language: "javascript",
        },
      ],
    });
  });

  it("passes non-plain-object array items through unchanged", () => {
    expect(
      migrateV1ToV2({
        "note.frontmatter-fields": ["not-an-object", 42, null],
      }),
    ).toEqual({
      "note.frontmatter-fields": ["not-an-object", 42, null],
    });
  });
});

describe("migrateV2ToV3", () => {
  it("enables citation key links for migrated users", () => {
    expect(migrateV2ToV3({ __VERSION__: 2 })).toEqual({
      __VERSION__: 2,
      "citation.key-links": true,
      "citation.key-links-frontmatter-key": "citekey",
    });
  });

  it("appends the default citekey field to a customized field list", () => {
    expect(
      migrateV2ToV3({
        "note.frontmatter-fields": [
          {
            key: "custom",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
        ],
      }),
    ).toEqual({
      "citation.key-links": true,
      "citation.key-links-frontmatter-key": "citekey",
      "note.frontmatter-fields": [
        {
          key: "custom",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
        {
          key: "citekey",
          expr: "zt.citationKey",
          merge: "replace",
          language: "liquid",
        },
      ],
    });
  });

  it("preserves an existing citekey field without adding a duplicate", () => {
    const existing = {
      key: "citekey",
      expr: "zt.citationKey | upcase",
      merge: "keep",
      language: "liquid",
    } as const;
    expect(migrateV2ToV3({ "note.frontmatter-fields": [existing] })).toEqual({
      "citation.key-links": true,
      "citation.key-links-frontmatter-key": "citekey",
      "note.frontmatter-fields": [existing],
    });
  });

  it("leaves absent and malformed field-list overrides for settings cleanup", () => {
    expect(migrateV2ToV3({})).toEqual({
      "citation.key-links": true,
      "citation.key-links-frontmatter-key": "citekey",
    });
    expect(
      migrateV2ToV3({ "note.frontmatter-fields": "not-an-array" }),
    ).toEqual({
      "citation.key-links": true,
      "citation.key-links-frontmatter-key": "citekey",
      "note.frontmatter-fields": "not-an-array",
    });
  });
});

describe("migrateV3ToV4", () => {
  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV3ToV4(null)).toEqual({});
    expect(migrateV3ToV4([1, 2, 3])).toEqual({});
  });

  it("carries an enabled citation key links setting into the citekey editor", () => {
    expect(
      migrateV3ToV4({ __VERSION__: 3, "citation.key-links": true }),
    ).toEqual({
      __VERSION__: 3,
      "citation.citekey-editor": true,
    });
  });

  it("keeps the citekey editor off for a user who had citation key links off", () => {
    expect(migrateV3ToV4({ "citation.key-links": false })).toEqual({
      "citation.citekey-editor": false,
    });
  });

  it("treats an absent citation key links override as the v3 default, off", () => {
    expect(
      migrateV3ToV4({ "citation.key-links-frontmatter-key": "bibkey" }),
    ).toEqual({
      "citation.citekey-editor": false,
      "citation.key-links-frontmatter-key": "bibkey",
    });
  });

  it("leaves every other override untouched", () => {
    expect(
      migrateV3ToV4({
        "citation.key-links": true,
        "note.literature-folder": "refs",
        "citation.citekey-indexing": false,
      }),
    ).toEqual({
      "citation.citekey-editor": true,
      "note.literature-folder": "refs",
      "citation.citekey-indexing": false,
    });
  });
});
