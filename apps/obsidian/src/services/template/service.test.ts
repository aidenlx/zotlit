import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplateError, TemplateFacade } from "@zotlit/templates/facade";
import {
  evalFrontmatterFields,
  evalManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { resolveProfile } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import { SettingsService } from "@/services/settings/service";

import {
  CITATION_TEMPLATE_SOURCE,
  DEFAULT_TEMPLATES,
  templatePath,
} from "./defaults";
import { InertTemplateError } from "./errors";
import type { MissingPartialError } from "./errors";
import { TemplateService } from "./service";
import { MockVault, PluginStub } from "./test-vault";

interface Harness {
  app: App & { workspace: { updateOptions: ReturnType<typeof vi.fn> } };
  plugin: PluginStub;
  service: TemplateService;
  settings: SettingsService;
  vault: MockVault;
  localStorage: Map<string, unknown>;
}

let harnesses: Harness[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  harnesses = [];
});

afterEach(async () => {
  for (const { service, settings } of harnesses.reverse()) {
    await service[Symbol.asyncDispose]();
    await settings[Symbol.asyncDispose]();
  }
  vi.useRealTimers();
});

describe("TemplateService", () => {
  it("discovers and reconciles Literature Note Template documents", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books"),
    );
    const { service } = await makeHarness({ vault });

    expect(
      service
        .getLiteratureNoteTemplate("zotlit-profile.books.md")
        ?.renderForCreate({ title: "First" }),
    ).toContain("# Books First");

    vault.modifyFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Revised books"),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(
      service
        .getLiteratureNoteTemplate("zotlit-profile.books.md")
        ?.renderForCreate({ title: "Second" }),
    ).toContain("# Revised books Second");

    vault.deleteFile("templates/zotlit-profile.books.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(
      service.getLiteratureNoteTemplate("zotlit-profile.books.md"),
    ).toBeUndefined();
  });

  it("compiles document frontmatter with the per-device JavaScript gate", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books").replace(
        'filename: "{{ zt.title }}"',
        `filename: "{{ zt.title }}"
frontmatter:
  - key: title
    merge: replace
    expr: zt.title
  - key: scripted
    merge: replace
    js: zt.title + "!"`,
      ),
    );
    const { service } = await makeHarness({ vault });

    const inert = service.getLiteratureNoteTemplate(
      "zotlit-profile.books.md",
    )?.frontmatter;
    expect(inert?.inertKeys).toEqual(["scripted"]);
    expect(
      evalManagedFrontmatterEntries(
        inert?.compiled ?? [],
        { title: "Paper" },
        Temporal.Now.instant(),
      ).values,
    ).toEqual([
      { key: "title", value: "Paper", merge: "replace", position: 1 },
    ]);

    await service.setJavascriptTemplatesEnabled(true);

    const active = service.getLiteratureNoteTemplate(
      "zotlit-profile.books.md",
    )?.frontmatter;
    expect(active?.inertKeys).toEqual([]);
    expect(
      evalManagedFrontmatterEntries(
        active?.compiled ?? [],
        { title: "Paper" },
        Temporal.Now.instant(),
      ).values,
    ).toEqual([
      { key: "title", value: "Paper", merge: "replace", position: 1 },
      { key: "scripted", value: "Paper!", merge: "replace", position: 2 },
    ]);
  });

  it("renders Profile Annotation Sections, refuses a blockless document, and keeps the documentless and legacy paths", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books", "PROFILE {{ zt.text }}"),
    );
    vault.addFile(
      "templates/zotlit-profile.plain.md",
      `---
id: plain
name: Plain
version: 1.0.0
author: ZotLit
description: Blockless fixture
contract: 1
filename: "{{ zt.title }}"
---
# Plain {{ zt.title }}

{% managed %}Managed {{ zt.title }}{% endmanaged %}
`,
    );
    vault.addFile(
      "templates/zotlit-annotation.liquid.md",
      "LEGACY {{ zt.text }}",
    );
    const { service } = await makeHarness({ vault });
    const profiles = [
      {
        id: "Bk3Qn7XvT2Lp" as ProfileId,
        label: "Books",
        document: "zotlit-profile.books.md",
      },
      {
        id: "Rz9Wm4YfH6Kd" as ProfileId,
        label: "Plain",
        document: "zotlit-profile.plain.md",
      },
      {
        id: "Vv1Ww2Xx3Yy4" as ProfileId,
        label: "Documentless",
      },
    ];
    const data = {
      pageLabel: "4",
      imgLink: null,
      text: "Excerpt",
      comment: null,
    };
    const converted = {
      ...defaults,
      "note.template-conversion-pending": false,
      profiles: profiles,
    };

    expect(
      service.renderProfileAnnotation(data, {
        profile: resolveProfile(converted, profiles[0]!.id)!,
      }),
    ).toBe("PROFILE Excerpt");
    // plain.md has no Annotation Section: the document is invalid, and the
    // render refuses instead of substituting the embedded default.
    expect(() =>
      service.renderProfileAnnotation(data, {
        profile: resolveProfile(converted, profiles[1]!.id)!,
      }),
    ).toThrow(expect.objectContaining({ code: "missing-annotation-section" }));
    // A documentless Profile predates the required-block rule and keeps the
    // embedded default through the legacy machinery.
    expect(
      service.renderProfileAnnotation(data, {
        profile: resolveProfile(converted, profiles[2]!.id)!,
      }),
    ).toContain("[!note] Page 4");
    expect(
      service.renderProfileAnnotation(data, {
        profile: resolveProfile(
          { ...converted, "note.template-conversion-pending": true },
          profiles[0]!.id,
        )!,
      }),
    ).toBe("LEGACY Excerpt");
  });

  it("reports a missing Profile document instead of falling back", async () => {
    const { service } = await makeHarness({ vault: new MockVault() });
    const settings = {
      ...defaults,
      "note.template-conversion-pending": false,
      profiles: [
        {
          id: "Tt2Uu4Vv6Ww8" as ProfileId,
          label: "Books",
          document: "zotlit-profile.missing.md",
        },
      ],
    };

    expect(() =>
      service.renderProfileAnnotation(
        { text: "Excerpt" },
        {
          profile: resolveProfile(settings, settings.profiles[0]!.id)!,
        },
      ),
    ).toThrow(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          code: "missing-literature-note-template",
          document: "zotlit-profile.missing.md",
        }),
      }),
    );
  });

  it.each(["liquid", "eta"] as const)(
    "keeps %s Profile annotation calls aligned after source changes",
    async (language) => {
      const vault = new MockVault();
      const call =
        language === "liquid"
          ? "{% render_annotation zt.annotation %}"
          : "<%~ renderAnnotation(zt.annotation) %>";
      const annotation =
        language === "liquid"
          ? "PROFILE {{ zt.text }}"
          : "PROFILE <%= zt.text %>";
      const source = literatureNoteDocument("Books", annotation)
        .replace(
          'filename: "{{ zt.title }}"',
          `filename: note\nlanguage: ${language}`,
        )
        .replace("Managed {{ zt.title }}", call);
      vault.addFile("templates/zotlit-profile.books.md", source);
      vault.addFile(
        "templates/zotlit-annotation.liquid.md",
        "GLOBAL {{ zt.text }}",
      );
      const { service } = await makeHarness({
        vault,
        javascriptTemplates: true,
      });
      const profile = resolveProfile(
        {
          ...defaults,
          "note.template-conversion-pending": false,
          profiles: [
            {
              id: "Bk3Qn7XvT2Lp" as ProfileId,
              label: "Books",
              document: "zotlit-profile.books.md",
            },
          ],
        },
        "Bk3Qn7XvT2Lp" as ProfileId,
      )!;
      const data = { annotation: { text: "A" } };
      const original = service.getLiteratureNoteTemplate(
        "zotlit-profile.books.md",
      )!;
      expect(original.renderForUpdate(data)).toBe(
        "%%zt-managed%%\nPROFILE A\n%%/zt-managed%%",
      );
      expect(original.renderForCreate(data)).toContain("PROFILE A");
      expect(
        service.renderProfileAnnotation(data.annotation, { profile }),
      ).toBe("PROFILE A");
      const exported = await service.exportLiteratureNotePack(
        "zotlit-profile.books.md",
      );
      expect(
        new TemplateFacade().parseLiteratureNoteTemplate(exported).manifest
          .partials,
      ).toBeUndefined();
      expect(
        service
          .prepareLiteratureNoteTemplateSource(exported)
          .renderAnnotation(data.annotation),
      ).toBe("PROFILE A");
      vault.modifyFile(
        "templates/zotlit-profile.books.md",
        source.replace("PROFILE", "CHANGED"),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(
        service.renderProfileAnnotation(data.annotation, { profile }),
      ).toBe("CHANGED A");
      expect(
        service
          .getLiteratureNoteTemplate("zotlit-profile.books.md")!
          .renderForUpdate(data),
      ).toBe("%%zt-managed%%\nCHANGED A\n%%/zt-managed%%");
      expect(original.renderAnnotation(data.annotation)).toBe("PROFILE A");
      expect(service.render("annotation", data.annotation)).toBe("GLOBAL A");
    },
  );

  it("uses bundled partial calls with the Profile's Annotation Section in write-free preview", async () => {
    const { service, vault } = await makeHarness();
    const source = literatureNoteDocument("Draft", "Local {{ zt.text }}")
      .replace(
        "contract: 1",
        `contract: 1
partials:
  - name: summary
    language: liquid
    source: '{% render_annotation zt.annotation %}'`,
      )
      .replace(
        "Managed {{ zt.title }}",
        '{% render "summary" with zt as zt %}',
      );
    const paths = [...vault.files.keys()];
    const document = service.prepareLiteratureNoteTemplateSource(source);
    expect(document.renderForUpdate({ annotation: { text: "A" } })).toBe(
      "%%zt-managed%%\nLocal A\n%%/zt-managed%%",
    );
    expect(document.renderAnnotation({ text: "A" })).toBe("Local A");
    expect([...vault.files.keys()]).toEqual(paths);
  });

  it("reports valid and invalid Literature Note Template documents", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books"),
    );
    vault.addFile(
      "templates/zotlit-profile.duplicate.md",
      literatureNoteDocument("{% managed %}One{% endmanaged %}"),
    );
    const { service } = await makeHarness({ vault });

    expect(service.getLiteratureNoteTemplateStatuses()).toMatchObject([
      {
        reference: "zotlit-profile.books.md",
        path: "templates/zotlit-profile.books.md",
        validation: { state: "valid", hasManagedBlock: true },
      },
      {
        reference: "zotlit-profile.duplicate.md",
        path: "templates/zotlit-profile.duplicate.md",
        validation: {
          state: "invalid",
          error: { code: "duplicate-managed-block" },
        },
      },
    ]);
  });

  it("renders an uninstalled Literature Note Template source in memory", async () => {
    const { service, vault } = await makeHarness();
    const paths = [...vault.files.keys()];

    const rendered = service.renderLiteratureNoteTemplateSource(
      literatureNoteDocument("Draft"),
      { title: "Paper" },
    );

    expect(rendered.create).toContain("# Draft Paper");
    expect(rendered.update).toContain("Managed Paper");
    expect([...vault.files.keys()]).toEqual(paths);
  });

  it("exports an installed document with its reachable partials bundled", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Draft").replace(
        "Managed {{ zt.title }}",
        '{% render "summary" with zt as zt %}',
      ),
    );
    vault.addFile(
      "templates/zotlit-partial.summary.md",
      "Summary {{ zt.title }}",
    );
    const { service } = await makeHarness({ vault });

    const exported = new TemplateFacade().parseLiteratureNoteTemplate(
      await service.exportLiteratureNotePack("zotlit-profile.books.md"),
    );

    expect(exported.manifest.partials).toEqual([
      {
        name: "summary",
        language: "liquid",
        source: "Summary {{ zt.title }}",
      },
    ]);
  });

  it("renders bundled Pack partials from an uninstalled source", async () => {
    const { service } = await makeHarness();
    const source = exportLiteratureNotePack(
      literatureNoteDocument("Draft").replace(
        "Managed {{ zt.title }}",
        '{% render "summary" with zt as zt %}',
      ),
      [
        {
          name: "summary",
          language: "liquid",
          source: "Summary {{ zt.title }}",
        },
      ],
    );

    expect(
      service.renderLiteratureNoteTemplateSource(source, { title: "Paper" }),
    ).toMatchObject({ create: expect.stringContaining("Summary Paper") });
  });

  it("keeps installed bundled partials local to their Profile for every render", async () => {
    const vault = new MockVault();
    const partial = '{% render "summary" with zt as zt %}';
    const source = exportLiteratureNotePack(
      literatureNoteDocument("Shared", partial)
        .replace("Managed {{ zt.title }}", partial)
        .replace('filename: "{{ zt.title }}"', `filename: '${partial}'`),
      [
        {
          name: "summary",
          language: "liquid",
          source: "Bundled {{ zt.title }}",
        },
      ],
    );
    vault.addFile("templates/zotlit-profile.shared.md", source);
    vault.addFile(
      "templates/zotlit-partial.summary.md",
      "Local {{ zt.title }}",
    );
    vault.addFile(
      "templates/zotlit-profile.local.md",
      literatureNoteDocument("Local").replace(
        "Managed {{ zt.title }}",
        partial,
      ),
    );
    const { service } = await makeHarness({ vault });
    const paths = [...vault.files.keys()];
    const document = service.getLiteratureNoteTemplate(
      "zotlit-profile.shared.md",
    )!;

    expect(document.renderForCreate({ title: "Paper" })).toContain(
      "Bundled Paper",
    );
    expect(document.renderForUpdate({ title: "Paper" })).toContain(
      "Bundled Paper",
    );
    expect(document.renderFilename({ title: "Paper" })).toBe("Bundled Paper");
    expect(document.renderAnnotation({ title: "Paper" })).toBe("Bundled Paper");
    expect(
      service
        .getLiteratureNoteTemplate("zotlit-profile.local.md")!
        .renderForCreate({ title: "Paper" }),
    ).toContain("Local Paper");
    expect([...vault.files.keys()]).toEqual(paths);
    expect(
      await vault.cachedRead(
        vault.getFileByPath("templates/zotlit-partial.summary.md")!,
      ),
    ).toBe("Local {{ zt.title }}");
  });

  it("keeps an installed bundled Eta partial behind the JavaScript consent gate", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.shared.md",
      exportLiteratureNotePack(
        literatureNoteDocument("Shared").replace(
          "Managed {{ zt.title }}",
          '{% render "summary" with zt as zt %}',
        ),
        [
          {
            name: "summary",
            language: "eta",
            source: "Bundled <%= zt.title %>",
          },
        ],
      ),
    );
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.getLiteratureNoteTemplate("zotlit-profile.shared.md"),
    ).toThrow(
      m.settings_template_inert_eta({
        path: "templates/zotlit-profile.shared.md",
      }),
    );
    await service.setJavascriptTemplatesEnabled(true);
    expect(
      service
        .getLiteratureNoteTemplate("zotlit-profile.shared.md")!
        .renderForCreate({ title: "Paper" }),
    ).toContain("Bundled Paper");
  });

  it("bounds the settle wait while initial settings are still loading", async () => {
    const loaded = deferred<Readonly<Settings>>();
    const vault = new MockVault();
    const localStorage = new Map<string, unknown>();
    const app = {
      vault,
      workspace: { updateOptions: vi.fn() },
      loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
      saveLocalStorage: (key: string, data: unknown) => {
        if (data === null) localStorage.delete(key);
        else localStorage.set(key, data);
      },
    } as unknown as Harness["app"];
    const settings = {
      current: null,
      loaded: loaded.promise,
      subscribe: vi.fn(() => () => {}),
    } as unknown as SettingsService;
    await using service = new TemplateService({
      app,
      settings,
    });
    const result = vi.fn();

    void service.waitUntilSettled(25).then(result);
    await vi.advanceTimersByTimeAsync(25);

    expect(result).toHaveBeenCalledWith("timeout");

    loaded.resolve(defaults);
    await service.ready;
  });

  it("distinguishes a failed startup from an expired settle wait", async () => {
    const loaded = deferred<Readonly<Settings>>();
    const vault = new MockVault();
    const app = {
      vault,
      workspace: { updateOptions: vi.fn() },
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    } as unknown as Harness["app"];
    const settings = {
      current: null,
      loaded: loaded.promise,
      subscribe: vi.fn(() => () => {}),
    } as unknown as SettingsService;
    const service = new TemplateService({
      app,
      settings,
    });
    service.ready.catch(() => {});

    const outcome = service.waitUntilSettled(25);
    loaded.reject(new Error("settings failed to load"));
    await flushAsync();

    expect(await outcome).toBe("init-failed");

    await service[Symbol.asyncDispose]();
  });

  it("renders embedded defaults when no vault file exists", async () => {
    const { service } = await makeHarness();

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("renders a vault template when present", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("fails loudly for a broken vault template instead of falling back to the default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(() => service.render("note", { title: "Paper" })).toThrow(
      TemplateError,
    );
    expect(service.compileErrors.get("note")).toBeDefined();
  });

  it("propagates a broken included template instead of rendering its default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-content.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    let failure: unknown;
    try {
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TemplateError);
    expect((failure as TemplateError).templateName).toBe("content");
    expect(service.compileErrors.get("content")).toBeDefined();
  });

  it.each([
    ["liquid", "{{ zt.citation }}"],
    ["eta", "<%= zt.citation %>"],
  ] as const)(
    "preserves a Citation Template compile failure through a %s citation getter",
    async (language, source) => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-citation.md", "{% if zt.title %}");
      vault.addFile(`templates/zotlit-note.${language}.md`, source);
      const { service } = await makeHarness({
        vault,
        javascriptTemplates: true,
      });
      const data = {
        get citation(): string {
          return service.render("citation", {});
        },
      };

      let failure: unknown;
      try {
        service.render("note", data);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TemplateError);
      expect((failure as TemplateError).templateName).toBe("citation");
      expect(service.compileErrors.get("citation")).toBeDefined();
    },
  );

  it("preserves an inert winner through a real Eta include error", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });
    const eta = new TemplateFacade();
    eta.define("parent", '<%~ include("citation", zt) %>', "eta");
    const data = {
      get citation(): string {
        return eta.render("parent", {});
      },
    };

    let failure: unknown;
    try {
      service.render("note", data);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InertTemplateError);
    expect((failure as InertTemplateError).templateName).toBe("citation");
  });

  it("leaves an application error untouched when its message names an inert template file", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });
    const thrown = new Error(
      "ENOENT: no such file or directory, open 'templates/zotlit-citation.md'",
    );
    const data = {
      get citation(): string {
        throw thrown;
      },
    };

    let failure: unknown;
    try {
      service.render("note", data);
    } catch (error) {
      failure = error;
    }

    // liquidjs wraps a throwing data getter in its own error type, so the
    // guard is the class the batch runners read: an application error whose
    // message happens to name an inert template file stays untyped, and the
    // thrown object stays reachable through the chain.
    expect(failure).not.toBeInstanceOf(InertTemplateError);
    expect(failure).not.toBeInstanceOf(TemplateError);
    expect((failure as { originalError?: unknown }).originalError).toBe(thrown);
  });

  it("surfaces the localized inert message for a nested inert render", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });
    const eta = new TemplateFacade();
    eta.define("parent", '<%~ include("citation", zt) %>', "eta");
    const data = {
      get citation(): string {
        return eta.render("parent", {});
      },
    };

    let failure: unknown;
    try {
      service.render("note", data);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InertTemplateError);
    expect((failure as InertTemplateError).message).toBe(
      m.settings_template_inert_eta({ path: "templates/zotlit-citation.md" }),
    );
  });

  it("classifies a liquid render of an inert name as inert", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-note.liquid.md",
      '{% render "citation" with zt as zt %}',
    );
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });

    let failure: unknown;
    try {
      service.render("note", { title: "Paper" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InertTemplateError);
    expect((failure as InertTemplateError).templateName).toBe("citation");
  });

  it("finds the inert template through an aggregated error chain", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });
    const data = {
      get citation(): string {
        throw new AggregateError(
          [new TemplateError('Template "citation" not found', "citation")],
          "render batch failed",
        );
      },
    };

    let failure: unknown;
    try {
      service.render("note", data);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InertTemplateError);
    expect((failure as InertTemplateError).templateName).toBe("citation");
  });

  it("records a compile error when a built-in default itself fails to compile", async () => {
    const original = DEFAULT_TEMPLATES.note;
    DEFAULT_TEMPLATES.note = "{% if zt.title %}";
    try {
      const { service } = await makeHarness();

      expect(() => service.render("note", { title: "Paper" })).toThrow();
      expect(service.compileErrors.get("note")).toBeDefined();
    } finally {
      DEFAULT_TEMPLATES.note = original;
    }
  });

  it("recovers once a broken template is fixed by a later modify event", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(() => service.render("note", { title: "A" })).toThrow();

    vault.modifyFile("templates/zotlit-note.eta.md", "fixed <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("fixed B");
    expect(service.compileErrors.get("note")).toBeUndefined();
  });

  it("refreshes compiled templates after debounced vault modify events", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "A" })).toBe("first A");
    vault.modifyFile("templates/zotlit-note.eta.md", "second <%= zt.title %>");

    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("second B");
  });

  it("refreshes a modified liquid template after debounced vault modify events", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "first {{ zt.title }}");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "A" })).toBe("first A");
    vault.modifyFile(
      "templates/zotlit-note.liquid.md",
      "second {{ zt.title }}",
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("second B");
  });

  it("rebuilds templates when the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "Paper" })).toBe("other Paper");
  });

  it("ignores stale template reads after the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });
    const staleRead = deferred<string>();

    vault.cachedRead.mockImplementation(async (file) => {
      if (file.path === "templates/zotlit-note.eta.md") {
        return await staleRead.promise;
      }
      return vault.contents.get(file.path) ?? "";
    });

    vault.modifyFile("templates/zotlit-note.eta.md", "stale <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "A" })).toBe("other A");

    staleRead.resolve("stale <%= zt.title %>");
    await flushAsync();

    expect(service.render("note", { title: "B" })).toBe("other B");
  });

  it("ignores stale template read failures after the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });
    const staleRead = deferred<string>();

    vault.cachedRead.mockImplementation(async (file) => {
      if (file.path === "templates/zotlit-note.eta.md") {
        return await staleRead.promise;
      }
      return vault.contents.get(file.path) ?? "";
    });

    vault.modifyFile("templates/zotlit-note.eta.md", "stale <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "A" })).toBe("other A");

    staleRead.reject(new Error("stale read failed"));
    await flushAsync();

    expect(service.render("note", { title: "B" })).toBe("other B");
  });

  it("drops partials from the previous folder when it changes", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-partial.custom.md",
      "---\nlanguage: eta\n---\ncustom <%= zt.title %>",
    );
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("custom", { title: "Paper" })).toBe("custom Paper");

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(() => service.render("custom", { title: "Paper" })).toThrow();
  });

  it("ignores template files in nested subfolders", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/nested/zotlit-note.eta.md",
      "nested <%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("renders a liquid override in place of the default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "custom {{ zt.title }}");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("prefers the liquid file over an eta file for the same name and reports the shadow", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
  });

  it("falls back to the eta file and clears the shadow when the liquid file is deleted", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    vault.deleteFile("templates/zotlit-note.liquid.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("E Paper");
    expect(service.shadowedFiles.get("note")).toBeUndefined();
  });

  it("flips to a newly created liquid file over an existing eta override via the watcher", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("E Paper");

    vault.createFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
  });

  it("flips a name's language when its file is renamed across extensions", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom {{ zt.title }}");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe(
      "custom {{ zt.title }}",
    );

    vault.renameFile(
      "templates/zotlit-note.eta.md",
      "templates/zotlit-note.liquid.md",
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("fails loudly for a broken liquid winner without falling back to a healthy eta file", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{% if zt.title %}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(() => service.render("note", { title: "Paper" })).toThrow();
    expect(service.compileErrors.get("note")).toBeDefined();
  });

  it("renders an ejected default liquid file the same as the embedded default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", DEFAULT_TEMPLATES.note);
    const { service } = await makeHarness({ vault });

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("synthesizes and verifies a legacy Profile document from current winners", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-note.liquid.md",
      'Before {% render "content" with zt as zt %} After {{ zt.title }}',
    );
    vault.addFile(
      "templates/zotlit-content.liquid.md",
      "Managed {{ zt.title }}",
    );
    vault.addFile(
      "templates/zotlit-filename.liquid.md",
      "{{ zt.citationKey }}",
    );
    vault.addFile(
      "templates/zotlit-annotation.liquid.md",
      "Annotation {{ zt.text }}",
    );
    vault.addFile(
      "templates/zotlit-annotation.eta.md",
      "Shadowed <%= zt.text %>",
    );
    const { service } = await makeHarness({ vault });

    const converted = await service.convertLegacyLiteratureNoteTemplates({
      note: { title: "Paper" },
      filename: { citationKey: "doePaper" },
      annotation: { text: "Excerpt" },
    });

    expect(converted.source).toContain(
      "{% managed %}Managed {{ zt.title }}{% endmanaged %}",
    );
    expect(converted.document.manifest.frontmatter).toEqual([
      { key: "title", expr: "zt.title", merge: "replace" },
      {
        key: "related",
        expr: "zt.relatedItems | note_links",
        merge: "replace",
      },
      {
        key: "collections",
        expr: "zt.collections | collection_paths",
        merge: "replace",
      },
      { key: "citekey", expr: "zt.citationKey", merge: "replace" },
    ]);
    expect(converted.legacyFiles).toEqual([
      "templates/zotlit-filename.liquid.md",
      "templates/zotlit-note.liquid.md",
      "templates/zotlit-annotation.liquid.md",
      "templates/zotlit-annotation.eta.md",
      "templates/zotlit-content.liquid.md",
    ]);
    expect(converted.document.annotationSection.source).toBe(
      "Annotation {{ zt.text }}",
    );
  });

  it("refuses conversion while an Eta Literature Note slot is inert", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-annotation.eta.md",
      "Annotation <%= zt.text %>",
    );
    const { service } = await makeHarness({ vault });

    expect(service.getLegacyLiteratureNoteTemplateFiles()).toContain(
      "templates/zotlit-annotation.eta.md",
    );
    await expect(
      service.convertLegacyLiteratureNoteTemplates({
        note: { title: "Paper" },
        filename: { citationKey: "doePaper" },
        annotation: { text: "Excerpt" },
      }),
    ).rejects.toMatchObject({
      code: "unsupported-legacy-template",
      difference: "inert template",
    });
  });

  it("retires Literature Note slots after conversion", async () => {
    const { service, settings } = await makeHarness({
      settings: { "note.template-conversion-pending": true },
    });

    expect(service.getTemplateFileStatuses().map(({ name }) => name)).toEqual([
      "filename",
      "note",
      "annotation",
      "content",
    ]);

    settings.update({ "note.template-conversion-pending": false });

    // Nothing remains: Profile documents own the note sources and the Citation
    // Template owns the citation text.
    expect(service.getTemplateFileStatuses()).toEqual([]);
  });

  it("renders both Citation Variants from the built-in text", async () => {
    // A vault holding no zotlit-citation.md still inserts what 2.1.x's cite
    // and cite2 wrote: bracketed on Enter, Author-in-text on Shift+Enter.
    const { service } = await makeHarness();

    expect(service.renderCitation([{ citationKey: "smith2024" }], "main")).toBe(
      "[@smith2024]",
    );
    expect(service.renderCitation([{ citationKey: "smith2024" }], "alt")).toBe(
      "@smith2024",
    );
  });

  it("renders both variants from one document that branches on zt.variant", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-citation.md",
      "{% if zt.variant == 'alt' %}~{{ zt.citations[0].item.citationKey }}~" +
        "{% else %}<{{ zt.citations[0].item.citationKey }}>{% endif %}",
    );
    const { service } = await makeHarness({ vault });

    expect(service.renderCitation([{ citationKey: "smith2024" }], "main")).toBe(
      "<smith2024>",
    );
    expect(service.renderCitation([{ citationKey: "smith2024" }], "alt")).toBe(
      "~smith2024~",
    );
  });

  it("normalizes a multi-line Citation Template to its inline form", async () => {
    // A Citation is an in-text token, and a vault document ends with a
    // newline: whatever whitespace the document renders, line-break runs
    // collapse to one space and the ends are trimmed, so nothing breaks the
    // line the citation is inserted into.
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-citation.md",
      "[{{ zt.citations[0].item.citationKey }},\n   p. 1]   \n\n",
    );
    const { service } = await makeHarness({ vault });

    expect(service.renderCitation([{ citationKey: "smith2024" }], "main")).toBe(
      "[smith2024, p. 1]",
    );
  });

  it("carries an annotation's page locator into the rendered citation", async () => {
    const { service } = await makeHarness();

    expect(
      service.renderCitation(
        [{ citationKey: "smith2024", label: "page", locator: "62" }],
        "main",
      ),
    ).toBe("[@smith2024, {p. 62}]");
  });

  it("keeps an Eta Citation Template inert while JavaScript Templates are off", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= pandocCite(zt.citations) %>",
    );
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.renderCitation([{ citationKey: "smith2024" }], "main"),
    ).toThrow(
      m.settings_template_inert_eta({ path: "templates/zotlit-citation.md" }),
    );
    expect(service.getCitationTemplateStatus()).toMatchObject({
      customized: true,
      language: "liquid",
      inertPath: "templates/zotlit-citation.md",
    });
  });

  it("renders an Eta Citation Template once JavaScript Templates are on", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-citation.md",
      "---\nlanguage: eta\n---\n<%= pandocCite(zt.citations, zt.variant === 'alt' ? 'prefer-author-in-text' : 'normal') %>",
    );
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.renderCitation([{ citationKey: "smith2024" }], "alt")).toBe(
      "@smith2024",
    );
    expect(service.getCitationTemplateStatus()).toMatchObject({
      customized: true,
      language: "eta",
      inertPath: null,
    });
  });

  it("materializes the Citation Template during startup, once the scan lands", async () => {
    // "Customize citation text" is registered before the folder scan finishes,
    // so an invocation mid-startup waits for the scan rather than failing the
    // loaded-state check and reporting a notice.
    const { service, vault } = await makeHarness({ skipReady: true });
    expect(service.loaded).toBe(false);

    const materialized = service.materializeCitationTemplate();
    await vi.advanceTimersByTimeAsync(500);
    const file = await materialized;

    expect(file.path).toBe("templates/zotlit-citation.md");
    expect(vault.contents.get(file.path)).toBe(CITATION_TEMPLATE_SOURCE);
  });

  it("materializes the Citation Template from the built-in text and restores it", async () => {
    const { service, vault } = await makeHarness();

    expect(service.getCitationTemplateStatus()).toMatchObject({
      path: "templates/zotlit-citation.md",
      customized: false,
      language: "liquid",
      compileError: null,
    });

    const materialized = service.materializeCitationTemplate();
    await vi.advanceTimersByTimeAsync(500);
    const file = await materialized;

    expect(file.path).toBe("templates/zotlit-citation.md");
    expect(vault.contents.get(file.path)).toBe(CITATION_TEMPLATE_SOURCE);
    expect(service.getCitationTemplateStatus().customized).toBe(true);

    // Opening an existing document hands it back rather than overwriting it.
    vault.modifyFile(file.path, "EDITED {{ zt.variant }}");
    await vi.advanceTimersByTimeAsync(500);
    expect((await service.materializeCitationTemplate()).path).toBe(file.path);
    expect(vault.contents.get(file.path)).toBe("EDITED {{ zt.variant }}");
    expect(service.renderCitation([{ citationKey: "smith2024" }], "alt")).toBe(
      "EDITED alt",
    );

    const restored = service.restoreCitationTemplate();
    await vi.advanceTimersByTimeAsync(500);
    await restored;

    expect(vault.getFileByPath(file.path)).toBeNull();
    expect(service.getCitationTemplateStatus().customized).toBe(false);
    expect(service.renderCitation([{ citationKey: "smith2024" }], "main")).toBe(
      "[@smith2024]",
    );
  });

  it("offers the Citation Template to a pack that asks for it by name", async () => {
    // The web bridge names it whether the draft calls it or not, because the
    // page renders each annotation's citation through it.
    const vault = new MockVault();
    vault.addFile("templates/zotlit-citation.md", "[[{{ zt.variant }}]]");
    const { service } = await makeHarness({ vault });

    const exported = new TemplateFacade().parseLiteratureNoteTemplate(
      await service.exportLiteratureNotePackSource(
        literatureNoteDocument("Books"),
        { include: ["citation"] },
      ),
    );

    expect(exported.manifest.partials).toContainEqual({
      name: "citation",
      language: "liquid",
      source: "[[{{ zt.variant }}]]",
    });
  });

  it("reports the winner the reconciler compiled", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    const statuses = service.getTemplateFileStatuses();

    expect(statuses.find((entry) => entry.name === "note")).toMatchObject({
      winner: {
        language: "eta",
        source: { kind: "vault", path: "templates/zotlit-note.eta.md" },
      },
      editablePath: "templates/zotlit-note.eta.md",
    });
    expect(statuses.find((entry) => entry.name === "content")).toMatchObject({
      winner: { language: "liquid", source: { kind: "embedded-default" } },
      editablePath: "templates/zotlit-content.liquid.md",
    });
  });

  it("templatePath emits the extension for the requested language", () => {
    expect(templatePath("templates", "note")).toBe(
      "templates/zotlit-note.liquid.md",
    );
    expect(templatePath("", "note", "eta")).toBe("zotlit-note.eta.md");
  });

  it("unsubscribes vault events on dispose", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    await service[Symbol.asyncDispose]();
    vault.modifyFile("templates/zotlit-note.eta.md", "second <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    expect(vault.cachedRead).toHaveBeenCalledTimes(1);
  });

  describe("filename template", () => {
    it("renders the embedded default when no filename file exists", async () => {
      const { service } = await makeHarness();

      expect(
        service.renderFilename({
          citationKey: "smith2024",
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("smith2024%zt-suffix:6:_:%");
      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: null,
          key: "AB12CD34",
        }),
      ).toBe("AB12CD34%zt-suffix:6:_:%");
    });

    it("renders a vault filename file in place of the default", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "custom-{{ zt.title }}",
      );
      const { service } = await makeHarness({ vault });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("custom-Paper");
    });

    it("applies filename file edits through the watcher", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "custom-{{ zt.title }}",
      );
      const { service } = await makeHarness({ vault });

      vault.modifyFile(
        "templates/zotlit-filename.liquid.md",
        "updated-{{ zt.title }}",
      );
      await vi.advanceTimersByTimeAsync(500);

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("updated-Paper");
    });

    it("collapses multi-line filename output to a single trimmed line", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "{{ zt.title }}\n{% suffix %}\n",
      );
      const { service } = await makeHarness({ vault });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("Paper%zt-suffix:6:_:%");
    });

    it("fails loudly for a broken filename file instead of falling back to the default", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.liquid.md", "{% if zt.title %}");
      const { service } = await makeHarness({ vault });

      expect(() =>
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toThrow();
      expect(service.compileErrors.get("filename")).toBeDefined();
    });

    it("renders an eta filename file when no liquid edition exists", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.eta.md", "<%= zt.title %>-eta");
      const { service } = await makeHarness({
        vault,
        javascriptTemplates: true,
      });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("Paper-eta");
    });

    it("throws InertTemplateError for an eta-only filename file when the gate is off", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.eta.md", "<%= zt.title %>-eta");
      const { service } = await makeHarness({ vault });

      expect(() =>
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toThrow(InertTemplateError);
    });
  });
});

