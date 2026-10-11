import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempDisposableSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTranslationManifest,
  scanTranslationReadiness,
} from "./translation-scan";
import { getPageLocaleState } from "./translation-state";

function createFixture() {
  const scratch = resolve(import.meta.dirname, "../../.scratch");
  mkdirSync(scratch, { recursive: true });
  using stack = new DisposableStack();
  const directory = stack.use(
    mkdtempDisposableSync(join(scratch, "translation-scan-")),
  );
  const root = directory.path;
  for (const section of ["docs", "blog", "changelog"]) {
    mkdirSync(join(root, "content", section), { recursive: true });
  }

  function write(path: string, content: string) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  function page(path: string, body = "Reviewed prose.", placeholder = false) {
    write(
      `content/${path}`,
      `---\ntitle: Example\n${placeholder ? "translationStatus: placeholder\n" : ""}---\n\n${body}\n`,
    );
  }

  function checkTranslations() {
    const script = join(root, "scripts/check-translations.ts");
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    cpSync(
      resolve(import.meta.dirname, "../../scripts/check-translations.ts"),
      script,
    );
    cpSync(
      resolve(import.meta.dirname, "translation-scan.ts"),
      join(root, "src/lib/translation-scan.ts"),
    );
    return spawnSync(process.execPath, [script], {
      encoding: "utf8",
      // The script's own package root determines its content, even from another cwd.
      cwd: import.meta.dirname,
    });
  }

  const resources = stack.move();
  return {
    root,
    write,
    page,
    checkTranslations,
    [Symbol.dispose]() {
      resources[Symbol.dispose]();
    },
  };
}

// Failure modes: fallback is mistaken for a translation; locale suffixes leak
// into slugs; partials become pages; a parent outpaces its includes; a mixed
// listing claims Chinese; sidebar and UI markers disappear from diagnostics.
describe("buildTranslationManifest", () => {
  it("distinguishes missing, placeholder and author-approved native pages", () => {
    using fixture = createFixture();
    const { root, page } = fixture;
    page("docs/missing.mdx");
    page("docs/pending.mdx");
    page("docs/pending.zh-CN.mdx", "English copy.", true);
    page("docs/ready.mdx");
    page("docs/ready.zh-CN.mdx");
    const manifest = buildTranslationManifest(root);
    expect(manifest.pages["/docs/missing"]).toBeUndefined();
    expect(manifest.pages["/docs/pending"]).toBe("placeholder");
    expect(manifest.pages["/docs/ready"]).toBe("translated");
    expect(manifest.ui).toBe("placeholder");
  });

  it("uses Fumadocs folder-group and index rules after removing the locale suffix", () => {
    using fixture = createFixture();
    const { root, page } = fixture;
    page("docs/(intro)/index.zh-CN.mdx");
    page("docs/(intro)/install.zh-CN.mdx");
    page("docs/reference/index.zh-CN.mdx");
    page("changelog/2.1.0.zh-CN.md");
    const { pages } = buildTranslationManifest(root);
    expect(pages).toMatchObject({
      "/docs": "translated",
      "/docs/install": "translated",
      "/docs/reference": "translated",
      "/changelog/2.1.0": "translated",
    });
    expect(Object.keys(pages).some((path) => path.includes("zh-CN"))).toBe(
      false,
    );
  });

  it("approves a page only after its marker is removed, without guessing its language", () => {
    using fixture = createFixture();
    const { root, page, write } = fixture;
    page("docs/example.zh-CN.mdx", "English copy.", true);
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "placeholder",
    );
    page("docs/example.zh-CN.mdx", "English copy.");
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "translated",
    );
    write(
      "content/docs/example.zh-CN.mdx",
      "---\ntranslationStatus: translated\n---\nProse.",
    );
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "placeholder",
    );
  });

  it("waits for every recursively included Chinese partial", () => {
    using fixture = createFixture();
    const { root, page } = fixture;
    page("docs/example.zh-CN.mdx", "<include>./_outer.zh-CN.mdx</include>");
    page(
      "docs/_outer.zh-CN.mdx",
      "<include>./_inner.zh-CN.mdx#details</include>",
    );
    page("docs/_inner.zh-CN.mdx", "Pending prose.", true);
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "placeholder",
    );
    page("docs/_inner.zh-CN.mdx");
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "translated",
    );
    expect(Object.keys(buildTranslationManifest(root).pages)).not.toContain(
      "/docs/_outer",
    );
  });

  it("keeps missing includes, English includes and include cycles unapproved", () => {
    using fixture = createFixture();
    const { root, page } = fixture;
    page("docs/missing.zh-CN.mdx", "<include>./_absent.zh-CN.mdx</include>");
    page("docs/english.zh-CN.mdx", "<include>./_english.mdx</include>");
    page("docs/_english.mdx");
    page("docs/_english.zh-CN.mdx");
    page("docs/cycle.zh-CN.mdx", "<include>./_a.zh-CN.mdx</include>");
    page("docs/_a.zh-CN.mdx", "<include>./_b.zh-CN.mdx</include>");
    page("docs/_b.zh-CN.mdx", "<include>./_a.zh-CN.mdx</include>");
    expect(buildTranslationManifest(root).pages).toMatchObject({
      "/docs/missing": "placeholder",
      "/docs/english": "placeholder",
      "/docs/cycle": "placeholder",
    });
  });

  it("ignores include examples in code and comments", () => {
    using fixture = createFixture();
    const { root, page } = fixture;
    page(
      "docs/example.zh-CN.mdx",
      [
        "```mdx\n<include>./_absent.zh-CN.mdx</include>\n```",
        "`<include>./_inline.zh-CN.mdx</include>`",
        "{/* <include>./_comment.zh-CN.mdx</include> */}",
      ].join("\n\n"),
    );
    expect(buildTranslationManifest(root).pages["/docs/example"]).toBe(
      "translated",
    );
  });

  it("keeps sidebar and partial markers in diagnostics without publishing pages", () => {
    using fixture = createFixture();
    const { root, page, write } = fixture;
    write(
      "content/docs/meta.zh-CN.json",
      '{"title":"Docs","translationStatus":"placeholder"}',
    );
    write("content/docs/meta.json", '{"title":"Docs"}');
    page("docs/_partial.zh-CN.mdx", "English copy.", true);
    page("docs/absent.mdx");
    const scan = scanTranslationReadiness(root);
    expect(scan.files).toEqual(
      expect.arrayContaining([
        {
          path: "content/docs/meta.zh-CN.json",
          kind: "meta",
          status: "placeholder",
        },
        {
          path: "content/docs/_partial.zh-CN.mdx",
          kind: "partial",
          status: "placeholder",
        },
      ]),
    );
    expect(scan.manifest.pages["/docs/meta"]).toBeUndefined();
    expect(scan.manifest.pages["/docs/_partial"]).toBeUndefined();
    expect(scan.missing).toEqual([
      "content/docs/absent.zh-CN.mdx",
      "i18n/zh-CN.json",
    ]);
  });

  it("requires UI approval for home, community, Workbench and generated listings", () => {
    using fixture = createFixture();
    const { root, page, write } = fixture;
    page("blog/post.mdx");
    page("blog/post.zh-CN.mdx");
    page("changelog/2.1.0.mdx");
    page("changelog/2.1.0.zh-CN.mdx");
    write("i18n/zh-CN.json", '{"ui":"placeholder"}');
    expect(buildTranslationManifest(root).pages).toMatchObject({
      "/": "placeholder",
      "/community": "placeholder",
      "/workbench": "placeholder",
      "/blog": "placeholder",
      "/changelog": "placeholder",
    });
    write("i18n/zh-CN.json", "{}");
    expect(buildTranslationManifest(root)).toMatchObject({
      ui: "translated",
      pages: {
        "/": "translated",
        "/community": "translated",
        "/workbench": "translated",
        "/blog": "translated",
        "/changelog": "translated",
      },
    });
    expect(buildTranslationManifest(root).pages["/docs"]).toBeUndefined();
  });

  it("requires all English listing entries to have approved Chinese counterparts", () => {
    using fixture = createFixture();
    const { root, page, write } = fixture;
    write("i18n/zh-CN.json", "{}");
    page("blog/ready.mdx");
    page("blog/ready.zh-CN.mdx");
    page("blog/pending.mdx");
    page("blog/pending.zh-CN.mdx", "English copy.", true);
    page("changelog/2.0.0.mdx");
    page("changelog/2.0.0.zh-CN.mdx");
    page("changelog/2.1.0.mdx");
    const manifest = buildTranslationManifest(root);
    expect(manifest.pages).toMatchObject({
      "/blog": "placeholder",
      "/changelog": "placeholder",
    });
    expect(
      getPageLocaleState("/blog/ready", "zh-CN", manifest).contentLocale,
    ).toBe("zh-CN");
    expect(
      getPageLocaleState("/blog", "en", manifest).alternates,
    ).not.toContainEqual({ locale: "zh-CN", path: "/zh-CN/blog" });
    expect(
      getPageLocaleState("/changelog/2.1.0", "zh-CN", manifest).canonicalPath,
    ).toBe("/changelog/2.1.0");
  });
});

