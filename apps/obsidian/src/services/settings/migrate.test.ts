import { describe, expect, it } from "vitest";

import {
  migrateLegacyV0,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
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

  it("remaps every non-default v0 key to its v1 dotted equivalent, dropping the retired default library", () => {
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

describe("migrateV4ToV5", () => {
  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV4ToV5(null)).toEqual({});
    expect(migrateV4ToV5([1, 2, 3])).toEqual({});
  });

  it("drops the retired Citation Key Property override", () => {
    expect(
      migrateV4ToV5({
        __VERSION__: 4,
        "citation.key-links-frontmatter-key": "bibkey",
      }),
    ).toEqual({ __VERSION__: 4 });
  });

  it("leaves every other override untouched", () => {
    expect(
      migrateV4ToV5({
        "note.literature-folder": "refs",
        "citation.citekey-indexing": false,
      }),
    ).toEqual({
      "note.literature-folder": "refs",
      "citation.citekey-indexing": false,
    });
  });
});

describe("migrateV5ToV6", () => {
  it("returns an empty object for non-plain input", () => {
    expect(migrateV5ToV6(null)).toEqual({});
    expect(migrateV5ToV6([1, 2, 3])).toEqual({});
  });

  it.each([true, false])(
    "renames Citekey Indexing value %s to Pandoc Citations",
    (enabled) => {
      expect(
        migrateV5ToV6({
          __VERSION__: 5,
          "citation.citekey-indexing": enabled,
          "citation.wikilink-citations": true,
          "citation.wikilink-display": false,
          "citation.references-style": "apa",
        }),
      ).toEqual({
        __VERSION__: 5,
        "citation.pandoc-citations": enabled,
        "citation.wikilink-citations": true,
        "citation.references-style": "apa",
      });
    },
  );

  it("uses the new default when the old key is absent", () => {
    expect(migrateV5ToV6({ __VERSION__: 5 })).toEqual({ __VERSION__: 5 });
  });
});

describe("migrateV6ToV7", () => {
  it.each([
    [true, true],
    [false, false],
  ] as const)(
    "maps the citekey editor value %s to Pandoc citation navigation",
    (input, expected) => {
      expect(
        migrateV6ToV7({
          __VERSION__: 6,
          "citation.citekey-editor": input,
          "citation.show-formatted": false,
        }),
      ).toEqual({
        __VERSION__: 6,
        "citation.open-pandoc-links": expected,
        "citation.show-formatted": false,
      });
    },
  );

  it("keeps the new navigation setting absent when the old value is absent", () => {
    expect(migrateV6ToV7({ __VERSION__: 6 })).toEqual({ __VERSION__: 6 });
  });
});

describe("migrateV7ToV8", () => {
  it.each([
    [true, true],
    [false, false],
  ] as const)(
    "carries the stored Pandoc navigation value %s to the citation link control",
    (input, expected) => {
      expect(
        migrateV7ToV8({
          __VERSION__: 7,
          "citation.open-pandoc-links": input,
          "citation.show-formatted": false,
        }),
      ).toEqual({
        __VERSION__: 7,
        "citation.open-as-links": expected,
        "citation.show-formatted": false,
      });
    },
  );

  it("materializes the old default when the old value is absent", () => {
    expect(migrateV7ToV8({ __VERSION__: 7 })).toEqual({
      __VERSION__: 7,
      "citation.open-as-links": true,
    });
  });

  it("materializes the old default when the old value is not a boolean", () => {
    expect(
      migrateV7ToV8({
        __VERSION__: 7,
        "citation.open-pandoc-links": "yes",
        "note.literature-folder": "Refs",
      }),
    ).toEqual({
      __VERSION__: 7,
      "citation.open-as-links": true,
      "note.literature-folder": "Refs",
    });
  });

  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV7ToV8(null)).toEqual({});
    expect(migrateV7ToV8(42)).toEqual({});
  });
});

describe("migrateV8ToV9", () => {
  const MY_LIBRARY = {
    mode: "selected",
    libraries: [{ type: "personal" }],
  };

  it.each([1, 4, "not-a-number"] as const)(
    "selects my library and drops the default library value %s",
    (citationLibrary) => {
      expect(
        migrateV8ToV9({
          __VERSION__: 8,
          "zotero.citation-library": citationLibrary,
          "note.literature-folder": "Refs",
        }),
      ).toEqual({
        __VERSION__: 8,
        "note.literature-folder": "Refs",
        "zotero.library-scope": MY_LIBRARY,
      });
    },
  );

  it("selects my library when no default library was ever saved", () => {
    expect(migrateV8ToV9({ __VERSION__: 8 })).toEqual({
      __VERSION__: 8,
      "zotero.library-scope": MY_LIBRARY,
    });
  });

  it("replaces a scope value that a future downgrade left behind", () => {
    expect(
      migrateV8ToV9({
        __VERSION__: 8,
        "zotero.library-scope": { mode: "all" },
      }),
    ).toEqual({ __VERSION__: 8, "zotero.library-scope": MY_LIBRARY });
  });

  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV8ToV9(null)).toEqual({});
    expect(migrateV8ToV9(42)).toEqual({});
  });
});

describe("migrateV9ToV10", () => {
  it("moves the five global note bindings into the default Profile", () => {
    expect(
      migrateV9ToV10({
        __VERSION__: 9,
        "citation.references-style": "apa",
        "note.literature-folder": "Law",
        "note.import-folder": "Law/Imported",
        "note.import-colored-highlights": true,
        "note.import-annotations-as-template": true,
        "note.default-profile": { document: "law.md" },
        "server.enabled": true,
      }),
    ).toEqual({
      __VERSION__: 9,
      "note.default-profile": {
        document: "law.md",
        bindings: {
          "citation.references-style": "apa",
          "note.literature-folder": "Law",
          "note.import-folder": "Law/Imported",
          "note.import-colored-highlights": true,
          "note.import-annotations-as-template": true,
        },
      },
      "server.enabled": true,
    });
  });

  it("materializes the old defaults when global overrides are absent", () => {
    expect(migrateV9ToV10({ __VERSION__: 9 })).toEqual({
      __VERSION__: 9,
      "note.default-profile": {
        bindings: {
          "citation.references-style": null,
          "note.literature-folder": "literatures",
          "note.import-folder": "zotero_notes",
          "note.import-colored-highlights": false,
          "note.import-annotations-as-template": false,
        },
      },
    });
  });

  it("preserves valid bindings when one retired global is malformed", () => {
    expect(
      migrateV9ToV10({
        __VERSION__: 9,
        "citation.references-style": "apa",
        "note.literature-folder": "Law",
        "note.import-folder": 42,
        "note.import-colored-highlights": true,
        "note.import-annotations-as-template": true,
      }),
    ).toEqual({
      __VERSION__: 9,
      "note.default-profile": {
        bindings: {
          "citation.references-style": "apa",
          "note.literature-folder": "Law",
          "note.import-folder": "zotero_notes",
          "note.import-colored-highlights": true,
          "note.import-annotations-as-template": true,
        },
      },
    });
  });

  it("returns an empty object for non-plain inputs", () => {
    expect(migrateV9ToV10(null)).toEqual({});
    expect(migrateV9ToV10(42)).toEqual({});
  });
});
