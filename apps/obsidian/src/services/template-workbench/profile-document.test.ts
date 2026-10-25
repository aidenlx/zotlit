import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

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

const BOOKS_ID = "Bk3Qn7XvT2Lp";

/** `evaluate`'s answer, or a failure with what it threw. */
const threw = <A>(evaluate: () => A) =>
  Effect.try(evaluate).pipe(Effect.mapError(({ cause }) => cause));

function makeHandlers(options?: {
  renderSource?: (
    source: string,
    data: object,
  ) => {
    create: string;
    update: string | null;
  };
}) {
  const readProfiles = vi.fn<
    () => Effect.Success<
      NonNullable<
        Parameters<typeof createTemplateWorkbenchHandlers>[0]["literatureNotes"]
      >["readProfiles"]
    >
  >(() => ({
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
    selectNote: () =>
      Effect.succeed({
        error: "TARGET_NOT_FOUND" as const,
        matches: [],
      }),
    pluginVersion: "1.2.3",
    getIdentity: Effect.succeed(IDENTITY),
    loadCitation: () => Effect.succeed({ kind: "not-found" } as const),
    loadData: () =>
      Effect.succeed({ kind: "data", data: { title: "Paper" } } as const),
    templates: {
      getCitationTemplateStatus: Effect.succeed({
        path: "Templates/zotlit-citation.md",
        customized: false,
        language: "liquid" as const,
        inertPath: null,
        compileError: null,
      }),
      renderCitationData: () => Effect.succeed(""),
      javascriptTemplatesEnabled: Effect.succeed(false),
      compileErrors: Effect.succeed(new Map()),
      getTemplateFileStatuses: Effect.succeed([]),
      getPartialDocument: () => Effect.succeed(null),
      render: () => Effect.succeed(""),
      renderFilename: () => Effect.succeed(""),
      analyzeRootVariables: () => Effect.succeed(null),
      getTemplateSource: () => Effect.succeed(""),
      waitUntilSettled: () => Effect.succeed("settled" as const),
    },
    frontmatter: {
      read: Effect.succeed({
        fields: [],
        inertKeys: [],
        javascriptTemplatesEnabled: false,
      }),
      evaluate: () => Effect.succeed({ values: {}, errors: {}, inertKeys: [] }),
      validateExpr: () => Effect.succeed(null),
      write: () => Effect.void,
    },
    literatureNotes: {
      readProfiles: Effect.sync(() => readProfiles()),
      getDocumentStatuses: Effect.sync(() => getDocumentStatuses()),
      // A fake that throws fails the port with what it threw.
      getDocument: (reference) => threw(() => getDocument(reference)),
      renderSource: (source, data) => threw(() => renderSource(source, data)),
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
  it.effect(
    "reports Profiles, their references, and missing document validation",
    () =>
      Effect.gen(function* () {
        const { handlers } = makeHandlers();

        const output = yield* handlers[TEMPLATE_STATUS_COMMAND]({});

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
      }),
  );

  it.effect("reports an excluded Default only through its diagnostics", () =>
    Effect.gen(function* () {
      const { handlers, readProfiles } = makeHandlers();
      const diagnostics = [
        {
          code: "duplicate-profile-id" as const,
          path: "templates/zotlit-profile.default.md",
          paths: [
            "templates/zotlit-profile.default.md",
            "templates/zotlit-profile.copy.md",
          ],
          message: "Duplicate default ID",
        },
      ];
      readProfiles.mockReturnValue({
        defaultProfile: undefined,
        profiles: [],
        diagnostics,
      });
      const output = JSON.parse(yield* handlers[TEMPLATE_STATUS_COMMAND]({}));
      expect(output.profiles).toEqual([]);
      expect(output.profileDiagnostics).toEqual(diagnostics);
    }),
  );

  it.effect("refuses a second document selector before it reads the key", () =>
    Effect.gen(function* () {
      const { handlers, getDocument } = makeHandlers();

      const output = yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
        key: "not-a-key",
        profile: "default",
        document: "default.md",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Provide exactly one of profile, document, or source.",
          details: { parameter: "document" },
        },
      });
      expect(getDocument).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "renders an uninstalled source override against real item data without writes",
    () =>
      Effect.gen(function* () {
        const { handlers, getDocument, renderSource } = makeHandlers();
        const source = "---\nid: draft\n---\n# {{ zt.title }}";

        const output = yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
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
      }),
  );

  it.effect.each([
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
  ])("reports $name with its recovery hint", ({ params, code }) =>
    Effect.gen(function* () {
      const { handlers } = makeHandlers();
      const cliParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) cliParams[key] = value;
      }

      const output =
        yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND](cliParams);

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code,
          hint: DIAGNOSTIC_HINTS[code as keyof typeof DIAGNOSTIC_HINTS],
        },
      });
    }),
  );

  it.effect(
    "prints an unresolved --profile argument verbatim instead of falling back to the default",
    () =>
      Effect.gen(function* () {
        const { handlers } = makeHandlers();

        const output = yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
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
      }),
  );

  it.effect.each([
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
      name: "missing Annotation Section",
      error: new LiteratureNoteTemplateError(
        "missing-annotation-section",
        "Document has no --- zotlit:annotation --- header",
        { recovery: "Add a final Annotation Section." },
      ),
      code: "MISSING_ANNOTATION_SECTION",
    },
    {
      name: "duplicate Annotation Section",
      error: new LiteratureNoteTemplateError(
        "duplicate-annotation-section",
        "Duplicate Annotation Section",
        { recovery: "Keep one Annotation Section." },
      ),
      code: "DUPLICATE_ANNOTATION_SECTION",
    },
    {
      name: "unknown section header",
      error: new LiteratureNoteTemplateError(
        "unknown-section-header",
        "Unknown Profile section header",
        { recovery: "Use the annotation header." },
      ),
      code: "UNKNOWN_SECTION_HEADER",
    },
    {
      name: "reserved annotation partial",
      error: new LiteratureNoteTemplateError(
        "reserved-annotation-partial",
        "Reserved annotation partial",
        { recovery: "Rename the partial." },
      ),
      code: "RESERVED_ANNOTATION_PARTIAL",
    },
    {
      name: "inert Eta document",
      error: new InertTemplateError("JavaScript Templates are disabled"),
      code: "ETA_OPT_IN_REQUIRED",
    },
  ])("reports $name with its recovery hint", ({ error, code }) =>
    Effect.gen(function* () {
      const { handlers } = makeHandlers({
        renderSource: () => {
          throw error;
        },
      });

      const output = yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
        key: "ITEM2345",
        source: "invalid source",
      });
      const registered =
        DIAGNOSTIC_HINTS[code as keyof typeof DIAGNOSTIC_HINTS];
      // A document fault carries the parser's own recovery as its hint.
      const recovery =
        error instanceof LiteratureNoteTemplateError
          ? error.recovery
          : undefined;

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code,
          message: error.message,
          hint: recovery ?? registered,
          severity: "error",
          report:
            recovery === undefined
              ? [error.message, registered]
              : [error.message, recovery, registered],
        },
      });
    }),
  );

  it.effect("reports validation failures from an installed document", () =>
    Effect.gen(function* () {
      const { handlers, getDocument } = makeHandlers();
      getDocument.mockImplementationOnce(() => {
        throw new LiteratureNoteTemplateError(
          "duplicate-managed-block",
          "Document has two Managed Blocks",
          { recovery: "Keep one Managed Block." },
        );
      });

      const output = yield* handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND]({
        key: "ITEM2345",
        document: "default.md",
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "DUPLICATE_MANAGED_BLOCK",
          hint: "Keep one Managed Block.",
          report: [
            "Document has two Managed Blocks",
            "Keep one Managed Block.",
            DIAGNOSTIC_HINTS.DUPLICATE_MANAGED_BLOCK,
          ],
        },
      });
    }),
  );
});