describe("check:translations", () => {
  it("fails with file paths for every approval kind and missing counterpart", () => {
    using fixture = createFixture();
    const { page, write, checkTranslations } = fixture;
    page("docs/pending.mdx");
    page("docs/pending.zh-CN.mdx", "English copy.", true);
    page("docs/_partial.mdx");
    page("docs/_partial.zh-CN.mdx", "English copy.", true);
    page("docs/missing.mdx");
    write("content/docs/meta.json", "{}");
    write(
      "content/docs/meta.zh-CN.json",
      '{"translationStatus":"placeholder"}',
    );
    write("i18n/zh-CN.json", '{"ui":"placeholder"}');
    const result = checkTranslations();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("4 placeholder files, 1 missing files.");
    expect(result.stderr).toContain(
      "placeholder (page): content/docs/pending.zh-CN.mdx",
    );
    expect(result.stderr).toContain(
      "placeholder (partial): content/docs/_partial.zh-CN.mdx",
    );
    expect(result.stderr).toContain(
      "placeholder (meta): content/docs/meta.zh-CN.json",
    );
    expect(result.stderr).toContain("placeholder (ui): i18n/zh-CN.json");
    expect(result.stderr).toContain("missing: content/docs/missing.zh-CN.mdx");
  });

  it("passes only when every counterpart exists and all approval markers are removed", () => {
    using fixture = createFixture();
    const { page, write, checkTranslations } = fixture;
    page("docs/index.mdx", "<include>./_partial.mdx</include>");
    page("docs/index.zh-CN.mdx", "<include>./_partial.zh-CN.mdx</include>");
    page("docs/_partial.mdx");
    page("docs/_partial.zh-CN.mdx");
    write("content/docs/meta.json", "{}");
    write("content/docs/meta.zh-CN.json", "{}");
    write("i18n/zh-CN.json", "{}");
    const result = checkTranslations();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Translation readiness passed: 4 approved files",
    );
  });
});
