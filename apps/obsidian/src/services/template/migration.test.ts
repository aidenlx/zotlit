import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import { LegacyTemplateConversionError } from "@zotlit/templates/facade";

import { defaults } from "@/services/settings/schema";
import { SettingsService } from "@/services/settings/service";

import { LiteratureNoteTemplateMigrationService } from "./migration";
import type { LiteratureNoteTemplateMigrationOptions } from "./migration";
import { TemplateService } from "./service";
import type { LegacyTemplateDocuments } from "./service";
import { MockVault, PluginStub } from "./test-vault";

function makeHarness(options?: {
  pending?: boolean;
  defaultDocument?: string;
  ejectedAnnotation?: boolean;
  verificationAnnotation?: object | null;
  /**
   * The 2.1.x documents the folder holds. Supplying them makes this a vault
   * with no Legacy Template File slots at all, which the prompt still arms
   * for: a `cite` or a bare partial is a legacy file like any other.
   */
  legacyDocuments?: LegacyTemplateDocuments;
}) {
  const documentsOnly = options?.legacyDocuments !== undefined;
  const state = {
    "note.default-profile": {
      ...defaults["note.default-profile"],
    },
    "note.template-conversion-pending": options?.pending ?? false,
    "note.template-conversion-result": null as {
      document: string | null;
      trashed: number;
    } | null,
    "template.folder": "templates",
    "note.frontmatter-fields": defaults["note.frontmatter-fields"],
    "template.auto-trim-leading": defaults["template.auto-trim-leading"],
    "template.auto-trim-trailing": defaults["template.auto-trim-trailing"],
  };
  const legacyPaths = documentsOnly
    ? (options.legacyDocuments?.partials ?? []).map(({ path }) => path)
    : [
        "templates/zotlit-note.liquid.md",
        "templates/zotlit-content.liquid.md",
        "templates/zotlit-filename.liquid.md",
      ];
  if (options?.ejectedAnnotation) {
    legacyPaths.push("templates/zotlit-annotation.liquid.md");
  }
  const files = new Map(legacyPaths.map((path) => [path, { path }]));
  if (options?.defaultDocument)
    files.set("templates/zotlit-profile.default.md", {
      path: "templates/zotlit-profile.default.md",
    });
  let layoutReady: (() => void | Promise<void>) | undefined;
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
  };
  const template = {
    javascriptTemplatesEnabled: false,
    refresh: vi.fn(async () => {}),
    waitUntilSettled: async () => "settled" as const,
    ready: Promise.resolve(),
    getLegacyLiteratureNoteTemplateFiles: vi.fn(() =>
      documentsOnly
        ? []
        : [
            "templates/zotlit-filename.liquid.md",
            "templates/zotlit-note.liquid.md",
            ...(options?.ejectedAnnotation
              ? ["templates/zotlit-annotation.liquid.md"]
              : []),
            "templates/zotlit-content.liquid.md",
          ],
    ),
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
    getLegacyTemplateDocuments: vi.fn(
      (): LegacyTemplateDocuments =>
        options?.legacyDocuments ?? { citation: [], partials: [] },
    ),
    convertLegacyTemplateDocuments: vi.fn(async () => ({
      documents: [] as { path: string; source: string }[],
      trashed: [] as string[],
      kept: [] as string[],
    })),
  };
  const openPrompt = vi.fn();
  const service = new LiteratureNoteTemplateMigrationService({
    app: {
      vault: {
        getFileByPath: (path: string) => files.get(path) ?? null,
        create,
        cachedRead: async (file: { path: string }) => file.path,
        getMarkdownFiles: () => [...files.values()],
      },
      fileManager: { trashFile },
      workspace: {
        onLayoutReady: (callback: () => void | Promise<void>) => {
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
      citation: [{ citationKey: "smith2024" }],
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
    await harness.layoutReady();

    expect(harness.settings.update).toHaveBeenCalledWith({
      "note.template-conversion-pending": true,
    });
    expect(harness.openPrompt).toHaveBeenCalledOnce();
    expect([...harness.files.keys()]).toEqual(paths);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
  });

  it("arms the prompt for a vault whose only legacy files are 2.1.x documents", async () => {
    const harness = makeHarness({
      legacyDocuments: {
        citation: [],
        partials: [
          {
            name: "venue",
            path: "templates/zotlit-venue.liquid.md",
            language: "liquid",
            inert: false,
            shadowed: [],
          },
        ],
      },
    });

    await harness.service.ready;
    await harness.layoutReady();

    expect(harness.settings.update).toHaveBeenCalledWith({
      "note.template-conversion-pending": true,
    });
    expect(harness.openPrompt).toHaveBeenCalledOnce();
  });

  it("writes the verified document before persisting and trashing legacy files", async () => {
    const harness = makeHarness({ pending: true });
    await harness.service.ready;

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "converted",
      document: "zotlit-profile.default.md",
      trashed: [
        "templates/zotlit-filename.liquid.md",
        "templates/zotlit-note.liquid.md",
        "templates/zotlit-content.liquid.md",
      ],
      kept: [],
    });
    expect(harness.create).toHaveBeenCalledWith(
      "templates/zotlit-profile.default.md",
      "converted source",
    );
    expect(harness.settings.current["note.default-profile"]).not.toHaveProperty(
      "document",
    );
    expect(harness.settings.current["note.template-conversion-pending"]).toBe(
      false,
    );
    expect(harness.settings.flush).toHaveBeenCalledBefore(harness.trashFile);
    expect(harness.trashFile).toHaveBeenCalledTimes(3);
    expect(harness.files.has("templates/zotlit-profile.default.md")).toBe(true);
    expect(
      harness.settings.current["note.template-conversion-result"],
    ).toMatchObject({
      document: "templates/zotlit-profile.default.md",
      trashed: 3,
    });
    expect(
      harness.settings.flush.mock.invocationCallOrder.at(-1),
    ).toBeGreaterThan(harness.trashFile.mock.invocationCallOrder.at(-1)!);
  });

  it("records only files actually trashed", async () => {
    const harness = makeHarness({ pending: true, ejectedAnnotation: true });
    await using service = harness.service;
    await service.ready;
    harness.files.delete("templates/zotlit-content.liquid.md");
    await service.convert();
    expect(
      harness.settings.current["note.template-conversion-result"],
    ).toMatchObject({
      document: "templates/zotlit-profile.default.md",
      trashed: 3,
    });
  });

  it("retains acceptance when trash fails", async () => {
    const failed = makeHarness({ pending: true });
    await using service = failed.service;
    await service.ready;
    failed.trashFile.mockRejectedValueOnce(new Error("Trash unavailable"));
    await expect(service.convert()).resolves.toMatchObject({
      outcome: "converted",
      pendingCleanup: ["templates/zotlit-filename.liquid.md"],
    });
    expect(
      failed.settings.current["note.template-conversion-result"],
    ).toMatchObject({
      pendingCleanup: ["templates/zotlit-filename.liquid.md"],
    });
  });

  it("takes back the documents it created when a later write fails", async () => {
    const harness = makeHarness({ pending: true });
    await using service = harness.service;
    await service.ready;
    harness.template.getLegacyTemplateDocuments.mockReturnValue({
      citation: [
        {
          name: "cite",
          path: "templates/zotlit-cite.liquid.md",
          language: "liquid",
          inert: false,
          shadowed: [],
        },
      ],
      partials: [],
    });
    harness.template.convertLegacyTemplateDocuments.mockResolvedValueOnce({
      documents: [
        { path: "templates/zotlit-citation.md", source: "citation source" },
      ],
      trashed: ["templates/zotlit-cite.liquid.md"],
      kept: [],
    });
    let writes = 0;
    harness.create.mockImplementation(async (path: string, source: string) => {
      writes += 1;
      if (writes === 2) throw new Error("Disk full");
      const file = { path, source };
      harness.files.set(path, file);
      return file;
    });

    await expect(service.convert()).rejects.toThrow("Disk full");

    // Only the document this pass created goes back; every legacy file stays.
    expect(harness.trashFile).toHaveBeenCalledTimes(1);
    expect(harness.files.has("templates/zotlit-profile.default.md")).toBe(
      false,
    );
    expect(harness.files.has("templates/zotlit-note.liquid.md")).toBe(true);
    expect(harness.settings.current["note.template-conversion-pending"]).toBe(
      true,
    );
    expect(
      harness.settings.current["note.template-conversion-result"],
    ).toBeNull();
  });

  it("does not infer a completed conversion from an existing Default document", async () => {
    const harness = makeHarness({ pending: true, defaultDocument: "existing" });
    await using service = harness.service;
    await service.ready;
    expect(
      harness.settings.current["note.template-conversion-result"],
    ).toBeNull();
    expect(harness.settings.current["note.template-conversion-pending"]).toBe(
      false,
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

  it("returns affected fields and leaves the vault untouched when the dry run fails", async () => {
    const harness = makeHarness({ pending: true });
    await harness.service.ready;
    harness.template.convertLegacyLiteratureNoteTemplates.mockRejectedValueOnce(
      new LegacyTemplateConversionError(
        "legacy-frontmatter-evaluation",
        "Converted Managed Frontmatter failed for: tags, creators",
        {
          difference: "Managed Frontmatter evaluation",
          recovery: "Correct these fields, then retry conversion.",
          fields: ["tags", "creators"],
        },
      ),
    );

    const result = await harness.service.convert();

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "legacy-frontmatter-evaluation",
        difference: "Managed Frontmatter evaluation",
        message: "Converted Managed Frontmatter failed for: tags, creators",
        hint: "Correct these fields, then retry conversion.",
        fields: ["tags", "creators"],
      },
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
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

const CITE_LIQUID = "<{{ zt.citations | pandoc_cite }}>\n";
const CITE2_LIQUID =
  "{{ zt.citations | pandoc_cite: 'prefer-author-in-text' }}!\n";
const AUTHORS_LIQUID = "{{ zt.creators | join: ', ' }}\n";
const SUMMARY_LIQUID = "> {{ zt.abstract }}\n";

/**
 * The migration service over a real {@link TemplateService} and a fixture
 * vault, so the pass runs its own byte verification and writes real files.
 */
async function makeVaultHarness(
  files: Record<string, string>,
  options?: { javascriptTemplates?: boolean; storedSettings?: unknown },
) {
  const vault = new MockVault();
  for (const [path, content] of Object.entries(files)) {
    vault.addFile(path, content);
  }
  const localStorage = new Map<string, unknown>(
    options?.javascriptTemplates ? [["zotlit-javascript-templates", "1"]] : [],
  );
  let layoutReady: (() => void | Promise<void>) | undefined;
  const trashFile = vi.fn(async (file: { path: string }) => {
    vault.deleteFile(file.path);
  });
  const app = {
    vault,
    workspace: {
      updateOptions: vi.fn(),
      onLayoutReady: (callback: () => void | Promise<void>) => {
        layoutReady = callback;
      },
    },
    fileManager: { trashFile },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  } as unknown as App;
  const plugin = new PluginStub(
    app,
    options?.storedSettings ?? { __VERSION__: 1 },
  );
  const noMigration = (raw: unknown) => raw;
  // Each service is owned from the moment it is constructed, so a startup that
  // fails halfway still disposes what it already built.
  await using stack = new AsyncDisposableStack();
  const settings = stack.use(
    new SettingsService({
      plugin,
      migrateLegacy: noMigration,
      migrateV1: noMigration,
      migrateV2: noMigration,
      migrateV3: noMigration,
      migrateV4: noMigration,
      migrateV5: noMigration,
      migrateV6: noMigration,
      migrateV7: noMigration,
      migrateV8: noMigration,
      migrateV9: noMigration,
    }),
  );
  await settings.ready;
  const template = stack.use(new TemplateService({ app, settings }));
  await template.ready;
  const openPrompt = vi.fn();
  const service = stack.use(
    new LiteratureNoteTemplateMigrationService({
      app,
      settings,
      template,
      loadVerificationData: async () => ({
        note: { title: "Paper" },
        filename: { citationKey: "smith2024" },
        annotation: null,
        citation: [{ citationKey: "smith2024" }],
      }),
      openPrompt,
    }),
  );
  await service.ready;
  const owned = stack.move();
  return {
    layoutReady: () => layoutReady?.(),
    openPrompt,
    service,
    settings,
    template,
    vault,
    plugin,
    trashFile,
    storedSettings: () => structuredClone(plugin.data),
    [Symbol.asyncDispose]: () => owned[Symbol.asyncDispose](),
  };
}

describe("one-pass conversion of the 2.1.x cite and partial files", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds cite and cite2 into one Citation Template and renames each partial", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.liquid.md": CITE2_LIQUID,
      "templates/zotlit-authors.liquid.md": AUTHORS_LIQUID,
      "templates/zotlit-summary.liquid.md": SUMMARY_LIQUID,
    });

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "converted",
      document: null,
      trashed: [
        "templates/zotlit-cite.liquid.md",
        "templates/zotlit-cite2.liquid.md",
        "templates/zotlit-authors.liquid.md",
        "templates/zotlit-summary.liquid.md",
      ],
      kept: [],
    });
    expect(harness.vault.contents.get("templates/zotlit-citation.md")).toBe(
      `---
language: liquid
---
{% if zt.variant == "alt" %}
  {{ zt.citations | pandoc_cite: 'prefer-author-in-text' }}!
{% else %}
  <{{ zt.citations | pandoc_cite }}>
{% endif %}
`,
    );
    expect(
      harness.vault.contents.get("templates/zotlit-partial.authors.md"),
    ).toBe(`---\nlanguage: liquid\n---\n${AUTHORS_LIQUID}`);
    expect(
      harness.vault.contents.get("templates/zotlit-partial.summary.md"),
    ).toBe(`---\nlanguage: liquid\n---\n${SUMMARY_LIQUID}`);
    expect(harness.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
      false,
    );
    expect(harness.vault.files.has("templates/zotlit-authors.liquid.md")).toBe(
      false,
    );
  });

  it("keeps both gestures rendering what their legacy file rendered", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.liquid.md": CITE2_LIQUID,
    });
    const refs = [{ citationKey: "smith2024" }];
    const before = {
      main: harness.template.render(
        "cite",
        citekeysToCiteTemplateData(refs, "main"),
      ),
      alt: harness.template.render(
        "cite2",
        citekeysToCiteTemplateData(refs, "alt"),
      ),
    };

    await harness.service.convert();
    await vi.advanceTimersByTimeAsync(500);

    expect(before).toEqual({ main: "<[@smith2024]>\n", alt: "@smith2024!\n" });
    expect(harness.template.renderCitation(refs, "main")).toBe(
      "<[@smith2024]>",
    );
    expect(harness.template.renderCitation(refs, "alt")).toBe("@smith2024!");
  });

  it("carries an Eta partial's language into its manifest", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-authors.eta.md": "<%= zt.creators.join(', ') %>\n",
    });

    const result = await harness.service.convert();

    expect(result).toMatchObject({ document: null, kept: [] });
    expect(
      harness.vault.contents.get("templates/zotlit-partial.authors.md"),
    ).toBe("---\nlanguage: eta\n---\n<%= zt.creators.join(', ') %>\n");
  });

  it("folds a mixed-language pair as Liquid and leaves the Eta file in place", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.eta.md":
        '<%= pandocCite(zt.citations, "prefer-author-in-text") %>?\n',
    });

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "converted",
      trashed: ["templates/zotlit-cite.liquid.md"],
      kept: ["templates/zotlit-cite2.eta.md"],
    });
    expect(harness.vault.files.has("templates/zotlit-cite2.eta.md")).toBe(true);
    expect(harness.vault.contents.get("templates/zotlit-citation.md")).toBe(
      `---
language: liquid
---
{% if zt.variant == "alt" %}
  {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
{% else %}
  <{{ zt.citations | pandoc_cite }}>
{% endif %}
`,
    );
  });

  it("refuses a fold whose branch renders a legacy name the pass trashes", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.liquid.md":
        '{% render "cite" with zt as zt %}!\n',
    });

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "unsupported-legacy-template" },
    });
    expect(harness.vault.files.has("templates/zotlit-citation.md")).toBe(false);
  });

  it("prompts once for a vault holding both note slots and cite files", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-note.liquid.md": "# {{ zt.title }}\n",
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    });

    await harness.layoutReady();

    expect(harness.openPrompt).toHaveBeenCalledOnce();
    expect(harness.settings.current?.["note.template-conversion-pending"]).toBe(
      true,
    );
  });

  it("prompts for a vault holding only zotlit-cite.liquid.md", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    });

    await harness.layoutReady();

    expect(harness.openPrompt).toHaveBeenCalledOnce();
  });

  it("leaves a vault with no legacy file unprompted", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-citation.md": "{{ zt.citations | pandoc_cite }}\n",
    });

    await harness.layoutReady();

    expect(harness.openPrompt).not.toHaveBeenCalled();
    expect(await harness.service.convert()).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "no-legacy-templates" },
    });
  });

  it("writes nothing when the Citation Template document already exists", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-citation.md": "{{ zt.citations | pandoc_cite }}\n",
    });

    const result = await harness.service.convert();

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "converted-document-exists",
        message:
          "Converted document already exists at templates/zotlit-citation.md",
        hint: "Rename or remove that document, then retry conversion.",
      },
    });
    expect(harness.vault.files.has("templates/zotlit-cite.liquid.md")).toBe(
      true,
    );
  });

  it("refuses an Eta citation fold while JavaScript Templates are off", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.eta.md": "<%= pandocCite(zt.citations) %>\n",
    });

    const result = await harness.service.convert();

    expect(result).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "unsupported-legacy-template" },
    });
    expect(harness.vault.files.has("templates/zotlit-citation.md")).toBe(false);
    expect(harness.vault.files.has("templates/zotlit-cite.eta.md")).toBe(true);
  });
});