describe("javascript templates gate", () => {
  it("is off by default", async () => {
    const { service } = await makeHarness();

    expect(service.javascriptTemplatesEnabled).toBe(false);
  });

  it("throws InertTemplateError naming the file for an eta-only override when the gate is off", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toThrow(InertTemplateError);
    expect(() => service.render("note", { title: "Paper" })).toThrow(
      "templates/zotlit-note.eta.md",
    );
    expect(service.inertEtaFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
    expect(service.compileErrors.get("note")).toBeUndefined();
  });

  it("reports no active winner for an inert eta-only name", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(
      service.getTemplateFileStatuses().find((entry) => entry.name === "note"),
    ).toMatchObject({
      winner: { language: "eta", source: { kind: "none" } },
      editablePath: "templates/zotlit-note.liquid.md",
      inertFiles: ["templates/zotlit-note.eta.md"],
      compileError: null,
    });
  });

  it("reports a shadowed eta file as shadowed, not inert, even when the gate is off", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
    expect(service.inertEtaFiles.get("note")).toBeUndefined();
  });

  it("renders the eta override when the gate is pre-seeded on", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
    expect(service.inertEtaFiles.size).toBe(0);
  });

  it("takes effect live when toggled, without a reload", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service, localStorage } = await makeHarness({ vault });
    const data = {
      title: "Paper",
      backlink: "zotero://select/items/1",
      attachments: [],
      annotations: [],
      notes: [],
    };

    expect(() => service.render("note", data)).toThrow(InertTemplateError);

    await service.setJavascriptTemplatesEnabled(true);

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
    expect(service.inertEtaFiles.size).toBe(0);
    expect(localStorage.get("zotlit-javascript-templates")).toBe("1");

    await service.setJavascriptTemplatesEnabled(false);

    expect(() => service.render("note", data)).toThrow(InertTemplateError);
    expect(localStorage.has("zotlit-javascript-templates")).toBe(false);
  });

  it("never persists the flag through synced plugin settings", async () => {
    const { service, plugin, settings } = await makeHarness();

    await service.setJavascriptTemplatesEnabled(true);

    expect(JSON.stringify(plugin.data)).not.toContain("javascript-templates");
    expect(JSON.stringify(settings.current)).not.toContain(
      "javascript-templates",
    );
  });
});

