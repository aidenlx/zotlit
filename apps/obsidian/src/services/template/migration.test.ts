import { describe, expect, it, vi } from "vitest";

import { LegacyTemplateConversionError } from "@zotlit/templates/facade";

import { defaults } from "@/services/settings/schema";

import { LiteratureNoteTemplateMigrationService } from "./migration";
import type { LiteratureNoteTemplateMigrationOptions } from "./migration";

function makeHarness(options?: {
  pending?: boolean;
  defaultDocument?: string;
  ejectedAnnotation?: boolean;
  verificationAnnotation?: object | null;
}) {
  const state = {
    "note.default-profile": {
      ...defaults["note.default-profile"],
      ...(options?.defaultDocument === undefined
        ? {}
        : { document: options.defaultDocument }),
    },
    "note.template-conversion-pending": options?.pending ?? false,
    "template.folder": "templates",
  };
  const legacyPaths = [
    "templates/zotlit-note.liquid.md",
    "templates/zotlit-content.liquid.md",
    "templates/zotlit-filename.liquid.md",
  ];
  if (options?.ejectedAnnotation) {
    legacyPaths.push("templates/zotlit-annotation.liquid.md");
  }
  const files = new Map(legacyPaths.map((path) => [path, { path }]));
  let layoutReady: (() => void) | undefined;
  const create = vi.fn(async (path: string, source: string) => {
    const file = { path, source };
    files.set(path, file);
    return file;
  });
  const trashFile = vi.fn(async (file: { path: string }) => {
    files.delete(file.path);
  });
  const settings = {
    loaded: Promise.resolve(state),
    current: state,
    update: vi.fn((patch: Partial<typeof state>) =>
      Object.assign(state, patch),
    ),
    flush: vi.fn(async () => {}),
    setDefaultLiteratureNoteProfileDocument: vi.fn((document: string) => {
      state["note.default-profile"] = {
        ...state["note.default-profile"],
        document,
      };
    }),
  };
  const template = {
    ready: Promise.resolve(),
    getLegacyLiteratureNoteTemplateFiles: vi.fn(() => [
      "templates/zotlit-filename.liquid.md",
      "templates/zotlit-note.liquid.md",
      ...(options?.ejectedAnnotation
        ? ["templates/zotlit-annotation.liquid.md"]
        : []),
      "templates/zotlit-content.liquid.md",
    ]),
    convertLegacyLiteratureNoteTemplates: vi.fn(async () => ({
      source: "converted source",
      legacyFiles: [
        "templates/zotlit-filename.liquid.md",
        "templates/zotlit-note.liquid.md",
        ...(options?.ejectedAnnotation
          ? ["templates/zotlit-annotation.liquid.md"]
          : []),
        "templates/zotlit-content.liquid.md",
      ],
    })),
  };
  const openPrompt = vi.fn();
  const service = new LiteratureNoteTemplateMigrationService({
    app: {
      vault: {
        getFileByPath: (path: string) => files.get(path) ?? null,
        create,
      },
      fileManager: { trashFile },
      workspace: {
        onLayoutReady: (callback: () => void) => {
          layoutReady = callback;
        },
      },
    } as unknown as LiteratureNoteTemplateMigrationOptions["app"],
    settings,
    template,
    loadVerificationData: async () => ({
      note: { title: "Paper" },
      filename: { citationKey: "doePaper" },
      annotation:
        options && "verificationAnnotation" in options
          ? (options.verificationAnnotation ?? null)
          : options?.ejectedAnnotation
            ? { text: "Excerpt" }
            : null,
    }),
    openPrompt,
  });
  return {
    create,
    files,
    layoutReady: () => layoutReady?.(),
    openPrompt,
    service,
    settings,
    template,
    trashFile,
  };
}

describe("LiteratureNoteTemplateMigrationService", () => {
  it("durably arms the prompt without changing legacy files", async () => {
    const harness = makeHarness();
    const paths = [...harness.files.keys()];

    await harness.service.ready;
    harness.layoutReady();

    expect(harness.settings.update).toHaveBeenCalledWith({
      "note.template-conversion-pending": true,
    });
    expect(harness.openPrompt).toHaveBeenCalledOnce();
    expect([...harness.files.keys()]).toEqual(paths);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
  });

  it("writes the verified document before persisting and trashing legacy files", async () => {
    const harness = makeHarness({ pending: true });
    await harness.service.ready;

    const result = await harness.service.convert();

    expect(result).toEqual({
      outcome: "converted",
      document: "literature-note-default.md",
      trashed: [
        "templates/zotlit-filename.liquid.md",
        "templates/zotlit-note.liquid.md",
        "templates/zotlit-content.liquid.md",
      ],
    });
    expect(harness.create).toHaveBeenCalledWith(
      "templates/literature-note-default.md",
      "converted source",
    );
    expect(
      harness.settings.setDefaultLiteratureNoteProfileDocument,
    ).toHaveBeenCalledWith("literature-note-default.md");
    expect(harness.settings.update).toHaveBeenCalledWith({
      "note.template-conversion-pending": false,
    });
    expect(harness.settings.flush).toHaveBeenCalledBefore(harness.trashFile);
    expect(harness.trashFile).toHaveBeenCalledTimes(3);
    expect(harness.files.has("templates/literature-note-default.md")).toBe(
      true,
    );
  });

  it("leaves the vault and settings untouched when parity verification fails", async () => {
    const harness = makeHarness({ pending: true });
    await harness.service.ready;
    harness.template.convertLegacyLiteratureNoteTemplates.mockRejectedValueOnce(
      new LegacyTemplateConversionError(
        "legacy-render-mismatch",
        "Converted create output differs at byte 10",
        {
          difference: "create output",
          recovery: "Keep the legacy files unchanged.",
        },
      ),
    );
    harness.settings.update.mockClear();

    const result = await harness.service.convert();

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "legacy-render-mismatch",
        difference: "create output",
        message: "Converted create output differs at byte 10",
        hint: "Keep the legacy files unchanged.",
      },
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
    expect(harness.settings.update).not.toHaveBeenCalled();
  });

  it("trashes an ejected annotation template after the verified document write", async () => {
    const harness = makeHarness({ pending: true, ejectedAnnotation: true });
    await harness.service.ready;

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "converted",
      trashed: expect.arrayContaining([
        "templates/zotlit-annotation.liquid.md",
      ]),
    });
    expect(
      harness.template.convertLegacyLiteratureNoteTemplates,
    ).toHaveBeenCalledWith({
      note: { title: "Paper" },
      filename: { citationKey: "doePaper" },
      annotation: { text: "Excerpt" },
    });
    expect(harness.settings.flush).toHaveBeenCalledBefore(harness.trashFile);
  });

  it("names the missing verification annotation and its recovery", async () => {
    const harness = makeHarness({
      pending: true,
      ejectedAnnotation: true,
      verificationAnnotation: null,
    });
    await harness.service.ready;

    const result = await harness.service.convert();

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "no-verification-annotation",
        message:
          "No Zotero annotation is available for conversion verification",
        hint: "Add an annotation to a Zotero item, then retry conversion.",
      },
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
  });
});
