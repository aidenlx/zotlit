import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, vi } from "vitest";

import {
  ContractMetadataError,
  markInertPlaceholder,
} from "@zotlit/workbench/explorer";

import type { CompileError } from "@/services/template/service";

import {
  createTemplateWorkbenchHandlers,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_GUIDE_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli";
import { CONTRACT_VERSION, DIAGNOSTIC_HINTS } from "./envelope";

const PLUGIN_VERSION = "1.2.3";
const IDENTITY = {
  vault: { name: "Test Vault", path: "/vaults/test" },
  source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
} as const;
const NO_COMPILE_ERRORS = new Map<string, CompileError>();
const EMPTY_RENDER = () => "";
const NO_ROOT_VARIABLES = () => null;
const EMPTY_SOURCE = async () => "";
const FRONTMATTER_READ_EMPTY = () => ({
  fields: [],
  inertKeys: [],
  javascriptTemplatesEnabled: false,
});
const FRONTMATTER_EVALUATE_EMPTY = () => ({
  values: {},
  errors: {},
  inertKeys: [],
});
const FRONTMATTER_VALIDATE_EMPTY = () => null;
const FRONTMATTER_WRITE_NOOP = () => {};
/** The Citation Template status while the vault holds no `zotlit-citation.md`. */
const BUILT_IN_CITATION_STATUS = () => ({
  path: "Templates/zotlit-citation.md",
  customized: false,
  language: "liquid" as const,
  inertPath: null,
  compileError: null,
});
const NO_CITATION = () => Effect.succeed({ kind: "not-found" } as const);

const TEMPLATE_FILES = [
  {
    name: "filename",
    winner: {
      language: "liquid",
      source: { kind: "embedded-default" },
    },
    editablePath: "Templates/zotlit-filename.liquid.md",
    shadowedFiles: [],
    inertFiles: [],
    compileError: null,
  },
  {
    name: "note",
    winner: {
      language: "liquid",
      source: {
        kind: "vault",
        path: "Templates/zotlit-note.liquid.md",
      },
    },
    editablePath: "Templates/zotlit-note.liquid.md",
    shadowedFiles: ["Templates/zotlit-note.eta.md"],
    inertFiles: [],
    compileError: null,
  },
  {
    name: "annotation",
    winner: {
      language: "liquid",
      source: { kind: "embedded-default" },
    },
    editablePath: "Templates/zotlit-annotation.liquid.md",
    shadowedFiles: [],
    inertFiles: [],
    compileError: null,
  },
  {
    name: "content",
    winner: {
      language: "liquid",
      source: { kind: "embedded-default" },
    },
    editablePath: "Templates/zotlit-content.liquid.md",
    shadowedFiles: [],
    inertFiles: [],
    compileError: null,
  },
] as const;

describe("Template Workbench CLI", () => {
  it.effect("reports template and target state after compilation settles", () =>
    Effect.gen(function* () {
      const callOrder: string[] = [];
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        loadCitation: NO_CITATION,
        loadData: () => Effect.succeed({ kind: "not-found" }),
        getIdentity: () => {
          callOrder.push("identity");
          return IDENTITY;
        },
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => {
            callOrder.push("status");
            return TEMPLATE_FILES;
          },
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => {
            callOrder.push("settled");
            return "settled";
          },
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers["zotlit:template-status"]({});

      expect(callOrder).toEqual(["settled", "identity", "status"]);
      expect(JSON.parse(output)).toEqual({
        // The Workbench's own CLI Contract stamps the envelope (ADR 0026); the
        // sibling cases pin its value.
        contractVersion: CONTRACT_VERSION,
        command: "zotlit:template-status",
        ok: true,
        pluginVersion: PLUGIN_VERSION,
        identity: IDENTITY,
        javascriptTemplatesEnabled: false,
        templates: TEMPLATE_FILES,
      });
    }),
  );

  it.effect("returns TEMPLATE_NOT_READY when compilation does not settle", () =>
    Effect.gen(function* () {
      const getIdentity = vi.fn(() => IDENTITY);
      const getTemplateFileStatuses = vi.fn(() => TEMPLATE_FILES);
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        loadCitation: NO_CITATION,
        loadData: () => Effect.succeed({ kind: "not-found" }),
        getIdentity,
        settleTimeoutMs: 25,
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "timeout" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers["zotlit:template-status"]({});

      expect(JSON.parse(output)).toEqual({
        contractVersion: 8,
        command: "zotlit:template-status",
        ok: false,
        diagnostic: expect.objectContaining({
          code: "TEMPLATE_NOT_READY",
          message: "Template compilation did not settle within 25 ms.",
          hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
          severity: "error",
        }),
      });
      expect(getIdentity).not.toHaveBeenCalled();
      expect(getTemplateFileStatuses).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not load template data before compilation settles", () =>
    Effect.gen(function* () {
      const getIdentity = vi.fn(() => IDENTITY);
      const loadData = vi.fn(() =>
        Effect.succeed({ kind: "not-found" } as const),
      );
      const waitUntilSettled = vi.fn(async () => "timeout" as const);
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity,
        loadCitation: NO_CITATION,
        loadData,
        settleTimeoutMs: 25,
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "annotation",
        format: "json",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 8,
        command: TEMPLATE_DATA_COMMAND,
        ok: false,
        request: {
          key: "ITEM2345",
          root: "annotation",
          format: "json",
        },
        identity: IDENTITY,
        diagnostic: expect.objectContaining({
          code: "TEMPLATE_NOT_READY",
          message: "Template compilation did not settle within 25 ms.",
          hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
          severity: "error",
        }),
      });
      expect(waitUntilSettled).toHaveBeenCalledWith(25);
      expect(getIdentity).toHaveBeenCalledOnce();
      expect(loadData).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "returns serialized note-root data with identity and request facts",
    () =>
      Effect.gen(function* () {
        const wouldWrite = vi.fn();
        const root: Record<string, unknown> = {
          indexedKey: "ITEM2345",
          dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
          get title() {
            return "Paper";
          },
          noteLink: () => "[[Paper]]",
          importChildNote: markInertPlaceholder(() => {
            wouldWrite();
            return "[[Imported]]";
          }, "Child note is not imported"),
        };
        root.annotations = [{ parentItem: root }];
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "data", data: root } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
          key: "ITEM2345",
          root: "note",
          format: "json",
          "expect-source": "a1b2c3d4",
          full: "true",
        });

        expect(JSON.parse(output)).toEqual({
          contractVersion: 8,
          command: TEMPLATE_DATA_COMMAND,
          ok: true,
          selection: { key: "ITEM2345", root: "note" },
          request: {
            key: "ITEM2345",
            root: "note",
            format: "json",
            full: true,
          },
          identity: IDENTITY,
          zt: {
            indexedKey: "ITEM2345",
            dateAdded: "2024-01-15T10:00:00Z",
            title: "Paper",
            noteLink: {
              $helper: "noteLink",
              signature: "(alias?: string, subpath?: string) => string | null",
              value: "[[Paper]]",
            },
            importChildNote: {
              $inert: "Child note is not imported",
            },
            annotations: [{ parentItem: { $ref: "zt" } }],
          },
        });
        expect(loadData).toHaveBeenCalledWith("ITEM2345", "note", undefined);
        expect(wouldWrite).not.toHaveBeenCalled();
      }),
  );

  it.effect("preserves a helper evaluation error in its marker", () =>
    Effect.gen(function* () {
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData: () =>
          Effect.succeed({
            kind: "data",
            data: {
              noteLink: () => {
                throw new Error("note lookup failed");
              },
            },
          }),
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
        full: "true",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        zt: {
          noteLink: {
            $helper: "noteLink",
            value: null,
            error: "note lookup failed",
          },
        },
      });
    }),
  );

  it.effect("names no template for a note-root data fault", () =>
    Effect.gen(function* () {
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData: () =>
          Effect.succeed({
            kind: "data",
            data: {
              get title(): string {
                throw new Error("title lookup failed");
              },
            },
          }),
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
        full: "true",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "TEMPLATE_RENDER_ERROR",
          message: "title lookup failed",
          hint: DIAGNOSTIC_HINTS.TEMPLATE_RENDER_ERROR,
        },
      });
      expect(JSON.parse(output).diagnostic).not.toHaveProperty("details");
    }),
  );

  it.effect(
    "re-throws a stale contract IR instead of reporting a diagnostic",
    () =>
      Effect.gen(function* () {
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData: () =>
            Effect.succeed({
              kind: "data",
              data: { notAContractMember: () => "value" },
            }),
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const exit = yield* Effect.exit(
          handlers[TEMPLATE_DATA_COMMAND]({
            key: "ITEM2345",
            root: "note",
            format: "json",
            full: "true",
          }),
        );
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
          ContractMetadataError,
        );
      }),
  );

  it.effect(
    "reports TEMPLATE_NOT_READY when template startup itself failed",
    () =>
      Effect.gen(function* () {
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData: () => Effect.succeed({ kind: "not-found" }),
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "init-failed" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_STATUS_COMMAND]({});

        expect(JSON.parse(output)).toEqual({
          contractVersion: 8,
          command: TEMPLATE_STATUS_COMMAND,
          ok: false,
          diagnostic: expect.objectContaining({
            code: "TEMPLATE_NOT_READY",
            message:
              "Template compilation failed to start; check the plugin log.",
            hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
            severity: "error",
          }),
        });
      }),
  );

  it.effect("rejects an invalid guide topic", () =>
    Effect.gen(function* () {
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData: () => Effect.succeed({ kind: "not-found" }),
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_GUIDE_COMMAND]({
        topic: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 8,
        command: TEMPLATE_GUIDE_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "topic" },
        },
      });
    }),
  );

  it.effect.each([
    [{ root: "note", format: "json" }, "key"],
    [{ key: "bad", root: "note", format: "json" }, "key"],
    [{ key: "ITEM2345", format: "json" }, "root"],
    [{ key: "ITEM2345", root: "cite", format: "json" }, "root"],
    [{ key: "ITEM2345", root: "note", format: "yaml" }, "format"],
    [{ key: "ITEM2345", root: "note", format: "" }, "format"],
    [{ key: "", root: "note", format: "json" }, "key"],
    [{ key: "ITEM2345", root: "", format: "json" }, "root"],
    [
      {
        key: "ITEM2345",
        root: "note",
        format: "json",
        "expect-source": "true",
      },
      "expect-source",
    ],
    [
      {
        key: "ITEM2345",
        root: "note",
        format: "json",
        "expect-source": "",
      },
      "expect-source",
    ],
    [
      { key: "ITEM2345", root: "note", format: "json", template: "note" },
      "template",
    ],
    [{ key: "ITEM2345", root: "note", format: "json", topic: "data" }, "topic"],
  ] satisfies [Record<string, string>, string][])(
    "rejects an invalid selector %#",
    ([params, parameter]) =>
      Effect.gen(function* () {
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "not-found" } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND](params);

        expect(JSON.parse(output)).toMatchObject({
          contractVersion: 8,
          command: TEMPLATE_DATA_COMMAND,
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
            details: { parameter },
          },
        });
        expect(loadData).not.toHaveBeenCalled();
      }),
  );

  it.effect("defaults template-data format to json when absent", () =>
    Effect.gen(function* () {
      const loadData = vi.fn(() =>
        Effect.succeed({ kind: "data", data: {} } as const),
      );
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData,
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        request: { key: "ITEM2345", root: "note", format: "json" },
      });
    }),
  );

  it.effect(
    "rejects a --* token, and gives the name=value form of an accepted parameter",
    () =>
      Effect.gen(function* () {
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "data", data: {} } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
          key: "ITEM2345",
          root: "note",
          "--path": "zt.title",
        });

        expect(JSON.parse(output)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message: "Parameter '--path' is not valid: use path=<value>.",
            details: { parameter: "--path" },
          },
        });
        expect(loadData).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "reports vault= placed after the command name as INVALID_SELECTOR",
    () =>
      Effect.gen(function* () {
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "not-found" } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
          key: "ITEM2345",
          root: "note",
          format: "json",
          vault: "Other Vault",
        });

        expect(JSON.parse(output)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message: expect.stringContaining(
              "vault must come before the command name",
            ),
            details: { parameter: "vault" },
          },
        });
        expect(loadData).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "names the offending parameter and the accepted list for an unknown key",
    () =>
      Effect.gen(function* () {
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "not-found" } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
          key: "ITEM2345",
          root: "note",
          format: "json",
          "expect-vault": "some-vault",
        });

        expect(JSON.parse(output)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message: expect.stringContaining("expect-vault"),
            details: { parameter: "expect-vault" },
          },
        });
        const message = JSON.parse(output).diagnostic.message as string;
        for (const accepted of ["key", "root", "format", "expect-source"]) {
          expect(message).toContain(accepted);
        }
      }),
  );

  it.effect("cross-references template= to root= on template-data", () =>
    Effect.gen(function* () {
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData: () => Effect.succeed({ kind: "not-found" }),
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
        template: "note",
      });

      const message = JSON.parse(output).diagnostic.message as string;
      expect(message).toContain("root=");
      expect(message).toContain("template-render");
      expect(message).toContain("template-source");
    }),
  );

  it.effect.each([
    ["not-found", "KEY_NOT_FOUND"],
    ["no-parent-item", "NO_PARENT_ITEM"],
    ["annotation-required", "ANNOTATION_REQUIRED"],
    ["annotation-attachment-missing", "ANNOTATION_ATTACHMENT_MISSING"],
  ] as const)("maps %s to %s", ([kind, code]) =>
    Effect.gen(function* () {
      const handlers = createTemplateWorkbenchHandlers({
        selectNote: noNoteSelection,
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadCitation: NO_CITATION,
        loadData: () => Effect.succeed({ kind }),
        templates: {
          getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
          renderCitationData: EMPTY_RENDER,
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          getPartialDocument: () => null,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 8,
        command: TEMPLATE_DATA_COMMAND,
        ok: false,
        request: { key: "ITEM2345", root: "note", format: "json" },
        identity: IDENTITY,
        diagnostic: {
          code,
          hint: DIAGNOSTIC_HINTS[code],
          details: { key: "ITEM2345" },
        },
      });
    }),
  );

  it.effect.each([
    {
      argument: "expect-source",
      expected: "ffffffff",
      target: "source",
      actual: "a1b2c3d4",
    },
  ] as const)(
    "returns TARGET_MISMATCH for $argument",
    ({ argument, expected, target, actual }) =>
      Effect.gen(function* () {
        const loadData = vi.fn(() =>
          Effect.succeed({ kind: "not-found" } as const),
        );
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData,
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_DATA_COMMAND]({
          key: "ITEM2345",
          root: "note",
          format: "json",
          [argument]: expected,
        });

        expect(JSON.parse(output)).toMatchObject({
          contractVersion: 8,
          command: TEMPLATE_DATA_COMMAND,
          ok: false,
          identity: IDENTITY,
          diagnostic: {
            code: "TARGET_MISMATCH",
            hint: DIAGNOSTIC_HINTS.TARGET_MISMATCH,
            details: { target, expected, actual },
          },
        });
        expect(loadData).not.toHaveBeenCalled();
      }),
  );

  describe("template-status and template-guide selectors", () => {
    it.effect("rejects any parameter for template-status", () =>
      Effect.gen(function* () {
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData: () => Effect.succeed({ kind: "not-found" }),
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_STATUS_COMMAND]({
          root: "note",
        });

        expect(JSON.parse(output)).toMatchObject({
          contractVersion: 8,
          command: TEMPLATE_STATUS_COMMAND,
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "root" },
          },
        });
      }),
    );

    it.effect("rejects a --* token for template-status", () =>
      Effect.gen(function* () {
        const waitUntilSettled = vi.fn(async () => "settled" as const);
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData: () => Effect.succeed({ kind: "not-found" }),
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_STATUS_COMMAND]({
          "--help": "true",
        });

        expect(JSON.parse(output)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "--help" },
          },
        });
      }),
    );

    it.effect("rejects an unrecognized parameter for template-guide", () =>
      Effect.gen(function* () {
        const handlers = createTemplateWorkbenchHandlers({
          selectNote: noNoteSelection,
          pluginVersion: PLUGIN_VERSION,
          getIdentity: () => IDENTITY,
          loadCitation: NO_CITATION,
          loadData: () => Effect.succeed({ kind: "not-found" }),
          templates: {
            getCitationTemplateStatus: BUILT_IN_CITATION_STATUS,
            renderCitationData: EMPTY_RENDER,
            javascriptTemplatesEnabled: false,
            compileErrors: NO_COMPILE_ERRORS,
            getTemplateFileStatuses: () => TEMPLATE_FILES,
            getPartialDocument: () => null,
            render: EMPTY_RENDER,
            renderFilename: EMPTY_RENDER,
            analyzeRootVariables: NO_ROOT_VARIABLES,
            getTemplateSource: EMPTY_SOURCE,
            waitUntilSettled: async () => "settled" as const,
          },
          frontmatter: {
            read: FRONTMATTER_READ_EMPTY,
            evaluate: FRONTMATTER_EVALUATE_EMPTY,
            validateExpr: FRONTMATTER_VALIDATE_EMPTY,
            write: FRONTMATTER_WRITE_NOOP,
          },
        });

        const output = yield* handlers[TEMPLATE_GUIDE_COMMAND]({
          root: "note",
        });

        expect(JSON.parse(output)).toMatchObject({
          contractVersion: 8,
          command: TEMPLATE_GUIDE_COMMAND,
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "root" },
          },
        });
      }),
    );
  });
});

function noNoteSelection() {
  return Promise.resolve({ error: "TARGET_NOT_FOUND" as const, matches: [] });
}