describe("validateFrontmatterExpr", () => {
  it("validates liquid in its declared language regardless of the gate", async () => {
    const { service } = await makeHarness();

    expect(service.validateFrontmatterExpr("zt.title", "liquid")).toBeNull();
    expect(service.validateFrontmatterExpr("1 +", "liquid")).toEqual(
      expect.any(String),
    );
  });

  it("validates javascript in its declared language when the gate is on", async () => {
    const { service } = await makeHarness({ javascriptTemplates: true });

    expect(
      service.validateFrontmatterExpr("zt.title", "javascript"),
    ).toBeNull();
    expect(service.validateFrontmatterExpr("1 +", "javascript")).toEqual(
      expect.any(String),
    );
  });

  it("never compile-validates javascript while the gate is off", async () => {
    const { service } = await makeHarness();

    expect(service.validateFrontmatterExpr("1 +", "javascript")).toBeNull();
  });
});

describe("frontmatter fields", () => {
  it("compiles the default liquid fields and evaluates typed values with the gate off", async () => {
    const { service } = await makeHarness();

    expect(service.javascriptTemplatesEnabled).toBe(false);
    const result = evalFrontmatterFields(service.frontmatterFields, {
      title: "A Study",
      relatedItems: [{ indexedKey: "A1", noteLink: () => "[[Related A]]" }],
      collections: [{ path: ["Top", "Sub"] }],
    });

    expect(result).toEqual({
      title: "A Study",
      related: ["[[Related A]]"],
      collections: ["Top/Sub"],
    });
  });

  it("throws InertTemplateError naming the field when a javascript field is inert with the gate off", async () => {
    const { service } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "note_liquid",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
          {
            key: "note_js",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
    });

    expect(() => service.frontmatterFields).toThrow(InertTemplateError);
    expect(() => service.frontmatterFields).toThrow("note_js");
  });

  it("compiles and evaluates a javascript field when the gate is pre-seeded on, with no throw", async () => {
    const { service } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "note_liquid",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
          {
            key: "note_js",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
      javascriptTemplates: true,
    });

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "note_liquid",
      "note_js",
    ]);

    const result = evalFrontmatterFields(service.frontmatterFields, {
      title: "Hi",
    });
    expect(result).toEqual({ note_liquid: "Hi", note_js: "Hi" });
  });

  it("recompiles when note.frontmatter-fields changes via settings.update", async () => {
    const { service, settings } = await makeHarness();

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "title",
      "related",
      "collections",
      "citekey",
    ]);

    settings.update({
      "note.frontmatter-fields": [
        {
          key: "custom",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
      ],
    });

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "custom",
    ]);
  });

  it("keeps throwing across settings updates and gate flips", async () => {
    const { service, settings } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "js1",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
    });

    expect(() => service.frontmatterFields).toThrow(InertTemplateError);

    settings.update({
      "note.frontmatter-fields": [
        {
          key: "js1",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "js2",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
      ],
    });
    expect(() => service.frontmatterFields).toThrow(InertTemplateError);

    await service.setJavascriptTemplatesEnabled(true);
    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "js1",
      "js2",
    ]);

    await service.setJavascriptTemplatesEnabled(false);
    expect(() => service.frontmatterFields).toThrow(InertTemplateError);
  });
});

