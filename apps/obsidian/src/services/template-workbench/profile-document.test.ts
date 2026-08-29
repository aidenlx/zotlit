import { describe, expect, it, vi } from "vitest";

import { LiteratureNoteTemplateError } from "@zotlit/templates/facade";

import { InertTemplateError } from "@/services/template/errors";

import {
  createTemplateWorkbenchHandlers,
  TEMPLATE_DOCUMENT_RENDER_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli";
import { DIAGNOSTIC_HINTS } from "./envelope";

const IDENTITY = {
  vault: { name: "Test Vault", path: "/vaults/test" },
  source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
} as const;

const BOOKS_ID = "36c4f8b4-4f65-4cab-8c51-c921ea616cc8";

function makeHandlers(options?: {
  renderSource?: (
    source: string,
    data: object,
  ) => {
    create: string;
    update: string | null;
  };
}) {
  const readProfiles = vi.fn(() => ({
    defaultProfile: { document: "default.md" },
    profiles: [{ id: BOOKS_ID, label: "Books", document: "books.md" }],
  }));
  const getDocumentStatuses = vi.fn(() => [
    {
      reference: "default.md",
      path: "templates/default.md",
      validation: {
        state: "valid" as const,
        manifest: {
          id: "default",
          name: "Default",
          version: "1.0.0",
          author: "ZotLit",
          description: "Default",
          contract: 2,
          filename: "{{ zt.citekey }}",
          profileDefaults: {},
          language: "liquid" as const,
        },
        hasManagedBlock: true,
      },
    },
  ]);
  const renderSource = vi.fn(
    options?.renderSource ??
      (() => ({ create: "# Paper\nmanaged", update: "managed" })),
  );
  const getDocument = vi.fn((reference: string) =>
    reference === "default.md"
      ? {
          reference,
          path: "templates/default.md",
          renderForCreate: () => "# Paper\nmanaged",
          renderForUpdate: () => "managed",
        }
      : undefined,
  );
  const handlers = createTemplateWorkbenchHandlers({
    pluginVersion: "1.2.3",
    getIdentity: () => IDENTITY,
    loadData: async () => ({ kind: "data", data: { title: "Paper" } }),
    templates: {
      javascriptTemplatesEnabled: false,
      compileErrors: new Map(),
      getTemplateFileStatuses: () => [],
      render: () => "",
      renderFilename: () => "",
      analyzeRootVariables: () => null,
      getTemplateSource: async () => "",
      waitUntilSettled: async () => "settled" as const,
    },
    frontmatter: {
      read: () => ({
        fields: [],
        inertKeys: [],
        javascriptTemplatesEnabled: false,
      }),
      evaluate: () => ({ values: {}, errors: {}, inertKeys: [] }),
      validateExpr: () => null,
      write: () => {},
    },
    literatureNotes: {
      readProfiles,
      getDocumentStatuses,
      getDocument,
      renderSource,
    },
  });
  return {
    getDocument,
    getDocumentStatuses,
    handlers,
    readProfiles,
    renderSource,
  };
}

describe("Template Workbench Profile documents", () => {
  it("reports Profiles, their references, and missing document validation", async () => {
    const { handlers } = makeHandlers();

    const output = await handlers[TEMPLATE_STATUS_COMMAND]({});

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      profiles: [
        { id: "default", label: "Default", document: "default.md" },
        { id: BOOKS_ID, label: "Books", document: "books.md" },
      ],
      documents: [
        {
          reference: "books.md",
          path: null,
          validation: {
            state: "missing",
            diagnostic: {
              code: "DOCUMENT_NOT_FOUND",
              hint: DIAGNOSTIC_HINTS.DOCUMENT_NOT_FOUND,
            },
          },
        },
        {
          reference: "default.md",
          path: "templates/default.md",
          validation: { state: "valid", hasManagedBlock: true },
        },
      ],
    });
  });

  it("renders an uninstalled source override against real item data without writes", async () => {
    const { handlers, getDocument, renderSource } = makeHandlers();
    const source = "---\nid: draft\n---\n# {{ zt.title }}";

    const output = await handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
      key: "ITEM2345",
      source,
      "expect-source": IDENTITY.source.id,
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      request: { key: "ITEM2345", source },
      render: { create: "# Paper\nmanaged", update: "managed" },
    });
    expect(renderSource).toHaveBeenCalledWith(source, { title: "Paper" });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing document",
      params: { key: "ITEM2345", document: "missing.md" },
      code: "DOCUMENT_NOT_FOUND",
    },
    {
      name: "unknown Profile stamp",
      params: {
        key: "ITEM2345",
        profile: "3e04e240-fd92-452a-9a54-02bc8f78a816",
      },
      code: "UNKNOWN_PROFILE_STAMP",
    },
  ])("reports $name with its recovery hint", async ({ params, code }) => {
    const { handlers } = makeHandlers();
    const cliParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) cliParams[key] = value;
    }

    const output = await handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND](cliParams);

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code,
        hint: DIAGNOSTIC_HINTS[code as keyof typeof DIAGNOSTIC_HINTS],
      },
    });
  });

  it("prints an unresolved --profile argument verbatim instead of falling back to the default", async () => {
    const { handlers } = makeHandlers();

    const output = await handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
      key: "ITEM2345",
      profile: "nope",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "UNKNOWN_PROFILE_STAMP",
        message: "No Literature Note Profile has the stamped ID 'nope'.",
      },
    });
  });

  it.each([
    {
      name: "duplicate Managed Block",
      error: new LiteratureNoteTemplateError(
        "duplicate-managed-block",
        "Document has two Managed Blocks",
        { recovery: "Keep one Managed Block." },
      ),
      code: "DUPLICATE_MANAGED_BLOCK",
    },
    {
      name: "missing Annotation Block",
      error: new LiteratureNoteTemplateError(
        "missing-annotation-block",
        "Document has no {% annotation %} block",
        { recovery: "Add an Annotation Block to the document body." },
      ),
      code: "MISSING_ANNOTATION_BLOCK",
    },
    {
      name: "duplicate Annotation Block",
      error: new LiteratureNoteTemplateError(
        "duplicate-annotation-block",
        "Duplicate {% annotation %} block",
        { recovery: "Keep at most one Annotation Block." },
      ),
      code: "DUPLICATE_ANNOTATION_BLOCK",
    },
    {
      name: "inert Eta document",
      error: new InertTemplateError("JavaScript Templates are disabled"),
      code: "ETA_OPT_IN_REQUIRED",
    },
  ])("reports $name with its recovery hint", async ({ error, code }) => {
    const { handlers } = makeHandlers({
      renderSource: () => {
        throw error;
      },
    });

    const output = await handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
      key: "ITEM2345",
      source: "invalid source",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code,
        message: error.message,
        hint: DIAGNOSTIC_HINTS[code as keyof typeof DIAGNOSTIC_HINTS],
      },
    });
  });

  it("reports validation failures from an installed document", async () => {
    const { handlers, getDocument } = makeHandlers();
    getDocument.mockImplementationOnce(() => {
      throw new LiteratureNoteTemplateError(
        "duplicate-managed-block",
        "Document has two Managed Blocks",
        { recovery: "Keep one Managed Block." },
      );
    });

    const output = await handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
      key: "ITEM2345",
      document: "default.md",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "DUPLICATE_MANAGED_BLOCK",
        hint: DIAGNOSTIC_HINTS.DUPLICATE_MANAGED_BLOCK,
      },
    });
  });
});