describe("the one-shot conversion aborts before any write", () => {
  it("leaves the vault untouched when a citation variant fails verification", async () => {
    const harness = makeHarness({ pending: true });
    await harness.service.ready;
    harness.template.convertLegacyTemplateDocuments.mockRejectedValueOnce(
      new LegacyTemplateConversionError(
        "legacy-render-mismatch",
        "Converted alternate citation output differs from the legacy render at byte 4",
        {
          difference: "alternate citation output",
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
        difference: "alternate citation output",
        message:
          "Converted alternate citation output differs from the legacy render at byte 4",
        hint: "Keep the legacy files unchanged.",
      },
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.trashFile).not.toHaveBeenCalled();
    expect(harness.settings.update).not.toHaveBeenCalled();
  });
});

describe("accepted conversion cleanup recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const sources = {
    "templates/zotlit-note.liquid.md":
      '# {{ zt.title }}\n{% render "content" with zt as zt %}\n',
    "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    "templates/zotlit-cite2.eta.md": "<%= pandocCite(zt.citations) %>\n",
    "templates/zotlit-authors.liquid.md": AUTHORS_LIQUID,
  };

  it("keeps accepted documents active and retries retained sources after restart", async () => {
    await using harness = await makeVaultHarness(sources);
    harness.trashFile.mockImplementation(async () => {
      throw new Error("Trash unavailable");
    });
    const result = await harness.service.convert();
    expect(result).toMatchObject({
      outcome: "converted",
      documents: [
        "templates/zotlit-profile.default.md",
        "templates/zotlit-citation.md",
        "templates/zotlit-partial.authors.md",
      ],
      pendingCleanup: [
        "templates/zotlit-cite.liquid.md",
        "templates/zotlit-authors.liquid.md",
        "templates/zotlit-note.liquid.md",
      ],
      kept: ["templates/zotlit-cite2.eta.md"],
    });
    const documents = Object.fromEntries(harness.vault.contents);
    await using restarted = await makeVaultHarness(documents, {
      storedSettings: structuredClone(harness.plugin.data),
    });
    expect(
      restarted.settings.current?.["note.template-conversion-pending"],
    ).toBe(false);
    expect(
      restarted.template.renderCitation([{ citationKey: "smith2024" }], "main"),
    ).toBe("<[@smith2024]>");
    expect(await restarted.service.retryCleanup()).toMatchObject({
      outcome: "converted",
      pendingCleanup: [],
      kept: ["templates/zotlit-cite2.eta.md"],
    });
    expect(restarted.vault.contents.get("templates/zotlit-cite2.eta.md")).toBe(
      sources["templates/zotlit-cite2.eta.md"],
    );
    for (const path of [
      "templates/zotlit-profile.default.md",
      "templates/zotlit-citation.md",
      "templates/zotlit-partial.authors.md",
    ]) {
      expect(restarted.vault.contents.get(path)).toBe(documents[path]);
    }
    expect(restarted.plugin.data).toMatchObject({
      "note.template-conversion-result": { pendingCleanup: [], trashed: 3 },
    });
  });

  it("restores original sources and permits retry when acceptance cannot be saved", async () => {
    await using harness = await makeVaultHarness(sources);
    vi.spyOn(harness.plugin, "saveData").mockRejectedValueOnce(
      new Error("Settings unavailable"),
    );
    await expect(harness.service.convert()).rejects.toThrow(
      "Settings unavailable",
    );
    expect(Object.fromEntries(harness.vault.contents)).toEqual(sources);
    expect(harness.plugin.data).toMatchObject({
      "note.template-conversion-pending": true,
      "note.template-conversion-result": null,
    });
    await using restarted = await makeVaultHarness(
      Object.fromEntries(harness.vault.contents),
      { storedSettings: structuredClone(harness.plugin.data) },
    );
    expect(await restarted.service.convert()).toMatchObject({
      outcome: "converted",
      pendingCleanup: [],
    });
  });

  it("recovers cleanup progress when its settings write fails after trash succeeds", async () => {
    await using harness = await makeVaultHarness(sources);
    const save = vi.spyOn(harness.plugin, "saveData");
    harness.trashFile.mockImplementation(async (file) => {
      harness.vault.deleteFile(file.path);
      save.mockRejectedValue(new Error("Settings unavailable"));
    });
    expect(await harness.service.convert()).toMatchObject({
      outcome: "converted",
      pendingCleanup: expect.arrayContaining([
        "templates/zotlit-note.liquid.md",
      ]),
    });
    const saved = structuredClone(harness.plugin.data);
    save.mockRestore();
    await using restarted = await makeVaultHarness(
      Object.fromEntries(harness.vault.contents),
      { storedSettings: saved },
    );
    expect(await restarted.service.retryCleanup()).toMatchObject({
      outcome: "converted",
      pendingCleanup: [],
    });
    expect(restarted.plugin.data).toMatchObject({
      "note.template-conversion-pending": false,
      "note.template-conversion-result": { pendingCleanup: [], trashed: 3 },
    });
  });
});