describe("Template Document kinds", () => {
  it("classifies a Profile document, the Citation Template, and a partial by prefix", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books"),
    );
    vault.addFile("templates/zotlit-citation.md", "{{ zt.citations }}");
    vault.addFile(
      "templates/zotlit-partial.authors.md",
      "Authors: {{ zt.authors }}",
    );
    const { service } = await makeHarness({ vault });

    expect(
      service
        .getLiteratureNoteTemplateStatuses()
        .map(({ reference }) => reference),
    ).toEqual(["zotlit-profile.books.md"]);
    expect(service.render("authors", { authors: "Ada Lovelace" })).toBe(
      "Authors: Ada Lovelace",
    );
    expect(service.getUnrecognizedFiles()).toEqual([]);
  });

  it("renders a Liquid partial with no manifest while a note is created", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-partial.authors.md",
      "Authors: {{ zt.authors }}",
    );
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books").replace(
        "Managed {{ zt.title }}",
        '{% render "authors" with zt as zt %}',
      ),
    );
    const { service } = await makeHarness({ vault });

    expect(
      service
        .getLiteratureNoteTemplate("zotlit-profile.books.md")!
        .renderForCreate({ title: "Paper", authors: "Ada Lovelace" }),
    ).toContain("Authors: Ada Lovelace");
  });

  it("keeps an Eta partial inert until the JavaScript Templates gate is on", async () => {
    const path = "templates/zotlit-partial.authors.md";
    const vault = new MockVault();
    vault.addFile(path, "---\nlanguage: eta\n---\nAuthors: <%= zt.authors %>");
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.render("authors", { authors: "Ada Lovelace" }),
    ).toThrow(m.settings_template_inert_eta({ path }));

    await service.setJavascriptTemplatesEnabled(true);

    expect(service.render("authors", { authors: "Ada Lovelace" })).toBe(
      "Authors: Ada Lovelace",
    );
  });

  it("names the document behind a partial, registered or not", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.authors.md", "{{ zt.authors }}");
    vault.addFile(
      "templates/zotlit-partial.venue.md",
      "---\nlanguage: eta\n---\n<%= zt.venue %>",
    );
    vault.addFile("templates/zotlit-partial.broken.md", "---\nlanguage\n---\n");
    const { service } = await makeHarness({ vault });

    expect(service.getPartialDocument("authors")).toEqual({
      name: "authors",
      path: "templates/zotlit-partial.authors.md",
      language: "liquid",
    });
    // The gate keeps this one inert, but the document still owns the name.
    expect(service.getPartialDocument("venue")).toEqual({
      name: "venue",
      path: "templates/zotlit-partial.venue.md",
      language: "eta",
    });
    // A manifest the parser refused names no language, so Liquid stands in.
    expect(service.getPartialDocument("broken")).toEqual({
      name: "broken",
      path: "templates/zotlit-partial.broken.md",
      language: "liquid",
    });
    expect(service.getPartialDocument("missing")).toBeNull();
  });

  it("reports a call to a partial the folder holds no document for as missing", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books").replace(
        "Managed {{ zt.title }}",
        '{% render "venue-line" %}',
      ),
    );
    const { service } = await makeHarness({ vault });

    expect(() =>
      service
        .getLiteratureNoteTemplate("zotlit-profile.books.md")!
        .renderForCreate({ title: "Paper" }),
    ).toThrowError(
      expect.objectContaining<Partial<MissingPartialError>>({
        name: "MissingTemplateError",
        templateName: "venue-line",
        // The refusal notice opens the Workbench here, not on the Default
        // Profile, so the reader lands on the call to repair.
        documentPath: "templates/zotlit-profile.books.md",
      }),
    );
  });

  it("reports an Eta partial inert when a Profile renders it with the gate off", async () => {
    const path = "templates/zotlit-partial.authors.md";
    const vault = new MockVault();
    vault.addFile(path, "---\nlanguage: eta\n---\nAuthors: <%= zt.authors %>");
    vault.addFile(
      "templates/zotlit-profile.books.md",
      literatureNoteDocument("Books").replace(
        "Managed {{ zt.title }}",
        '{% render "authors" with zt as zt %}',
      ),
    );
    const { service } = await makeHarness({ vault });

    expect(() =>
      service
        .getLiteratureNoteTemplate("zotlit-profile.books.md")!
        .renderForCreate({ title: "Paper", authors: "Ada Lovelace" }),
    ).toThrow(m.settings_template_inert_eta({ path }));
  });

  it("re-registers a partial under its new name on rename and drops it on delete", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-partial.authors.md",
      "Authors: {{ zt.authors }}",
    );
    const { service } = await makeHarness({ vault });
    const data = { authors: "Ada Lovelace" };

    expect(service.render("authors", data)).toBe("Authors: Ada Lovelace");

    vault.renameFile(
      "templates/zotlit-partial.authors.md",
      "templates/zotlit-partial.creators.md",
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("creators", data)).toBe("Authors: Ada Lovelace");
    expect(() => service.render("authors", data)).toThrowError(
      expect.objectContaining<Partial<TemplateError>>({
        templateName: "authors",
      }),
    );

    vault.deleteFile("templates/zotlit-partial.creators.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(() => service.render("creators", data)).toThrowError(
      expect.objectContaining<Partial<TemplateError>>({
        templateName: "creators",
      }),
    );
  });

  it("keeps a converted partial registered when its legacy file is deleted later", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-authors.liquid.md", "By {{ zt.authors }}");
    const { service } = await makeHarness({ vault });
    const data = { authors: "Ada Lovelace" };

    // The conversion writes the partial document first and trashes the legacy
    // file after, so the two events can land in separate debounce windows.
    vault.createFile(
      "templates/zotlit-partial.authors.md",
      "---\nlanguage: liquid\n---\nBy {{ zt.authors }}",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(service.render("authors", data)).toBe("By Ada Lovelace");

    vault.deleteFile("templates/zotlit-authors.liquid.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("authors", data)).toBe("By Ada Lovelace");
  });

  it("names a zotlit- file no kind claims and ignores a file without the prefix", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-foo.md", "Stray");
    vault.addFile("templates/notes.md", "A note of my own");
    const { service } = await makeHarness({ vault });

    expect(service.getUnrecognizedFiles()).toEqual(["templates/zotlit-foo.md"]);
    expect(service.getLiteratureNoteTemplateStatuses()).toEqual([]);

    vault.deleteFile("templates/zotlit-foo.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.getUnrecognizedFiles()).toEqual([]);
  });

  it("lists the remaining 2.1.x cite and partial files as convertible", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-cite.liquid.md", "{{ zt.citations }}");
    vault.addFile("templates/zotlit-cite2.eta.md", "<%= zt.citations %>");
    vault.addFile("templates/zotlit-authors.liquid.md", "By {{ zt.authors }}");
    vault.addFile("templates/zotlit-citation.liquid.md", "Reserved");
    const { service } = await makeHarness({ vault });

    expect(service.getLegacyTemplateDocuments()).toEqual({
      citation: [
        {
          name: "cite",
          path: "templates/zotlit-cite.liquid.md",
          language: "liquid",
          inert: false,
          shadowed: [],
        },
        {
          name: "cite2",
          path: "templates/zotlit-cite2.eta.md",
          language: "eta",
          inert: true,
          shadowed: [],
        },
      ],
      partials: [
        {
          name: "authors",
          path: "templates/zotlit-authors.liquid.md",
          language: "liquid",
          inert: false,
          shadowed: [],
        },
      ],
    });
    // A legacy partial still answers by its bare name, the way 2.1.x
    // registered it, so a note template that calls it keeps rendering.
    expect(service.render("authors", { authors: "Ada Lovelace" })).toBe(
      "By Ada Lovelace",
    );
    // `citation` is the Citation Template's name; the extension-named file
    // claiming it is reported instead of registered.
    expect(service.getUnrecognizedFiles()).toEqual([
      "templates/zotlit-citation.liquid.md",
    ]);
  });

  it("refuses a legacy citation that renders a Literature Note slot the same pass retires", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-cite.liquid.md",
      '[{% render "filename" with zt as zt %}]',
    );
    // The reader's own slot files, which this one pass folds into the default
    // Profile document and trashes: after it, `filename` is the built-in again.
    vault.addFile("templates/zotlit-filename.liquid.md", "my-own-filename");
    vault.addFile("templates/zotlit-note.liquid.md", "# {{ zt.title }}");
    const { service } = await makeHarness({ vault });

    await expect(
      service.convertLegacyTemplateDocuments([{ citationKey: "doe2020" }]),
    ).rejects.toMatchObject({
      code: "unsupported-legacy-template",
      difference: "citation render",
    });
    expect(vault.contents.get("templates/zotlit-filename.liquid.md")).toBe(
      "my-own-filename",
    );
  });

  it("names every Shared Partial the folder holds, sorted", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.venue-line.md", "{{ zt.venue }}");
    vault.addFile("templates/zotlit-partial.authors.md", "{{ zt.authors }}");
    // A document the parser refuses still owns its name: the file exists.
    vault.addFile(
      "templates/zotlit-partial.broken.md",
      "---\nlanguage: liquid\n",
    );
    const { service } = await makeHarness({ vault });

    expect(service.getPartialNames()).toEqual([
      "authors",
      "broken",
      "venue-line",
    ]);
    expect(service.getPartialDocuments()).toEqual([
      {
        name: "authors",
        path: "templates/zotlit-partial.authors.md",
        language: "liquid",
      },
      {
        name: "broken",
        path: "templates/zotlit-partial.broken.md",
        language: "liquid",
      },
      {
        name: "venue-line",
        path: "templates/zotlit-partial.venue-line.md",
        language: "liquid",
      },
    ]);
  });

  it("unpacks a bundle's partials into files and keeps the reader's own", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.authors.md", "Mine");
    vault.addFile(
      "templates/zotlit-partial.summary.md",
      "---\nlanguage: liquid\n---\nShared body",
    );
    const { service } = await makeHarness({ vault });
    const bundled = [
      { name: "summary", language: "liquid", source: "Shared body" },
      { name: "authors", language: "liquid", source: "Theirs" },
      { name: "venue-line", language: "liquid", source: "{{ zt.venue }}" },
      // The Citation Template travels under its own name and has a document of
      // its own, so nothing is written for it and its entry can go.
      { name: "citation", language: "liquid", source: "Their citation" },
    ] as const;

    const plan = service.planPartialUnpack(bundled);
    expect(plan.map(({ name, verdict }) => `${name}:${verdict}`)).toEqual([
      "summary:unchanged",
      "authors:conflict",
      "venue-line:write",
      "citation:unchanged",
    ]);

    const outcome = service.unpackPartials(plan);
    await vi.advanceTimersByTimeAsync(500);

    // Nothing was approved, so the reader's own authors stands — and its entry
    // goes with the rest, because their document answers that name from here.
    expect(await outcome).toEqual({
      written: ["venue-line"],
      kept: ["authors"],
      dropped: ["summary", "authors", "venue-line", "citation"],
      refused: [],
      otherCase: [],
    });
    expect(vault.contents.get("templates/zotlit-partial.venue-line.md")).toBe(
      "---\nlanguage: liquid\n---\n{{ zt.venue }}",
    );
    expect(vault.contents.get("templates/zotlit-partial.authors.md")).toBe(
      "Mine",
    );
    expect(
      vault.getFileByPath("templates/zotlit-partial.citation.md"),
    ).toBeNull();
    expect(service.render("venue-line", { venue: "JMLR" })).toBe("JMLR");

    // Re-planned against the folder as it stands now, with authors approved.
    const replaced = service.unpackPartials(
      service.planPartialUnpack(bundled),
      {
        replace: ["authors"],
      },
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(await replaced).toMatchObject({ written: ["authors"], kept: [] });
    expect(vault.contents.get("templates/zotlit-partial.authors.md")).toBe(
      "---\nlanguage: liquid\n---\nTheirs",
    );
  });

  it("keeps the transport copy of a partial the folder answers only in another case", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.authors.md", "{{ zt.authors }}");
    const { service } = await makeHarness({ vault });
    const bundled = [
      { name: "Authors", language: "liquid", source: "{{ zt.authors }}" },
    ] as const;

    const plan = service.planPartialUnpack(bundled);
    expect(plan.map(({ name, verdict }) => `${name}:${verdict}`)).toEqual([
      "Authors:other-case",
    ]);

    const outcome = await service.unpackPartials(plan);

    expect(outcome).toEqual({
      written: [],
      kept: [],
      dropped: [],
      refused: [],
      otherCase: ["Authors"],
    });
    // One file answers both names on a case-insensitive filesystem, so nothing
    // is written — and the vault's own document is left exactly as it is.
    expect([...vault.contents.keys()]).toEqual([
      "templates/zotlit-partial.authors.md",
    ]);
    // A Shared Partial resolves by exact name, so the manifest copy is all
    // that answers `{% render "Authors" %}`: its entry has to stay.
    expect(() =>
      service.render("Authors", { authors: "Ada Lovelace" }),
    ).toThrowError(
      expect.objectContaining<Partial<TemplateError>>({
        templateName: "Authors",
      }),
    );
  });

  it("keeps a partial file that appeared after the plan, and refuses a name no file can hold", async () => {
    const vault = new MockVault();
    const { service } = await makeHarness({ vault });
    const plan = service.planPartialUnpack([
      { name: "authors", language: "liquid", source: "Theirs" },
      { name: "../../../escape", language: "liquid", source: "Escaped" },
    ]);
    // The plan says up front that the escaping name reaches no file, so an
    // import never announces it as one it will write.
    expect(plan.map(({ name, verdict }) => `${name}:${verdict}`)).toEqual([
      "authors:write",
      "../../../escape:refused",
    ]);

    // The reader writes their own authors between the plan and the write.
    vault.createFile("templates/zotlit-partial.authors.md", "Mine");
    const outcome = service.unpackPartials(plan);
    await vi.advanceTimersByTimeAsync(500);

    expect(vault.contents.get("templates/zotlit-partial.authors.md")).toBe(
      "Mine",
    );
    // Nothing else was written: no second document, and none outside the folder.
    expect([...vault.contents.keys()]).toEqual([
      "templates/zotlit-partial.authors.md",
    ]);
    // The refused name keeps its manifest entry, and the outcome names it, so
    // the caller can say why Unpack partials left the bundle carrying it.
    expect(await outcome).toEqual({
      written: [],
      kept: ["authors"],
      dropped: ["authors"],
      refused: ["../../../escape"],
      otherCase: [],
    });
  });

  it("bundles a partial the JavaScript Templates gate left inert, and skips one that will not parse", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-partial.scripted.md",
      "---\nlanguage: eta\n---\n<%= it.title %>",
    );
    vault.addFile("templates/zotlit-partial.authors.md", "{{ zt.authors }}");
    vault.addFile(
      "templates/zotlit-partial.broken.md",
      "---\nlanguage: liquid\n",
    );
    // The gate is off, so `scripted` renders nothing on this device.
    const { service } = await makeHarness({ vault });

    expect(service.render("authors", { authors: "Rougier" })).toBe("Rougier");
    // The reader can still share the text they wrote; the recipient's own gate
    // decides whether it runs there. A document with no readable source cannot
    // travel at all.
    expect(service.getPartialEntries()).toEqual([
      { name: "authors", language: "liquid", source: "{{ zt.authors }}" },
      { name: "scripted", language: "eta", source: "<%= it.title %>" },
    ]);
  });

  it("creates a Shared Partial that renders at once and trashes it again", async () => {
    const { service, vault } = await makeHarness();

    const created = service.createPartial("venue-line", {
      source: "{{ zt.venue }}",
    });
    await vi.advanceTimersByTimeAsync(500);
    const file = await created;

    expect(file.path).toBe("templates/zotlit-partial.venue-line.md");
    expect(vault.contents.get(file.path)).toBe("{{ zt.venue }}");
    expect(service.getPartialNames()).toEqual(["venue-line"]);
    expect(service.render("venue-line", { venue: "JMLR" })).toBe("JMLR");

    const deleted = service.deletePartial("venue-line");
    await vi.advanceTimersByTimeAsync(500);
    await deleted;

    expect(vault.getFileByPath(file.path)).toBeNull();
    expect(service.getPartialNames()).toEqual([]);
  });

  it("writes the language manifest only for an Eta partial", async () => {
    const { service, vault } = await makeHarness({ javascriptTemplates: true });

    const created = service.createPartial("venue-line", {
      source: "<%= zt.venue %>",
      language: "eta",
    });
    await vi.advanceTimersByTimeAsync(500);
    const file = await created;

    expect(vault.contents.get(file.path)).toBe(
      "---\nlanguage: eta\n---\n<%= zt.venue %>",
    );
    expect(service.getPartialDocument("venue-line")).toEqual({
      name: "venue-line",
      path: file.path,
      language: "eta",
    });
  });

  it("refuses a name the rule rejects before writing anything", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.authors.md", "{{ zt.authors }}");
    const { service } = await makeHarness({ vault });

    await expect(service.createPartial("citation")).rejects.toMatchObject({
      name: "PartialNameError",
      refusal: "reserved",
    });
    await expect(service.createPartial("authors")).rejects.toMatchObject({
      refusal: "duplicate",
    });
    await expect(service.createPartial("venue line")).rejects.toMatchObject({
      refusal: "characters",
    });
    expect(service.getPartialNames()).toEqual(["authors"]);
  });

  it("reports a partial file whose name another Template answers to", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-partial.citation.md", "Mine");
    vault.addFile("templates/zotlit-partial.annotation.md", "Mine too");
    const { service } = await makeHarness({ vault });

    expect(service.getReservedPartialFiles()).toEqual([
      { name: "annotation", path: "templates/zotlit-partial.annotation.md" },
      { name: "citation", path: "templates/zotlit-partial.citation.md" },
    ]);
    expect(service.getPartialNames()).toEqual([]);
    // The Citation Template still renders its own built-in text.
    expect(service.renderCitation([{ citationKey: "smith2024" }], "main")).toBe(
      "[@smith2024]",
    );

    vault.deleteFile("templates/zotlit-partial.annotation.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.getReservedPartialFiles()).toEqual([
      { name: "citation", path: "templates/zotlit-partial.citation.md" },
    ]);
  });

  it("keeps a slot-named partial file out of the template namespace", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-partial.filename.md",
      "Renamed by a partial",
    );
    const { service } = await makeHarness({ vault });

    // One namespace: registering this file would name every Literature Note.
    expect(
      service.renderFilename({
        citationKey: "smith2024",
        DOI: null,
        title: "Paper",
        key: "AB12CD34",
      }),
    ).toBe("smith2024%zt-suffix:6:_:%");
    expect(service.getPartialNames()).toEqual([]);
    expect(service.getReservedPartialFiles()).toEqual([
      { name: "filename", path: "templates/zotlit-partial.filename.md" },
    ]);
  });
});

