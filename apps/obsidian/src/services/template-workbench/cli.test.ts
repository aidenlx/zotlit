import { describe, expect, it, vi } from "vitest";

import { TemplateError, TemplateFacade } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { InertTemplateError } from "@/services/template/errors";
import { markInertPlaceholder } from "@/services/template/inert-placeholder";
import type { CompileError } from "@/services/template/service";

import {
  createTemplateWorkbenchHandlers,
  FRONTMATTER_EVAL_COMMAND,
  FRONTMATTER_REMOVE_COMMAND,
  FRONTMATTER_REORDER_COMMAND,
  FRONTMATTER_SET_COMMAND,
  FRONTMATTER_STATUS_COMMAND,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_GUIDE_COMMAND,
  TEMPLATE_RENDER_COMMAND,
  TEMPLATE_SCHEMA_COMMAND,
  TEMPLATE_SOURCE_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli";
import { CONTRACT_VERSION, DIAGNOSTIC_HINTS } from "./envelope";
import { TEMPLATE_SLOT_NAMES } from "./request";
import { CONTRACT_ROOT_NAMES } from "./schema";
import { ContractMetadataError } from "./serialize";

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
  {
    name: "cite",
    winner: {
      language: "eta",
      source: {
        kind: "vault",
        path: "Templates/zotlit-cite.eta.md",
      },
    },
    editablePath: "Templates/zotlit-cite.eta.md",
    shadowedFiles: [],
    inertFiles: ["Templates/zotlit-cite.eta.md"],
    compileError: "Unexpected token",
  },
  {
    name: "cite2",
    winner: {
      language: "liquid",
      source: {
        kind: "vault",
        path: "Templates/zotlit-cite2.liquid.md",
      },
    },
    editablePath: "Templates/zotlit-cite2.liquid.md",
    shadowedFiles: ["Templates/zotlit-cite2.eta.md"],
    inertFiles: [],
    compileError: "Unknown filter",
  },
] as const;

