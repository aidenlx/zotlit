import { describe, expect, it } from "vitest";

import { migrateLegacyV0 } from "./migrate";

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
      "template.filename": "<%= it.title %>.md",
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
    it("extracts template.folder and template.templates.filename independently", () => {
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
        "template.filename": "F",
      });
    });

    it("drops template entirely when it is not a plain object", () => {
      expect(migrateLegacyV0({ template: null })).toEqual({});
      expect(migrateLegacyV0({ template: "Templates" })).toEqual({});
      expect(migrateLegacyV0({ template: ["a", "b"] })).toEqual({});
    });

    it("drops only the bad parts of a partially-shaped template", () => {
      expect(
        migrateLegacyV0({ template: { folder: 5, templates: "nope" } }),
      ).toEqual({});
      expect(
        migrateLegacyV0({
          template: { folder: "T", templates: { filename: 5 } },
        }),
      ).toEqual({ "template.folder": "T" });
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