async function makeHarness(options?: {
  settings?: Record<string, unknown>;
  vault?: MockVault;
  javascriptTemplates?: boolean;
  /** Hand the service back mid-startup, the way a command invoked during the
   *  initial folder scan reaches it. */
  skipReady?: boolean;
}): Promise<Harness> {
  const vault = options?.vault ?? new MockVault();
  const localStorage = new Map<string, unknown>();
  if (options?.javascriptTemplates) {
    localStorage.set("zotlit-javascript-templates", "1");
  }
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
    fileManager: {
      trashFile: async (file: { path: string }) => {
        vault.deleteFile(file.path);
      },
    },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  } as unknown as Harness["app"];
  const plugin = new PluginStub(app, {
    __VERSION__: 1,
    "note.template-conversion-pending": true,
    ...options?.settings,
  });
  const settings = new SettingsService({
    plugin,
    migrateLegacy: (raw) => raw,
    migrateV1: (raw) => raw,
    migrateV2: (raw) => raw,
    migrateV3: (raw) => raw,
    migrateV4: (raw) => raw,
    migrateV5: (raw) => raw,
    migrateV6: (raw) => raw,
    migrateV7: (raw) => raw,
    migrateV8: (raw) => raw,
    migrateV9: (raw) => raw,
  });
  await settings.ready;

  const service = new TemplateService({
    app,
    settings,
  });
  if (!options?.skipReady) await service.ready;

  const harness = { app, plugin, service, settings, vault, localStorage };
  harnesses.push(harness);
  return harness;
}

function literatureNoteDocument(heading: string, annotation?: string): string {
  return `---
id: books
name: Books
version: 1.0.0
author: ZotLit
description: Books fixture
contract: 1
filename: "{{ zt.title }}"
---
# ${heading} {{ zt.title }}

{% managed %}Managed {{ zt.title }}{% endmanaged %}
--- zotlit:annotation ---\n${annotation ?? "Annotation"}`;
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
