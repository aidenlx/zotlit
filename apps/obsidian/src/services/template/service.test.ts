import type { App, Plugin } from "obsidian";
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

import { DEFAULT_TEMPLATES, templatePath } from "./defaults";
import { InertTemplateError } from "./errors";
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
    vault.addFile("templates/books.md", literatureNoteDocument("Books"));
    const { service } = await makeHarness({ vault });

    expect(
      service
        .getLiteratureNoteTemplate("books.md")
        ?.renderForCreate({ title: "First" }),
    ).toContain("# Books First");

    vault.modifyFile(
      "templates/books.md",
      literatureNoteDocument("Revised books"),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(
      service
        .getLiteratureNoteTemplate("books.md")
        ?.renderForCreate({ title: "Second" }),
    ).toContain("# Revised books Second");

    vault.deleteFile("templates/books.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.getLiteratureNoteTemplate("books.md")).toBeUndefined();
  });

  it("compiles document frontmatter with the per-device JavaScript gate", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/books.md",
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

    const inert = service.getLiteratureNoteTemplate("books.md")?.frontmatter;
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

    const active = service.getLiteratureNoteTemplate("books.md")?.frontmatter;
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
      "templates/books.md",
      literatureNoteDocument("Books", "PROFILE {{ zt.text }}"),
    );
    vault.addFile(
      "templates/plain.md",
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
        document: "books.md",
      },
      {
        id: "Rz9Wm4YfH6Kd" as ProfileId,
        label: "Plain",
        document: "plain.md",
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
          document: "missing.md",
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
          document: "missing.md",
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
      vault.addFile("templates/books.md", source);
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
              document: "books.md",
            },
          ],
        },
        "Bk3Qn7XvT2Lp" as ProfileId,
      )!;
      const data = { annotation: { text: "A" } };
      const original = service.getLiteratureNoteTemplate("books.md")!;
      expect(original.renderForUpdate(data)).toBe(
        "%%zt-managed%%\nPROFILE A\n%%/zt-managed%%",
      );
      expect(original.renderForCreate(data)).toContain("PROFILE A");
      expect(
        service.renderProfileAnnotation(data.annotation, { profile }),
      ).toBe("PROFILE A");
      const exported = await service.exportLiteratureNotePack("books.md");
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
        "templates/books.md",
        source.replace("PROFILE", "CHANGED"),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(
        service.renderProfileAnnotation(data.annotation, { profile }),
      ).toBe("CHANGED A");
      expect(
        service.getLiteratureNoteTemplate("books.md")!.renderForUpdate(data),
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
    vault.addFile("templates/books.md", literatureNoteDocument("Books"));
    vault.addFile(
      "templates/duplicate.md",
      literatureNoteDocument("{% managed %}One{% endmanaged %}"),
    );
    const { service } = await makeHarness({ vault });

    expect(service.getLiteratureNoteTemplateStatuses()).toMatchObject([
      {
        reference: "books.md",
        path: "templates/books.md",
        validation: { state: "valid", hasManagedBlock: true },
      },
      {
        reference: "duplicate.md",
        path: "templates/duplicate.md",
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
      "templates/books.md",
      literatureNoteDocument("Draft").replace(
        "Managed {{ zt.title }}",
        '{% render "summary" with zt as zt %}',
      ),
    );
    vault.addFile(
      "templates/zotlit-summary.liquid.md",
      "Summary {{ zt.title }}",
    );
    const { service } = await makeHarness({ vault });

    const exported = new TemplateFacade().parseLiteratureNoteTemplate(
      await service.exportLiteratureNotePack("books.md"),
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
    vault.addFile("templates/shared.md", source);
    vault.addFile("templates/zotlit-summary.liquid.md", "Local {{ zt.title }}");
    vault.addFile(
      "templates/local.md",
      literatureNoteDocument("Local").replace(
        "Managed {{ zt.title }}",
        partial,
      ),
    );
    const { service } = await makeHarness({ vault });
    const paths = [...vault.files.keys()];
    const document = service.getLiteratureNoteTemplate("shared.md")!;

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
        .getLiteratureNoteTemplate("local.md")!
        .renderForCreate({ title: "Paper" }),
    ).toContain("Local Paper");
    expect([...vault.files.keys()]).toEqual(paths);
    expect(
      await vault.cachedRead(
        vault.getFileByPath("templates/zotlit-summary.liquid.md")!,
      ),
    ).toBe("Local {{ zt.title }}");
  });

  it("keeps an installed bundled Eta partial behind the JavaScript consent gate", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/shared.md",
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

    expect(() => service.getLiteratureNoteTemplate("shared.md")).toThrow(
      m.settings_template_inert_eta({ path: "templates/shared.md" }),
    );
    await service.setJavascriptTemplatesEnabled(true);
    expect(
      service
        .getLiteratureNoteTemplate("shared.md")!
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
    const plugin = new PluginStub(app, { __VERSION__: 1 });
    const settings = {
      current: null,
      loaded: loaded.promise,
      subscribe: vi.fn(() => () => {}),
    } as unknown as SettingsService;
    await using service = new TemplateService({
      plugin: plugin as unknown as Plugin,
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
    const plugin = new PluginStub(app, { __VERSION__: 1 });
    const settings = {
      current: null,
      loaded: loaded.promise,
      subscribe: vi.fn(() => () => {}),
    } as unknown as SettingsService;
    const service = new TemplateService({
      plugin: plugin as unknown as Plugin,
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
    "preserves a cite compile failure through a %s citation getter",
    async (language, source) => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-cite.liquid.md", "{% if zt.title %}");
      vault.addFile(`templates/zotlit-note.${language}.md`, source);
      const { service } = await makeHarness({
        vault,
        javascriptTemplates: true,
      });
      const data = {
        get citation(): string {
          return service.render("cite", {});
        },
      };

      let failure: unknown;
      try {
        service.render("note", data);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TemplateError);
      expect((failure as TemplateError).templateName).toBe("cite");
      expect(service.compileErrors.get("cite")).toBeDefined();
    },
  );

  it("preserves an inert winner through a real Eta include error", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile("templates/zotlit-cite.eta.md", "<%= zt.title %>");
    const { service } = await makeHarness({ vault });
    const eta = new TemplateFacade();
    eta.define("parent", '<%~ include("cite", zt) %>', "eta");
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
    expect((failure as InertTemplateError).templateName).toBe("cite");
  });

  it("leaves an application error untouched when its message names an inert template file", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile("templates/zotlit-cite.eta.md", "<%= zt.title %>");
    const { service } = await makeHarness({ vault });
    const thrown = new Error(
      "ENOENT: no such file or directory, open 'templates/zotlit-cite.eta.md'",
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
    vault.addFile("templates/zotlit-cite.eta.md", "<%= zt.title %>");
    const { service } = await makeHarness({ vault });
    const eta = new TemplateFacade();
    eta.define("parent", '<%~ include("cite", zt) %>', "eta");
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
      m.settings_template_inert_eta({ path: "templates/zotlit-cite.eta.md" }),
    );
  });

  it("classifies a liquid render of an inert name as inert", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/zotlit-note.liquid.md",
      '{% render "cite" with zt as zt %}',
    );
    vault.addFile("templates/zotlit-cite.eta.md", "<%= zt.title %>");
    const { service } = await makeHarness({ vault });

    let failure: unknown;
    try {
      service.render("note", { title: "Paper" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InertTemplateError);
    expect((failure as InertTemplateError).templateName).toBe("cite");
  });

  it("finds the inert template through an aggregated error chain", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{{ zt.citation }}");
    vault.addFile("templates/zotlit-cite.eta.md", "<%= zt.title %>");
    const { service } = await makeHarness({ vault });
    const data = {
      get citation(): string {
        throw new AggregateError(
          [new TemplateError('Template "cite" not found', "cite")],
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
    expect((failure as InertTemplateError).templateName).toBe("cite");
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

  it("drops non-canonical templates from the previous folder when it changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-custom.eta.md", "custom <%= zt.title %>");
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
      "cite",
      "cite2",
    ]);

    settings.update({ "note.template-conversion-pending": false });

    expect(service.getTemplateFileStatuses().map(({ name }) => name)).toEqual([
      "cite",
      "cite2",
    ]);
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

  it("toggles the auto-pair extension array from settings", async () => {
    const { app, plugin, settings } = await makeHarness();
    const extensions = plugin.editorExtensions[0] as unknown[];

    expect(extensions).toHaveLength(0);

    settings.update({ "template.auto-pair-eta": true });

    expect(extensions).toHaveLength(1);
    expect(app.workspace.updateOptions).toHaveBeenCalledTimes(1);
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

async function makeHarness(options?: {
  settings?: Record<string, unknown>;
  vault?: MockVault;
  javascriptTemplates?: boolean;
}): Promise<Harness> {
  const vault = options?.vault ?? new MockVault();
  const localStorage = new Map<string, unknown>();
  if (options?.javascriptTemplates) {
    localStorage.set("zotlit-javascript-templates", "1");
  }
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
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
    plugin: plugin as unknown as Plugin,
    app,
    settings,
  });
  await service.ready;

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