describe("conversion review with real templates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("discovers layout-ready originals and preserves postponement across delayed inventory on restart", async () => {
    const original = {
      "templates/zotlit-note.liquid.md":
        '# Late inventory {{ zt.title }}\n{% render "content" with zt as zt %}',
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    };
    let storedSettings: unknown;
    {
      await using first = await makeVaultHarness({});
      expect(first.settings.current?.["note.template-conversion-pending"]).toBe(
        false,
      );
      // Obsidian populates its initial inventory without create events.
      for (const [path, source] of Object.entries(original))
        first.vault.addFile(path, source);
      await first.layoutReady();
      expect(first.openPrompt).toHaveBeenCalledOnce();
      expect(first.settings.current?.["note.template-conversion-pending"]).toBe(
        true,
      );
      expect(Object.fromEntries(first.vault.contents)).toEqual(original);
      storedSettings = first.storedSettings();
    }
    await using resumed = await makeVaultHarness({}, { storedSettings });
    expect(resumed.settings.current?.["note.template-conversion-pending"]).toBe(
      true,
    );
    for (const [path, source] of Object.entries(original))
      resumed.vault.addFile(path, source);
    await resumed.layoutReady();
    expect(resumed.openPrompt).not.toHaveBeenCalled();
    expect(resumed.settings.current?.["note.template-conversion-pending"]).toBe(
      true,
    );
    expect(
      resumed.template.render(
        "cite",
        citekeysToCiteTemplateData([{ citationKey: "smith2024" }], "main"),
      ),
    ).toBe("<[@smith2024]>\n");
    expect(Object.fromEntries(resumed.vault.contents)).toEqual(original);
  });

  it("invites once and preserves deferred legacy rendering after settings restart", async () => {
    const original = { "templates/zotlit-cite.liquid.md": CITE_LIQUID };
    let storedSettings: unknown;
    {
      await using first = await makeVaultHarness(original);
      await first.layoutReady();
      expect(first.openPrompt).toHaveBeenCalledOnce();
      storedSettings = first.storedSettings();
    }
    await using resumed = await makeVaultHarness(original, { storedSettings });
    await resumed.layoutReady();
    expect(resumed.openPrompt).not.toHaveBeenCalled();
    expect(resumed.settings.current?.["note.template-conversion-pending"]).toBe(
      true,
    );
    expect(
      resumed.template.render(
        "cite",
        citekeysToCiteTemplateData([{ citationKey: "smith2024" }], "main"),
      ),
    ).toBe("<[@smith2024]>\n");
    expect(Object.fromEntries(resumed.vault.contents)).toEqual(original);
  });

  it("preserves active sources during review and activates usable documents on acceptance", async () => {
    const original = {
      "templates/zotlit-note.liquid.md":
        '# {{ zt.title }}\n{% render "content" with zt as zt %}',
      "templates/zotlit-content.liquid.md": "Body\n",
      "templates/zotlit-filename.liquid.md": "{{ zt.citationKey }}",
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-authors.liquid.md": AUTHORS_LIQUID,
    };
    await using harness = await makeVaultHarness(original);
    const before = structuredClone(harness.settings.current);
    const review = await harness.service.prepare();
    expect(review.preparation).toMatchObject({ outcome: "prepared" });
    expect(review.selected).toEqual({
      item: "Paper",
      annotation: null,
      citation: ["smith2024"],
    });
    expect(Object.fromEntries(harness.vault.contents)).toEqual(original);
    expect(harness.settings.current).toEqual(before);
    expect(review.inputs.map(({ destination }) => destination)).toEqual([
      "templates/zotlit-profile.default.md",
      "templates/zotlit-profile.default.md",
      "templates/zotlit-profile.default.md",
      "templates/zotlit-citation.md",
      "templates/zotlit-partial.authors.md",
    ]);
    expect(await harness.service.activate(review)).toMatchObject({
      outcome: "converted",
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(
      harness.template.renderCitation([{ citationKey: "smith2024" }], "main"),
    ).toBe("<[@smith2024]>");
    expect(
      harness.vault.contents.get("templates/zotlit-profile.default.md"),
    ).toContain("# {{ zt.title }}");
    expect(harness.vault.contents.has("templates/zotlit-note.liquid.md")).toBe(
      false,
    );
  });

  it("includes files created immediately before preparation after reconciliation", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    });
    harness.vault.createFile(
      "templates/zotlit-cite2.liquid.md",
      "New alternate source",
    );
    const preparing = harness.service.prepare();
    await vi.advanceTimersByTimeAsync(500);
    const review = await preparing;
    expect(review.preparation.outcome).toBe("prepared");
    expect(review.inputs.map(({ path }) => path)).toEqual([
      "templates/zotlit-cite.liquid.md",
      "templates/zotlit-cite2.liquid.md",
    ]);
  });

  it("refuses activation when a previously absent legacy file is created before reconciliation", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
    });
    const review = await harness.service.prepare();
    harness.vault.createFile(
      "templates/zotlit-cite2.liquid.md",
      "New alternate source",
    );
    expect(await harness.service.activate(review)).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "originals-changed" },
    });
    expect(harness.vault.contents.has("templates/zotlit-citation.md")).toBe(
      false,
    );
    expect(harness.vault.contents.get("templates/zotlit-cite2.liquid.md")).toBe(
      "New alternate source",
    );
  });

  it("identifies the retained side of a mixed citation pair before acceptance", async () => {
    await using harness = await makeVaultHarness({
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.eta.md": "Retained Eta source",
    });
    const review = await harness.service.prepare();
    expect(review.preparation.outcome).toBe("prepared");
    expect(review.kept).toEqual(["templates/zotlit-cite2.eta.md"]);
    expect(
      review.inputs.find(({ path }) => path.endsWith("cite2.eta.md"))
        ?.destination,
    ).toBeNull();
    expect(harness.vault.contents.get("templates/zotlit-cite2.eta.md")).toBe(
      "Retained Eta source",
    );
  });

  it("retains source evidence when synthesis refuses an unsupported layout", async () => {
    const original = {
      "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      "templates/zotlit-cite2.liquid.md":
        '{% render "cite" with zt as zt %}!\n',
    };
    await using harness = await makeVaultHarness(original);
    const review = await harness.service.prepare();
    expect(review.preparation).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "unsupported-legacy-template" },
    });
    expect(
      review.inputs.find(({ path }) => path.endsWith("cite2.liquid.md"))
        ?.source,
    ).toBe('{% render "cite" with zt as zt %}!\n');
    expect(Object.fromEntries(harness.vault.contents)).toEqual(original);
  });

  it("reports failed field evaluation with the original field and sources", async () => {
    const original = {
      "templates/zotlit-note.liquid.md": '{% render "content" with zt as zt %}',
      "templates/zotlit-content.liquid.md": "Research body",
      "templates/zotlit-filename.liquid.md": "{{ zt.citationKey }}",
    };
    await using harness = await makeVaultHarness(original);
    harness.settings.update({
      "note.frontmatter-fields": [
        {
          key: "research-field",
          language: "liquid",
          expr: "1 +",
          merge: "replace",
        },
      ],
    });
    const review = await harness.service.prepare();
    expect(review.preparation).toMatchObject({
      outcome: "refused",
      diagnostic: {
        code: "legacy-frontmatter-evaluation",
        fields: ["research-field"],
      },
    });
    expect(review.fields).toEqual([
      {
        key: "research-field",
        language: "liquid",
        expr: "1 +",
        merge: "replace",
      },
    ]);
    expect(Object.fromEntries(harness.vault.contents)).toEqual(original);
  });

  it.each(["source", "fields"] as const)(
    "requires a new review after original %s changes",
    async (change) => {
      await using harness = await makeVaultHarness({
        "templates/zotlit-cite.liquid.md": CITE_LIQUID,
      });
      const review = await harness.service.prepare();
      if (change === "source")
        harness.vault.modifyFile(
          "templates/zotlit-cite.liquid.md",
          "Changed original",
        );
      else harness.settings.update({ "note.frontmatter-fields": [] });
      expect(await harness.service.activate(review)).toMatchObject({
        outcome: "refused",
        diagnostic: { code: "originals-changed" },
      });
      expect(harness.vault.contents.has("templates/zotlit-citation.md")).toBe(
        false,
      );
      expect(
        harness.vault.contents.has("templates/zotlit-cite.liquid.md"),
      ).toBe(true);
    },
  );
});