describe("Template Workbench CLI", () => {
  it("reports template and target state after compilation settles", async () => {
    const callOrder: string[] = [];
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      loadData: async () => ({ kind: "not-found" }),
      getIdentity: () => {
        callOrder.push("identity");
        return IDENTITY;
      },
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => {
          callOrder.push("status");
          return TEMPLATE_FILES;
        },
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

    const output = await handlers["zotlit:template-status"]({});

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
  });

  it("returns TEMPLATE_NOT_READY when compilation does not settle", async () => {
    const getIdentity = vi.fn(() => IDENTITY);
    const getTemplateFileStatuses = vi.fn(() => TEMPLATE_FILES);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      loadData: async () => ({ kind: "not-found" }),
      getIdentity,
      settleTimeoutMs: 25,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses,
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

    const output = await handlers["zotlit:template-status"]({});

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: "zotlit:template-status",
      ok: false,
      diagnostic: {
        code: "TEMPLATE_NOT_READY",
        message: "Template compilation did not settle within 25 ms.",
        hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
      },
    });
    expect(getIdentity).not.toHaveBeenCalled();
    expect(getTemplateFileStatuses).not.toHaveBeenCalled();
  });

  it("does not load template data before compilation settles", async () => {
    const getIdentity = vi.fn(() => IDENTITY);
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const waitUntilSettled = vi.fn(async () => "timeout" as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity,
      loadData,
      settleTimeoutMs: 25,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "annotation",
      format: "json",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_DATA_COMMAND,
      ok: false,
      request: {
        key: "ITEM2345",
        root: "annotation",
        format: "json",
      },
      identity: IDENTITY,
      diagnostic: {
        code: "TEMPLATE_NOT_READY",
        message: "Template compilation did not settle within 25 ms.",
        hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
      },
    });
    expect(waitUntilSettled).toHaveBeenCalledWith(25);
    expect(getIdentity).toHaveBeenCalledOnce();
    expect(loadData).not.toHaveBeenCalled();
  });

  it("returns serialized note-root data with identity and request facts", async () => {
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
    const loadData = vi.fn(async () => ({ kind: "data", data: root }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
      "expect-source": "a1b2c3d4",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_DATA_COMMAND,
      ok: true,
      request: {
        key: "ITEM2345",
        root: "note",
        format: "json",
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
    expect(loadData).toHaveBeenCalledWith("ITEM2345", "note");
    expect(wouldWrite).not.toHaveBeenCalled();
  });

  it("preserves a helper evaluation error in its marker", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({
        kind: "data",
        data: {
          noteLink: () => {
            throw new Error("note lookup failed");
          },
        },
      }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
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
  });

  it("names no template for a note-root data fault", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({
        kind: "data",
        data: {
          get title(): string {
            throw new Error("title lookup failed");
          },
        },
      }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
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
  });

  it("re-throws a stale contract IR instead of reporting a diagnostic", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({
        kind: "data",
        data: { notAContractMember: () => "value" },
      }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    await expect(
      handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
      }),
    ).rejects.toThrow(ContractMetadataError);
  });

  it("reports TEMPLATE_NOT_READY when template startup itself failed", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_STATUS_COMMAND]({});

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_STATUS_COMMAND,
      ok: false,
      diagnostic: {
        code: "TEMPLATE_NOT_READY",
        message: "Template compilation failed to start; check the plugin log.",
        hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
      },
    });
  });

  it("prints the quickstart and topic index as literal text", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({});

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("test ok");
    expect(output).toContain("follow diagnostic.hint");
    expect(output).toContain("expect-source=<identity.source.id>");
    expect(output).toContain("root=note and zt.annotations");
    expect(output).toContain("can be very large");
    expect(output).toContain("schemas.<root>.url");
    expect(output).toContain(
      "https://zotlit.aidenlx.site/docs/reference/templates",
    );
    expect(output).toContain("frontmatter-status");
    expect(output).toContain("frontmatter-eval");
    expect(output).toContain("frontmatter-set");
    expect(output).toContain("frontmatter-remove");
    expect(output).toContain("frontmatter-reorder");
    for (const topic of [
      "data",
      "render",
      "editing",
      "eta",
      "liquid",
      "frontmatter",
    ]) {
      expect(output).toContain(topic);
    }
  });

  it.each([
    ["data", ["$helper", "$inert", "$ref", ...CONTRACT_ROOT_NAMES]],
    ["render", [...TEMPLATE_SLOT_NAMES]],
    ["editing", ["editablePath", "shadowedFiles"]],
    [
      "eta",
      ["javascriptTemplatesEnabled", "ETA_OPT_IN_REQUIRED", "pandocCite"],
    ],
    ["liquid", ["liquidjs", "zt", "bq", "group_by", "pandoc_cite"]],
    [
      "frontmatter",
      [
        "frontmatter-status",
        "frontmatter-eval",
        "frontmatter-set",
        "frontmatter-remove",
        "frontmatter-reorder",
        "field=",
        "key=",
        "'liquid'",
        "'javascript'",
        "'replace'",
        "'append'",
        "'keep'",
        "zotero-key",
      ],
    ],
  ] as const)("prints the %s guide topic", async (topic, facts) => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({ topic });

    expect(() => JSON.parse(output)).toThrow();
    for (const fact of facts) expect(output).toContain(fact);
  });

  it("rejects an invalid guide topic", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({ topic: "bogus" });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
      command: TEMPLATE_GUIDE_COMMAND,
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
        details: { parameter: "topic" },
      },
    });
  });

  it.each([
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
  ])("rejects an invalid selector %#", async (params, parameter) => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND](params);

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
      command: TEMPLATE_DATA_COMMAND,
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
        details: { parameter },
      },
    });
    expect(loadData).not.toHaveBeenCalled();
  });

  it("defaults template-data format to json when absent", async () => {
    const loadData = vi.fn(async () => ({ kind: "data", data: {} }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      request: { key: "ITEM2345", root: "note", format: "json" },
    });
  });

  it("ignores every --* token a CLI binary forwards", async () => {
    const loadData = vi.fn(async () => ({ kind: "data", data: {} }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      "--help": "true",
      "--verbose": "true",
    });

    expect(JSON.parse(output)).toMatchObject({ ok: true });
  });

  it("reports vault= placed after the command name as INVALID_SELECTOR", async () => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
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
  });

  it("names the offending parameter and the accepted list for an unknown key", async () => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
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
  });

  it("cross-references template= to root= on template-data", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
      template: "note",
    });

    const message = JSON.parse(output).diagnostic.message as string;
    expect(message).toContain("root=");
    expect(message).toContain("template-render");
    expect(message).toContain("template-source");
  });

  it.each([
    ["not-found", "KEY_NOT_FOUND"],
    ["no-parent-item", "NO_PARENT_ITEM"],
    ["annotation-required", "ANNOTATION_REQUIRED"],
    ["annotation-attachment-missing", "ANNOTATION_ATTACHMENT_MISSING"],
  ] as const)("maps %s to %s", async (kind, code) => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
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
  });

  it.each([
    {
      argument: "expect-source",
      expected: "ffffffff",
      target: "source",
      actual: "a1b2c3d4",
    },
  ] as const)(
    "returns TARGET_MISMATCH for $argument",
    async ({ argument, expected, target, actual }) => {
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData,
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
        [argument]: expected,
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
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
    },
  );

  it("points at every published schema for the installed version", async () => {
    const getIdentity = vi.fn(() => IDENTITY);
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const waitUntilSettled = vi.fn(async () => "settled" as const);
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({});

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_SCHEMA_COMMAND,
      ok: true,
      pluginVersion: PLUGIN_VERSION,
      schemas: Object.fromEntries(
        CONTRACT_ROOT_NAMES.map((root) => [
          root,
          {
            url: `https://github.com/aidenlx/zotlit/releases/download/res-${PLUGIN_VERSION}/${root}.schema.json`,
            fileName: `zotlit-${root}-${PLUGIN_VERSION}.schema.json`,
          },
        ]),
      ),
    });
    expect(getIdentity).not.toHaveBeenCalled();
    expect(loadData).not.toHaveBeenCalled();
    expect(waitUntilSettled).not.toHaveBeenCalled();
  });

  it.each(["root", "template"])(
    "rejects a %s selector for template-schema",
    async (parameter) => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({
        [parameter]: "note",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 5,
        command: TEMPLATE_SCHEMA_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message:
            "template-schema takes no parameters; it answers with the schema of every data root, keyed by root under 'schemas'.",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter },
        },
      });
    },
  );

  it("rejects an item selector for template-schema", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({
      key: "ITEM2345",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_SCHEMA_COMMAND,
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        message: "template-schema does not accept an item selector.",
        hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
        details: { parameter: "key" },
      },
    });
  });

  it("rejects an unrecognized parameter for template-schema", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({
      "--help": "true",
      format: "json",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        details: { parameter: "format" },
      },
    });
  });

  it.each([
    ["note", "note"],
    ["content", "note"],
    ["annotation", "annotation"],
  ] as const)(
    "renders %s as byte-faithful Markdown from the %s root",
    async (template, root) => {
      const data = { title: "Paper" };
      const markdown = `# ${template}\n${"x".repeat(128 * 1024)}  \n`;
      const loadData = vi.fn(async () => ({ kind: "data", data }) as const);
      const render = vi.fn(() => markdown);
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData,
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render,
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template,
        format: "markdown",
      });

      expect(output).toBe(markdown);
      expect(loadData).toHaveBeenCalledWith("ITEM2345", root);
      expect(render).toHaveBeenCalledWith(template, data);
    },
  );

  it("reports a controlled selector diagnostic for retired Literature Note slots", async () => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const render = vi.fn(() => "");
    const getTemplateSource = vi.fn(async () => "");
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES.slice(-2),
        render,
        renderFilename: EMPTY_RENDER,
        analyzeRootVariables: NO_ROOT_VARIABLES,
        getTemplateSource,
        waitUntilSettled: async () => "settled" as const,
      },
      frontmatter: {
        read: FRONTMATTER_READ_EMPTY,
        evaluate: FRONTMATTER_EVALUATE_EMPTY,
        validateExpr: FRONTMATTER_VALIDATE_EMPTY,
        write: FRONTMATTER_WRITE_NOOP,
      },
    });

    const rendered = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "json",
    });
    const sourced = await handlers[TEMPLATE_SOURCE_COMMAND]({
      template: "annotation",
    });

    for (const output of [rendered, sourced]) {
      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "template" },
        },
      });
    }
    expect(loadData).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(getTemplateSource).not.toHaveBeenCalled();
  });

  it.each(["markdown", "json"] as const)(
    "renders filename through the collapsing render method for format=%s",
    async (format) => {
      const data = { title: "Paper" };
      const loadData = vi.fn(async () => ({ kind: "data", data }) as const);
      const render = vi.fn(() => "# multi\nline\n");
      const renderFilename = vi.fn(() => "Paper 2024");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData,
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render,
          renderFilename,
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "filename",
        format,
      });

      expect(renderFilename).toHaveBeenCalledWith(data);
      expect(render).not.toHaveBeenCalled();
      expect(format === "markdown" ? output : JSON.parse(output).markdown).toBe(
        "Paper 2024",
      );
      expect(loadData).toHaveBeenCalledWith("ITEM2345", "filename");
    },
  );

  it("wraps the same Markdown and active template identity as JSON", async () => {
    const markdown = "# Paper\n";
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render: () => markdown,
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "json",
      "expect-source": IDENTITY.source.id,
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 5,
      command: TEMPLATE_RENDER_COMMAND,
      ok: true,
      request: {
        key: "ITEM2345",
        template: "note",
        format: "json",
      },
      identity: IDENTITY,
      template: {
        name: "note",
        language: "liquid",
        source: {
          kind: "vault",
          path: "Templates/zotlit-note.liquid.md",
        },
      },
      warnings: [],
      markdown,
    });
  });

  it("renders includes through the active named-template registry", async () => {
    const templates = new TemplateFacade();
    templates.define(
      "note",
      'BEGIN\n{% render "content" with zt as zt %}\nEND',
      "liquid",
    );
    templates.define("content", "BODY {{ zt.title }}", "liquid");
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render: (name, data) => templates.render(name, data),
        renderFilename: (data) => templates.render("filename", data),
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "markdown",
    });

    expect(output).toBe("BEGIN\nBODY Paper\nEND");
  });

  it("does not load or render before template compilation settles", async () => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const render = vi.fn(() => "");
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      settleTimeoutMs: 25,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render,
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "markdown",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
      command: TEMPLATE_RENDER_COMMAND,
      ok: false,
      request: {
        key: "ITEM2345",
        template: "note",
        format: "markdown",
      },
      identity: IDENTITY,
      diagnostic: {
        code: "TEMPLATE_NOT_READY",
        message: "Template compilation did not settle within 25 ms.",
        hint: DIAGNOSTIC_HINTS.TEMPLATE_NOT_READY,
      },
    });
    expect(loadData).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: new InertTemplateError("JavaScript Templates are disabled"),
      compileErrors: NO_COMPILE_ERRORS,
      code: "ETA_OPT_IN_REQUIRED",
      message: "JavaScript Templates are disabled",
      template: "note",
    },
    {
      error: new InertTemplateError(
        "Templates/zotlit-cite.eta.md is inert",
        "cite",
      ),
      compileErrors: NO_COMPILE_ERRORS,
      code: "ETA_OPT_IN_REQUIRED",
      message: "Templates/zotlit-cite.eta.md is inert",
      template: "cite",
    },
    {
      error: new Error("note cannot compile"),
      compileErrors: new Map([["note", { message: "Unexpected token" }]]),
      code: "TEMPLATE_COMPILE_ERROR",
      message: "Unexpected token",
      template: "note",
    },
    {
      error: new TemplateError('Template "content" not found', "content"),
      compileErrors: new Map([["content", { message: "Unknown filter" }]]),
      code: "TEMPLATE_COMPILE_ERROR",
      message: "Unknown filter",
      template: "content",
    },
    {
      error: new Error("render failed"),
      compileErrors: NO_COMPILE_ERRORS,
      code: "TEMPLATE_RENDER_ERROR",
      message: "render failed",
      template: "note",
    },
    {
      error: new Error("render failed: Unknown filter"),
      compileErrors: new Map([["cite2", { message: "Unknown filter" }]]),
      code: "TEMPLATE_RENDER_ERROR",
      message: "render failed: Unknown filter",
      template: "note",
    },
  ] as const)(
    "returns $code for a render failure",
    async ({ error, compileErrors, code, message, template }) => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: () => {
            throw error;
          },
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: TEMPLATE_RENDER_COMMAND,
        ok: false,
        diagnostic: {
          code,
          message,
          hint: DIAGNOSTIC_HINTS[code],
          details: { template },
        },
      });
    },
  );

  it.each([
    ["not-found", "KEY_NOT_FOUND"],
    ["no-parent-item", "NO_PARENT_ITEM"],
    ["annotation-required", "ANNOTATION_REQUIRED"],
    ["annotation-attachment-missing", "ANNOTATION_ATTACHMENT_MISSING"],
  ] as const)("maps render data result %s to %s", async (kind, code) => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render: () => "",
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: kind === "annotation-required" ? "annotation" : "note",
      format: "json",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
      command: TEMPLATE_RENDER_COMMAND,
      ok: false,
      diagnostic: {
        code,
        hint: DIAGNOSTIC_HINTS[code],
        details: { key: "ITEM2345" },
      },
    });
  });

  it("checks target identity before loading or rendering", async () => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const render = vi.fn(() => "");
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData,
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render,
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "json",
      "expect-source": "ffffffff",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 5,
      command: TEMPLATE_RENDER_COMMAND,
      ok: false,
      diagnostic: {
        code: "TARGET_MISMATCH",
        hint: DIAGNOSTIC_HINTS.TARGET_MISMATCH,
        details: { target: "source" },
      },
    });
    expect(loadData).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    [{ template: "note", format: "markdown" }, "key"],
    [{ key: "bad", template: "note", format: "markdown" }, "key"],
    [{ key: "ITEM2345", format: "markdown" }, "template"],
    [{ key: "ITEM2345", template: "cite", format: "markdown" }, "template"],
    [{ key: "ITEM2345", template: "note", format: "yaml" }, "format"],
    [{ key: "ITEM2345", template: "note", format: "" }, "format"],
    [
      {
        key: "ITEM2345",
        template: "note",
        format: "markdown",
        root: "note",
      },
      "root",
    ],
    [
      {
        key: "ITEM2345",
        template: "note",
        format: "markdown",
        "expect-source": "",
      },
      "expect-source",
    ],
  ] as const)(
    "rejects an invalid render selector %#",
    async (params, parameter) => {
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const render = vi.fn(() => "");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData,
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render,
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND](params);

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: TEMPLATE_RENDER_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter },
        },
      });
      expect(loadData).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    },
  );

  it("keeps template-render's explicit root rejection message", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "not-found" }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "markdown",
      root: "note",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        message: "template-render infers the data root from template.",
      },
    });
  });

  it("defaults template-render format to json when absent", async () => {
    const handlers = createTemplateWorkbenchHandlers({
      pluginVersion: PLUGIN_VERSION,
      getIdentity: () => IDENTITY,
      loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
      templates: {
        javascriptTemplatesEnabled: false,
        compileErrors: NO_COMPILE_ERRORS,
        getTemplateFileStatuses: () => TEMPLATE_FILES,
        render: () => "# Paper\n",
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

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      request: { key: "ITEM2345", template: "note", format: "json" },
      markdown: "# Paper\n",
    });
  });

  describe("template-render root-variable warnings", () => {
    it("reports a warning for a read of a root other than zt", async () => {
      const templates = new TemplateFacade();
      templates.define("note", "{{ title }}", "liquid");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: (name, data) => templates.render(name, data),
          renderFilename: (data) => templates.render("filename", data),
          analyzeRootVariables: (name) => templates.analyzeRootVariables(name),
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain("'title'");
      expect(parsed.warnings[0]).toContain("zt.title");
      expect(parsed.warnings[0]).toContain("line 1");
    });

    it("reports no warnings for a template reading only zt", async () => {
      const templates = new TemplateFacade();
      templates.define("note", "{{ zt.title }}", "liquid");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: (name, data) => templates.render(name, data),
          renderFilename: (data) => templates.render("filename", data),
          analyzeRootVariables: (name) => templates.analyzeRootVariables(name),
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({ ok: true, warnings: [] });
    });

    it("leaves format=markdown byte-exact when a warning applies", async () => {
      const templates = new TemplateFacade();
      templates.define("note", "{{ zt.title }}", "liquid");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: (name, data) => templates.render(name, data),
          renderFilename: (data) => templates.render("filename", data),
          analyzeRootVariables: (name) => templates.analyzeRootVariables(name),
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "markdown",
      });

      expect(output).toBe("Paper");
    });
  });

  describe("template-source", () => {
    it("returns the winning vault file body", async () => {
      const getTemplateSource = vi.fn(async () => "vault body for note");
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "note",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 5,
        command: TEMPLATE_SOURCE_COMMAND,
        ok: true,
        identity: IDENTITY,
        template: {
          name: "note",
          language: "liquid",
          source: { kind: "vault", path: "Templates/zotlit-note.liquid.md" },
        },
        source: "vault body for note",
      });
      expect(getTemplateSource).toHaveBeenCalledWith("note");
    });

    it("returns the embedded default body when no vault file exists", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: async () => "{{ zt.title }}",
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: FRONTMATTER_READ_EMPTY,
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "annotation",
      });

      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
      expect(parsed.source).toContain("zt.");
    });

    it("rejects an unknown template name", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: TEMPLATE_SOURCE_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "template" },
        },
      });
    });

    it("cross-references root= to template= on template-source", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "note",
        root: "note",
      });

      const message = JSON.parse(output).diagnostic.message as string;
      expect(message).toContain("template=");
      expect(message).toContain("template-data");
    });
  });

  describe("template-status and template-guide selectors", () => {
    it("rejects any parameter for template-status", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_STATUS_COMMAND]({
        root: "note",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: TEMPLATE_STATUS_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "root" },
        },
      });
    });

    it("tolerates --* tokens for template-status", async () => {
      const waitUntilSettled = vi.fn(async () => "settled" as const);
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_STATUS_COMMAND]({
        "--help": "true",
      });

      expect(JSON.parse(output)).toMatchObject({ ok: true });
    });

    it("rejects an unrecognized parameter for template-guide", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[TEMPLATE_GUIDE_COMMAND]({
        root: "note",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: TEMPLATE_GUIDE_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "root" },
        },
      });
    });
  });

  describe("template fault .context excerpts", () => {
    it("surfaces a render error's caret excerpt in details.context", async () => {
      const error = new Error("Unknown filter: bogus") as Error & {
        context: string;
      };
      error.context = "1| {{ zt.title | bogus }}\n         ^^^^^";
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: () => {
            throw error;
          },
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "TEMPLATE_RENDER_ERROR",
          details: { template: "note", context: error.context },
        },
      });
    });

    it("surfaces a recorded compile error's caret excerpt in details.context", async () => {
      const context = "1| {{ zt.title\n         ^";
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: new Map([
            ["note", { message: "Unexpected token", context }],
          ]),
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: () => {
            throw new Error("note cannot compile");
          },
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

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "TEMPLATE_COMPILE_ERROR",
          message: "Unexpected token",
          details: { template: "note", context },
        },
      });
    });
  });

  describe("frontmatter-status", () => {
    const FRONTMATTER_FIELDS = [
      {
        key: "summary",
        expr: "{{ zt.title }}",
        merge: "replace",
        language: "liquid",
      },
      {
        key: "custom-js",
        expr: "return 1;",
        merge: "append",
        language: "javascript",
      },
    ] as const;

    it("reports each configured field, the reserved keys, and the gate state", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: () => ({
            fields: FRONTMATTER_FIELDS,
            inertKeys: ["custom-js"],
            javascriptTemplatesEnabled: false,
          }),
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = await handlers[FRONTMATTER_STATUS_COMMAND]({});

      expect(JSON.parse(output)).toEqual({
        contractVersion: 5,
        command: FRONTMATTER_STATUS_COMMAND,
        ok: true,
        identity: IDENTITY,
        javascriptTemplatesEnabled: false,
        fields: [
          {
            key: "summary",
            expr: "{{ zt.title }}",
            merge: "replace",
            language: "liquid",
            inert: false,
          },
          {
            key: "custom-js",
            expr: "return 1;",
            merge: "append",
            language: "javascript",
            inert: true,
          },
        ],
        reservedKeys: [
          "zotero-key",
          "zotlit-profile",
          "zotero-note-key",
          "zotero-lastmod",
        ],
      });
    });

    it("flags no field inert once the JavaScript Templates gate is on", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: true,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: () => ({
            fields: FRONTMATTER_FIELDS,
            inertKeys: [],
            javascriptTemplatesEnabled: true,
          }),
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });

      const output = await handlers[FRONTMATTER_STATUS_COMMAND]({});

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        javascriptTemplatesEnabled: true,
        fields: [
          { key: "summary", inert: false },
          { key: "custom-js", inert: false },
        ],
      });
    });

    it("rejects an unrecognized parameter", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[FRONTMATTER_STATUS_COMMAND]({
        key: "ITEM2345",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: FRONTMATTER_STATUS_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "key" },
        },
      });
    });

    it("tolerates --* tokens", async () => {
      const handlers = createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
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

      const output = await handlers[FRONTMATTER_STATUS_COMMAND]({
        "--help": "true",
      });

      expect(JSON.parse(output)).toMatchObject({ ok: true });
    });
  });

  describe("frontmatter-eval", () => {
    const NOTE_DATA = {
      indexedKey: "ITEM2345",
      citationKey: "smith2024",
      title: "A Study",
    };

    function makeHandlers(
      overrides: {
        loadData?: () => Promise<
          { kind: "data"; data: object } | { kind: "not-found" }
        >;
        javascriptTemplatesEnabled?: boolean;
        read?: () => {
          fields: readonly {
            key: string;
            expr: string;
            language: "liquid" | "javascript";
            merge: "replace" | "append" | "keep";
          }[];
          inertKeys: readonly string[];
          javascriptTemplatesEnabled: boolean;
        };
        evaluate?: (
          fields: readonly { key: string }[],
          zt: object,
        ) => {
          values: Record<string, unknown>;
          errors: Record<string, string>;
          inertKeys: readonly string[];
        };
        validateExpr?: (expr: string, language: string) => string | null;
      } = {},
    ) {
      return createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: overrides.loadData ?? (async () => ({ kind: "not-found" })),
        templates: {
          javascriptTemplatesEnabled:
            overrides.javascriptTemplatesEnabled ?? false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: overrides.read ?? FRONTMATTER_READ_EMPTY,
          evaluate: overrides.evaluate ?? FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: overrides.validateExpr ?? FRONTMATTER_VALIDATE_EMPTY,
          write: FRONTMATTER_WRITE_NOOP,
        },
      });
    }

    it("reports configured fields then system rows in YAML write order", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "data", data: NOTE_DATA }),
        read: () => ({
          fields: [
            {
              key: "summary",
              expr: "{{ zt.title }}",
              language: "liquid",
              merge: "replace",
            },
          ],
          inertKeys: [],
          javascriptTemplatesEnabled: false,
        }),
        evaluate: () => ({
          values: { summary: "A Study" },
          errors: {},
          inertKeys: [],
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 5,
        command: FRONTMATTER_EVAL_COMMAND,
        ok: true,
        request: { key: "ITEM2345", format: "json", adhoc: null },
        identity: IDENTITY,
        warnings: [],
        entries: [
          {
            key: "summary",
            value: "A Study",
            source: "user",
            language: "liquid",
            merge: "replace",
          },
          {
            key: "zotero-key",
            value: "ITEM2345",
            source: "system",
            language: null,
            merge: null,
          },
        ],
      });
    });

    it("returns only the system item key when no user fields are configured", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({
          kind: "data",
          data: { ...NOTE_DATA, citationKey: null },
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
      });

      const parsed = JSON.parse(output);
      expect(parsed.entries).toEqual([
        {
          key: "zotero-key",
          value: "ITEM2345",
          source: "system",
          language: null,
          merge: null,
        },
      ]);
    });

    it("carries a field's runtime error on its own row, evaluating siblings", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "data", data: NOTE_DATA }),
        read: () => ({
          fields: [
            {
              key: "good",
              expr: "{{ zt.title }}",
              language: "liquid",
              merge: "replace",
            },
            {
              key: "bad",
              expr: "{{ zt.missing.x }}",
              language: "liquid",
              merge: "replace",
            },
          ],
          inertKeys: [],
          javascriptTemplatesEnabled: false,
        }),
        evaluate: () => ({
          values: { good: "A Study" },
          errors: { bad: "boom" },
          inertKeys: [],
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
      });

      const parsed = JSON.parse(output);
      expect(parsed.entries).toEqual([
        {
          key: "good",
          value: "A Study",
          source: "user",
          language: "liquid",
          merge: "replace",
        },
        {
          key: "bad",
          source: "user",
          language: "liquid",
          merge: "replace",
          error: { message: "boom" },
        },
        {
          key: "zotero-key",
          value: "ITEM2345",
          source: "system",
          language: null,
          merge: null,
        },
      ]);
    });

    it("flags a javascript field inert with the gate off and warns it would fail on a real note", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "data", data: NOTE_DATA }),
        read: () => ({
          fields: [
            {
              key: "custom-js",
              expr: "return 1;",
              language: "javascript",
              merge: "replace",
            },
          ],
          inertKeys: ["custom-js"],
          javascriptTemplatesEnabled: false,
        }),
        evaluate: () => ({
          values: {},
          errors: {},
          inertKeys: ["custom-js"],
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
      });

      const parsed = JSON.parse(output);
      expect(parsed.entries[0]).toEqual({
        key: "custom-js",
        source: "user",
        language: "javascript",
        merge: "replace",
        inert: true,
      });
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain("custom-js");
      expect(parsed.warnings[0]).toContain("JavaScript Templates are disabled");
    });

    it("returns the single evaluated value for an ad-hoc expression, defaulting language to liquid", async () => {
      const validateExpr = vi.fn(() => null);
      const evaluate = vi.fn(
        (fields: readonly { key: string }[], _zt: object) => ({
          values: { [fields[0]!.key]: "Paper" },
          errors: {},
          inertKeys: [],
        }),
      );
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        validateExpr,
        evaluate,
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "zt.title",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 5,
        command: FRONTMATTER_EVAL_COMMAND,
        ok: true,
        request: {
          key: "ITEM2345",
          format: "json",
          adhoc: { expr: "zt.title", language: "liquid" },
        },
        identity: IDENTITY,
        value: "Paper",
      });
      expect(validateExpr).toHaveBeenCalledWith("zt.title", "liquid");
    });

    it("fails a non-compiling ad-hoc expression with EXPRESSION_COMPILE_ERROR", async () => {
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const handlers = makeHandlers({
        loadData,
        validateExpr: () => "Unexpected token '+'",
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "1 +",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "EXPRESSION_COMPILE_ERROR",
          message: "Unexpected token '+'",
          hint: DIAGNOSTIC_HINTS.EXPRESSION_COMPILE_ERROR,
        },
      });
      expect(loadData).not.toHaveBeenCalled();
    });

    it("rejects an ad-hoc javascript expression with the JavaScript Templates gate off", async () => {
      const validateExpr = vi.fn(() => null);
      const handlers = makeHandlers({
        javascriptTemplatesEnabled: false,
        validateExpr,
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "1",
        language: "javascript",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "ETA_OPT_IN_REQUIRED",
          hint: DIAGNOSTIC_HINTS.ETA_OPT_IN_REQUIRED,
        },
      });
      expect(validateExpr).not.toHaveBeenCalled();
    });

    it("evaluates an ad-hoc javascript expression once the gate is on", async () => {
      const handlers = makeHandlers({
        javascriptTemplatesEnabled: true,
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        validateExpr: () => null,
        evaluate: (fields) => ({
          values: { [fields[0]!.key]: 1 },
          errors: {},
          inertKeys: [],
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "1",
        language: "javascript",
      });

      expect(JSON.parse(output)).toMatchObject({ ok: true, value: 1 });
    });

    it("reports an ad-hoc expression's runtime error without failing the request", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
        validateExpr: () => null,
        evaluate: (fields) => ({
          values: {},
          errors: { [fields[0]!.key]: "boom" },
          inertKeys: [],
        }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "zt.missing.x",
      });

      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
      expect(parsed.error).toEqual({ message: "boom" });
      expect(parsed.value).toBeUndefined();
    });

    it("rejects language without expr", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        language: "liquid",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "language requires expr.",
          details: { parameter: "language" },
        },
      });
    });

    it("rejects an invalid language value", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        expr: "1",
        language: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "language" },
        },
      });
    });

    it("rejects an unrecognized parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        root: "note",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "root" },
        },
      });
    });

    it("reports the shared key-not-found diagnostic through the gated preamble", async () => {
      const handlers = makeHandlers({
        loadData: async () => ({ kind: "not-found" }),
      });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: { code: "KEY_NOT_FOUND" },
      });
    });

    it("reports a target mismatch before loading data", async () => {
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const handlers = makeHandlers({ loadData });

      const output = await handlers[FRONTMATTER_EVAL_COMMAND]({
        key: "ITEM2345",
        "expect-source": "wrong-source",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: { code: "TARGET_MISMATCH" },
      });
      expect(loadData).not.toHaveBeenCalled();
    });
  });

  describe("frontmatter-set", () => {
    const EXISTING_FIELD = {
      key: "summary",
      expr: "{{ zt.title }}",
      language: "liquid",
      merge: "append",
    } as const;

    function makeHandlers(
      overrides: {
        fields?: readonly (typeof EXISTING_FIELD)[];
        javascriptTemplatesEnabled?: boolean;
        validateExpr?: (expr: string, language: string) => string | null;
        /** Spy hook: called with the same array `write` stores, so a test can
         *  assert on it while `read()` keeps reflecting the latest write, the
         *  way the real settings service does. */
        write?: (fields: readonly { key: string }[]) => void;
      } = {},
    ) {
      let stored: readonly (typeof EXISTING_FIELD)[] = overrides.fields ?? [
        EXISTING_FIELD,
      ];
      return createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled:
            overrides.javascriptTemplatesEnabled ?? false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: () => ({
            fields: stored,
            inertKeys: [],
            javascriptTemplatesEnabled:
              overrides.javascriptTemplatesEnabled ?? false,
          }),
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: overrides.validateExpr ?? FRONTMATTER_VALIDATE_EMPTY,
          write: (fields) => {
            stored = fields as readonly (typeof EXISTING_FIELD)[];
            overrides.write?.(fields);
          },
        },
      });
    }

    it("adds a new field, defaulting omitted language and merge", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "word-count",
        expr: "{{ zt.title | size }}",
      });

      expect(write).toHaveBeenCalledWith([
        EXISTING_FIELD,
        {
          key: "word-count",
          expr: "{{ zt.title | size }}",
          language: "liquid",
          merge: "replace",
        },
      ]);
      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: FRONTMATTER_SET_COMMAND,
        ok: true,
        identity: IDENTITY,
        request: { field: "word-count", expr: "{{ zt.title | size }}" },
        fields: [
          { key: "summary", inert: false },
          {
            key: "word-count",
            expr: "{{ zt.title | size }}",
            language: "liquid",
            merge: "replace",
            inert: false,
          },
        ],
      });
    });

    it("patches an existing field, keeping its current language and merge", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        expr: "{{ zt.title | upcase }}",
      });

      expect(write).toHaveBeenCalledWith([
        {
          key: "summary",
          expr: "{{ zt.title | upcase }}",
          language: "liquid",
          merge: "append",
        },
      ]);
      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        fields: [
          {
            key: "summary",
            expr: "{{ zt.title | upcase }}",
            language: "liquid",
            merge: "append",
          },
        ],
      });
    });

    it("patches an existing field's merge strategy alone, keeping its expr", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        merge: "keep",
      });

      expect(write).toHaveBeenCalledWith([
        {
          key: "summary",
          expr: "{{ zt.title }}",
          language: "liquid",
          merge: "keep",
        },
      ]);
      expect(JSON.parse(output)).toMatchObject({ ok: true });
    });

    it("rejects a reserved key without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "zotero-key",
        expr: "anything",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        request: { field: "zotero-key", expr: "anything" },
        identity: IDENTITY,
        diagnostic: {
          code: "RESERVED_KEY",
          hint: DIAGNOSTIC_HINTS.RESERVED_KEY,
          details: { key: "zotero-key" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects a bare field flag", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "field requires a value.",
          details: { parameter: "field" },
        },
      });
    });

    it("rejects a missing field parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        expr: "anything",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "field" },
        },
      });
    });

    it("rejects a whitespace-only field", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "   ",
        expr: "x",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "field must not be empty.",
          details: { parameter: "field" },
        },
      });
    });

    it("rejects a new field with no expr", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "word-count",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        request: { field: "word-count" },
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "expr is required for a new field.",
          details: { parameter: "expr" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects a bare expr flag", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        expr: "",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "expr requires a value.",
          details: { parameter: "expr" },
        },
      });
    });

    it("rejects a whitespace-only expr", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        expr: "   ",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "expr must not be empty.",
          details: { parameter: "expr" },
        },
      });
    });

    it("rejects an invalid language value", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        language: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "language" },
        },
      });
    });

    it("rejects an invalid merge value", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        merge: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "merge" },
        },
      });
    });

    it("rejects a non-compiling expression without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({
        write,
        validateExpr: () => "Unexpected token '+'",
      });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        expr: "{{ zt.title + }}",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "EXPRESSION_COMPILE_ERROR",
          message: "Unexpected token '+'",
          hint: DIAGNOSTIC_HINTS.EXPRESSION_COMPILE_ERROR,
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects writing a javascript field while the gate is off", async () => {
      const write = vi.fn();
      const validateExpr = vi.fn();
      const handlers = makeHandlers({
        write,
        validateExpr,
        javascriptTemplatesEnabled: false,
      });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "word-count",
        expr: "return 1;",
        language: "javascript",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "ETA_OPT_IN_REQUIRED",
          hint: DIAGNOSTIC_HINTS.ETA_OPT_IN_REQUIRED,
        },
      });
      expect(validateExpr).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("writes a javascript field once the gate is on", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({
        write,
        javascriptTemplatesEnabled: true,
      });

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "word-count",
        expr: "return 1;",
        language: "javascript",
      });

      expect(write).toHaveBeenCalledWith([
        EXISTING_FIELD,
        {
          key: "word-count",
          expr: "return 1;",
          language: "javascript",
          merge: "replace",
        },
      ]);
      expect(JSON.parse(output)).toMatchObject({ ok: true });
    });

    it("rejects an unrecognized parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "summary",
        expr: "x",
        key: "ITEM2345",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "key" },
        },
      });
    });

    it("echoes the field list read back after the write, inert flags included", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_SET_COMMAND]({
        field: "word-count",
        expr: "{{ zt.title | size }}",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        fields: [
          { key: "summary", inert: false },
          { key: "word-count", inert: false },
        ],
      });
    });
  });

  describe("frontmatter-remove", () => {
    const FIELD_A = {
      key: "summary",
      expr: "{{ zt.title }}",
      language: "liquid",
      merge: "append",
    } as const;
    const FIELD_B = {
      key: "word-count",
      expr: "{{ zt.title | size }}",
      language: "liquid",
      merge: "replace",
    } as const;

    function makeHandlers(
      overrides: {
        fields?: readonly FrontmatterField[];
        write?: (fields: readonly { key: string }[]) => void;
      } = {},
    ) {
      let stored: readonly FrontmatterField[] = overrides.fields ?? [
        FIELD_A,
        FIELD_B,
      ];
      return createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: () => ({
            fields: stored,
            inertKeys: [],
            javascriptTemplatesEnabled: false,
          }),
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: (fields) => {
            stored = fields as readonly FrontmatterField[];
            overrides.write?.(fields);
          },
        },
      });
    }

    it("deletes the named field, persisting through the settings service", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "summary",
      });

      expect(write).toHaveBeenCalledWith([FIELD_B]);
      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: FRONTMATTER_REMOVE_COMMAND,
        ok: true,
        identity: IDENTITY,
        request: { field: "summary" },
        fields: [{ key: "word-count", inert: false }],
      });
    });

    it("deletes a shipped default field", async () => {
      const DEFAULT_FIELD = {
        key: "citation-count",
        expr: "0",
        language: "liquid",
        merge: "keep",
      } as const;
      const write = vi.fn();
      const handlers = makeHandlers({ fields: [DEFAULT_FIELD], write });

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "citation-count",
      });

      expect(write).toHaveBeenCalledWith([]);
      expect(JSON.parse(output)).toMatchObject({ ok: true, fields: [] });
    });

    it("rejects a key that is not configured, without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "not-configured",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        request: { field: "not-configured" },
        identity: IDENTITY,
        diagnostic: {
          code: "FIELD_NOT_FOUND",
          hint: DIAGNOSTIC_HINTS.FIELD_NOT_FOUND,
          details: { key: "not-configured" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects a missing field parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({});

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "field" },
        },
      });
    });

    it("rejects a bare field flag", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "field requires a value.",
          details: { parameter: "field" },
        },
      });
    });

    it("rejects a whitespace-only field", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "   ",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "field must not be empty.",
          details: { parameter: "field" },
        },
      });
    });

    it("rejects an unrecognized parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REMOVE_COMMAND]({
        field: "summary",
        expr: "x",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "expr" },
        },
      });
    });
  });

  describe("frontmatter-reorder", () => {
    const FIELD_A = {
      key: "summary",
      expr: "{{ zt.title }}",
      language: "liquid",
      merge: "append",
    } as const;
    const FIELD_B = {
      key: "word-count",
      expr: "{{ zt.title | size }}",
      language: "liquid",
      merge: "replace",
    } as const;
    const FIELD_C = {
      key: "tags",
      expr: "{{ zt.tags }}",
      language: "liquid",
      merge: "keep",
    } as const;

    function makeHandlers(
      overrides: {
        fields?: readonly FrontmatterField[];
        write?: (fields: readonly { key: string }[]) => void;
      } = {},
    ) {
      let stored: readonly FrontmatterField[] = overrides.fields ?? [
        FIELD_A,
        FIELD_B,
        FIELD_C,
      ];
      return createTemplateWorkbenchHandlers({
        pluginVersion: PLUGIN_VERSION,
        getIdentity: () => IDENTITY,
        loadData: async () => ({ kind: "not-found" }),
        templates: {
          javascriptTemplatesEnabled: false,
          compileErrors: NO_COMPILE_ERRORS,
          getTemplateFileStatuses: () => TEMPLATE_FILES,
          render: EMPTY_RENDER,
          renderFilename: EMPTY_RENDER,
          analyzeRootVariables: NO_ROOT_VARIABLES,
          getTemplateSource: EMPTY_SOURCE,
          waitUntilSettled: async () => "settled" as const,
        },
        frontmatter: {
          read: () => ({
            fields: stored,
            inertKeys: [],
            javascriptTemplatesEnabled: false,
          }),
          evaluate: FRONTMATTER_EVALUATE_EMPTY,
          validateExpr: FRONTMATTER_VALIDATE_EMPTY,
          write: (fields) => {
            stored = fields as readonly FrontmatterField[];
            overrides.write?.(fields);
          },
        },
      });
    }

    it("arranges the configured fields into the given order", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "tags,summary,word-count",
      });

      expect(write).toHaveBeenCalledWith([FIELD_C, FIELD_A, FIELD_B]);
      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 5,
        command: FRONTMATTER_REORDER_COMMAND,
        ok: true,
        identity: IDENTITY,
        request: { order: ["tags", "summary", "word-count"] },
        fields: [{ key: "tags" }, { key: "summary" }, { key: "word-count" }],
      });
    });

    it("trims whitespace around each key in order", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: " tags , summary , word-count ",
      });

      expect(write).toHaveBeenCalledWith([FIELD_C, FIELD_A, FIELD_B]);
      expect(JSON.parse(output)).toMatchObject({ ok: true });
    });

    it("rejects a key that is not configured, without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "summary,word-count,not-configured",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "FIELD_NOT_FOUND",
          hint: DIAGNOSTIC_HINTS.FIELD_NOT_FOUND,
          details: { key: "not-configured" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects an order missing a configured key, without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "summary,word-count",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "order is missing configured key 'tags'.",
          details: { parameter: "order" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects an order that repeats a key, without writing", async () => {
      const write = vi.fn();
      const handlers = makeHandlers({ write });

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "summary,summary,word-count,tags",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "order lists 'summary' more than once.",
          details: { parameter: "order" },
        },
      });
      expect(write).not.toHaveBeenCalled();
    });

    it("rejects a missing order parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({});

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "order" },
        },
      });
    });

    it("rejects a bare order flag", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message: "order requires a value.",
          details: { parameter: "order" },
        },
      });
    });

    it("rejects an order with an empty entry", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "summary,,word-count",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          message:
            "order must be a comma-separated list of field keys, with no empty entries.",
          details: { parameter: "order" },
        },
      });
    });

    it("rejects an unrecognized parameter", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "summary,word-count,tags",
        key: "ITEM2345",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "key" },
        },
      });
    });

    it("echoes the resulting field list, order verifying the reorder", async () => {
      const handlers = makeHandlers();

      const output = await handlers[FRONTMATTER_REORDER_COMMAND]({
        order: "word-count,tags,summary",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        fields: [{ key: "word-count" }, { key: "tags" }, { key: "summary" }],
      });
    });
  });
});
