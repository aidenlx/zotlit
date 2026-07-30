import { describe, expect, it, vi } from "vitest";

import annotationSchema from "@zotlit/db/contract/annotation.schema.json?raw";
import filenameSchema from "@zotlit/db/contract/filename.schema.json?raw";
import noteSchema from "@zotlit/db/contract/note.schema.json?raw";
import { Temporal } from "@zotlit/shared/temporal";
import { TemplateError, TemplateFacade } from "@zotlit/templates/facade";

import { InertTemplateError } from "@/services/template/errors";
import { markInertPlaceholder } from "@/services/template/inert-placeholder";
import { type CompileError } from "@/services/template/service";

import {
  createTemplateWorkbenchHandlers,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_GUIDE_COMMAND,
  TEMPLATE_RENDER_COMMAND,
  TEMPLATE_SCHEMA_COMMAND,
  TEMPLATE_SOURCE_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli";
import { DIAGNOSTIC_HINTS } from "./envelope";
import { TEMPLATE_SLOT_NAMES } from "./request";
import { CONTRACT_ROOT_NAMES } from "./schema";
import { ContractMetadataError } from "./serialize";

const IDENTITY = {
  vault: { id: "Test Vault", path: "/vaults/test" },
  source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
} as const;
const NO_COMPILE_ERRORS = new Map<string, CompileError>();
const EMPTY_RENDER = () => "";
const NO_ROOT_VARIABLES = () => null;
const EMPTY_SOURCE = async () => "";

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
    });

    const output = await handlers["zotlit:template-status"]({});

    expect(callOrder).toEqual(["settled", "identity", "status"]);
    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
      command: "zotlit:template-status",
      ok: true,
      identity: IDENTITY,
      javascriptTemplatesEnabled: false,
      templates: TEMPLATE_FILES,
    });
  });

  it("returns TEMPLATE_NOT_READY when compilation does not settle", async () => {
    const getIdentity = vi.fn(() => IDENTITY);
    const getTemplateFileStatuses = vi.fn(() => TEMPLATE_FILES);
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers["zotlit:template-status"]({});

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "annotation",
      format: "json",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
      "expect-vault": "Test Vault",
      "expect-source": "a1b2c3d4",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_STATUS_COMMAND]({});

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({});

    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("test ok");
    expect(output).toContain("follow diagnostic.hint");
    for (const topic of ["data", "render", "editing", "eta", "liquid"]) {
      expect(output).toContain(topic);
    }
  });

  it.each([
    ["data", ["$helper", "$inert", "$ref", ...CONTRACT_ROOT_NAMES]],
    ["render", [...TEMPLATE_SLOT_NAMES]],
    ["editing", ["editablePath", "shadowedFiles"]],
    ["eta", ["javascriptTemplatesEnabled", "ETA_OPT_IN_REQUIRED"]],
    ["liquid", ["liquidjs", "zt", "bq"]],
  ] as const)("prints the %s guide topic", async (topic, facts) => {
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({ topic });

    expect(() => JSON.parse(output)).toThrow();
    for (const fact of facts) expect(output).toContain(fact);
  });

  it("rejects an invalid guide topic", async () => {
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_GUIDE_COMMAND]({ topic: "bogus" });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
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
    [{ key: "ITEM2345", root: "note" }, "format"],
    [{ key: "ITEM2345", root: "note", format: "yaml" }, "format"],
    [
      {
        key: "ITEM2345",
        root: "note",
        format: "json",
        "expect-vault": "true",
      },
      "expect-vault",
    ],
    [
      {
        key: "ITEM2345",
        root: "note",
        format: "json",
        "expect-source": "true",
      },
      "expect-source",
    ],
  ])("rejects an invalid selector %#", async (params, parameter) => {
    const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_DATA_COMMAND](params);

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
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

  it.each([
    ["not-found", "KEY_NOT_FOUND"],
    ["no-parent-item", "NO_PARENT_ITEM"],
    ["annotation-required", "ANNOTATION_REQUIRED"],
    ["annotation-attachment-missing", "ANNOTATION_ATTACHMENT_MISSING"],
  ] as const)("maps %s to %s", async (kind, code) => {
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_DATA_COMMAND]({
      key: "ITEM2345",
      root: "note",
      format: "json",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
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
      argument: "expect-vault",
      expected: "Wrong Vault",
      target: "vault",
      actual: "Test Vault",
    },
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
      });

      const output = await handlers[TEMPLATE_DATA_COMMAND]({
        key: "ITEM2345",
        root: "note",
        format: "json",
        [argument]: expected,
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 1,
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

  it.each([
    ["note", noteSchema],
    ["annotation", annotationSchema],
    ["filename", filenameSchema],
  ] as const)(
    "returns the bundled %s schema verbatim",
    async (root, schema) => {
      const getIdentity = vi.fn(() => IDENTITY);
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const waitUntilSettled = vi.fn(async () => "settled" as const);
      const handlers = createTemplateWorkbenchHandlers({
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
      });

      const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({ root });

      expect(output).toBe(schema);
      expect(JSON.parse(output).$id).toContain(`:v1:${root}`);
      expect(getIdentity).not.toHaveBeenCalled();
      expect(loadData).not.toHaveBeenCalled();
      expect(waitUntilSettled).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { root: "true" }, { root: "cite" }] as Record<string, string>[])(
    "rejects an invalid schema root %#",
    async (params) => {
      const handlers = createTemplateWorkbenchHandlers({
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
      });

      const output = await handlers[TEMPLATE_SCHEMA_COMMAND](params);

      expect(JSON.parse(output)).toEqual({
        contractVersion: 1,
        command: TEMPLATE_SCHEMA_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "root must be 'note', 'annotation', or 'filename'.",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "root" },
        },
      });
    },
  );

  it("rejects an item selector for template-schema", async () => {
    const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_SCHEMA_COMMAND]({
      root: "note",
      key: "ITEM2345",
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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

  it.each(["markdown", "json"] as const)(
    "renders filename through the collapsing render method for format=%s",
    async (format) => {
      const data = { title: "Paper" };
      const loadData = vi.fn(async () => ({ kind: "data", data }) as const);
      const render = vi.fn(() => "# multi\nline\n");
      const renderFilename = vi.fn(() => "Paper 2024");
      const handlers = createTemplateWorkbenchHandlers({
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
    });

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "json",
      "expect-vault": IDENTITY.vault.id,
      "expect-source": IDENTITY.source.id,
    });

    expect(JSON.parse(output)).toEqual({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "markdown",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
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
      });

      const output = await handlers[TEMPLATE_RENDER_COMMAND]({
        key: "ITEM2345",
        template: "note",
        format: "json",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: kind === "annotation-required" ? "annotation" : "note",
      format: "json",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
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
    });

    const output = await handlers[TEMPLATE_RENDER_COMMAND]({
      key: "ITEM2345",
      template: "note",
      format: "json",
      "expect-vault": "Wrong Vault",
    });

    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
      command: TEMPLATE_RENDER_COMMAND,
      ok: false,
      diagnostic: {
        code: "TARGET_MISMATCH",
        hint: DIAGNOSTIC_HINTS.TARGET_MISMATCH,
        details: { target: "vault" },
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
    [{ key: "ITEM2345", template: "note" }, "format"],
    [{ key: "ITEM2345", template: "note", format: "yaml" }, "format"],
    [
      {
        key: "ITEM2345",
        template: "note",
        format: "markdown",
        root: "note",
      },
      "root",
    ],
  ] as const)(
    "rejects an invalid render selector %#",
    async (params, parameter) => {
      const loadData = vi.fn(async () => ({ kind: "not-found" }) as const);
      const render = vi.fn(() => "");
      const handlers = createTemplateWorkbenchHandlers({
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
      });

      const output = await handlers[TEMPLATE_RENDER_COMMAND](params);

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 1,
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

  describe("template-render root-variable warnings", () => {
    it("reports a warning for a read of a root other than zt", async () => {
      const templates = new TemplateFacade();
      templates.define("note", "{{ title }}", "liquid");
      const handlers = createTemplateWorkbenchHandlers({
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
      });

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "note",
      });

      expect(JSON.parse(output)).toEqual({
        contractVersion: 1,
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
      });

      const output = await handlers[TEMPLATE_SOURCE_COMMAND]({
        template: "bogus",
      });

      expect(JSON.parse(output)).toMatchObject({
        contractVersion: 1,
        command: TEMPLATE_SOURCE_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          hint: DIAGNOSTIC_HINTS.INVALID_SELECTOR,
          details: { parameter: "template" },
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
});
