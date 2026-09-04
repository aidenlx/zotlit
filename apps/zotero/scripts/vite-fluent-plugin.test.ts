// Runs the Fluent plugin against fixture inlang projects and asserts the emitted text.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";

import { fluentPlugin } from "./vite-fluent-plugin.js";

type Catalogs = Record<string, Record<string, unknown>>;

/** A fixture workspace: an inlang project, an addon dir, and an empty staging dir. */
async function createFixture(
  catalogs: Catalogs,
  { xhtml = "" }: { xhtml?: string } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zotlit-fluent-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "project.inlang"), { recursive: true });
  await writeFile(
    join(root, "project.inlang", "settings.json"),
    JSON.stringify({
      $schema: "https://inlang.com/schema/project-settings",
      baseLocale: "en",
      locales: Object.keys(catalogs),
      "plugin.inlang.messageFormat": {
        pathPattern: "./messages/{locale}.json",
      },
    }),
  );
  await mkdir(join(root, "messages"));
  for (const [locale, messages] of Object.entries(catalogs)) {
    await writeFile(
      join(root, "messages", `${locale}.json`),
      JSON.stringify(messages, null, 2),
    );
  }
  await mkdir(join(root, "addon"));
  await writeFile(join(root, "addon", "prefs.xhtml"), xhtml);
  return root;
}

async function runPlugin(root: string): Promise<{
  warnings: string[];
  ftl: (locale: string) => Promise<string>;
  types: () => Promise<string>;
}> {
  const plugin = fluentPlugin({
    root,
    env: {
      mode: "development",
      isProd: false,
      isDev: true,
      addonStaging: "staging",
      xpiOutDir: "out",
    },
    project: join(root, "project.inlang"),
    namespace: "zotero.",
    prefix: "zotlit",
    localeAliases: { en: "en-US" },
    ftlFileName: "zotlit.ftl",
    addonDir: "addon",
    typesOutput: "types/fluent.ts",
  });
  const warnings: string[] = [];
  const context = {
    addWatchFile: () => {},
    warn: (message: string) => warnings.push(message),
    error: (message: string) => {
      throw new Error(message);
    },
    meta: { watchMode: true },
  };
  const buildStart = plugin.buildStart as Plugin["buildStart"] & Function;
  const writeBundle = plugin.writeBundle as Plugin["writeBundle"] & Function;
  await buildStart.call(context);
  await writeBundle.call(context);
  return {
    warnings,
    ftl: (locale) =>
      readFile(join(root, "staging", "locale", locale, "zotlit.ftl"), "utf8"),
    types: () => readFile(join(root, "types", "fluent.ts"), "utf8"),
  };
}

const plural = (one: string, other: string) => [
  {
    declarations: ["input count", "local countPlural = count: plural"],
    selectors: ["countPlural"],
    match: { "countPlural=one": one, "countPlural=*": other },
  },
];

describe("fluentPlugin", () => {
  it("derives one Fluent file per locale from the zotero namespace", async () => {
    const root = await createFixture({
      en: {
        plugin_only: "Obsidian copy",
        zotero: {
          prefs_pane_label: "ZotLit",
          menu_item_open: { label: "Open Literature Note in Obsidian" },
          database_status: {
            value: "Database Status",
            tooltiptext: "Database Status — automatic writes off",
          },
          menu_item_update: { label: plural("Create Note", "Create Notes") },
          menu_item_copy_key: {
            label: [
              {
                declarations: [
                  "input count",
                  "input kind",
                  "local countPlural = count: plural",
                ],
                selectors: ["countPlural", "kind"],
                match: {
                  "countPlural=one, kind=attachment": "Copy Attachment Key",
                  "countPlural=one, kind=*": "Copy Item Key",
                  "countPlural=*, kind=attachment": "Copy Attachment Keys",
                  "countPlural=*, kind=*": "Copy Selected Keys",
                },
              },
            ],
          },
          formatted: [
            {
              declarations: [
                "input amount",
                "input when",
                "local price = amount: number style=currency currency=USD",
                "local day = when: datetime dateStyle=short",
              ],
              match: { "price=*": "{price} on {day}" },
            },
          ],
        },
      },
      "zh-CN": {
        plugin_only: "Obsidian 文案",
        zotero: {
          prefs_pane_label: "ZotLit",
          menu_item_open: { label: "在 Obsidian 中打开文献笔记" },
          // Only one of the two parts: the whole message falls back to en-US.
          database_status: { tooltiptext: "数据库状态 — 自动写入已关闭" },
        },
      },
    });

    const { warnings, ftl, types } = await runPlugin(root);

    expect(await ftl("en-US")).toBe(
      [
        "zotlit-database-status = Database Status",
        "    .tooltiptext = Database Status — automatic writes off",
        'zotlit-formatted = { NUMBER($amount, currency: "USD", style: "currency") } on { DATETIME($when, dateStyle: "short") }',
        "zotlit-menu-item-copy-key =",
        "    .label =",
        "        { $count ->",
        "            [one]",
        "                { $kind ->",
        "                    [attachment] Copy Attachment Key",
        "                   *[other] Copy Item Key",
        "                }",
        "           *[other]",
        "                { $kind ->",
        "                    [attachment] Copy Attachment Keys",
        "                   *[other] Copy Selected Keys",
        "                }",
        "        }",
        "zotlit-menu-item-open =",
        "    .label = Open Literature Note in Obsidian",
        "zotlit-menu-item-update =",
        "    .label =",
        "        { $count ->",
        "            [one] Create Note",
        "           *[other] Create Notes",
        "        }",
        "zotlit-prefs-pane-label = ZotLit",
        "",
      ].join("\n"),
    );
    expect(await ftl("zh-CN")).toBe(
      [
        "zotlit-menu-item-open =",
        "    .label = 在 Obsidian 中打开文献笔记",
        "zotlit-prefs-pane-label = ZotLit",
        "",
      ].join("\n"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /zh-CN\.json: 4 untranslated message\(s\) fall back to the base locale: zotero\.database_status\.value/,
    );
    expect(await types()).toBe(
      [
        "// GENERATED by scripts/inlang-fluent.ts — DO NOT EDIT.",
        "// Source of truth: the `zotero` namespace in messages/{locale}.json",
        "",
        "/** Fluent message ID to its inputs; `never` marks a message that takes none. */",
        "export type FluentMessages = {",
        '  "zotlit-database-status": never;',
        '  "zotlit-formatted": { amount: number; when: number };',
        '  "zotlit-menu-item-copy-key": { count: number; kind: string | number };',
        '  "zotlit-menu-item-open": never;',
        '  "zotlit-menu-item-update": { count: number };',
        '  "zotlit-prefs-pane-label": never;',
        "};",
        "",
        "export type FluentMessageId = keyof FluentMessages;",
        "",
      ].join("\n"),
    );
  });

  it("checks every data-l10n-id in the addon XHTML against the emitted IDs", async () => {
    const root = await createFixture(
      { en: { zotero: { prefs_pane_label: "ZotLit" } } },
      {
        xhtml:
          '<label data-l10n-id="zotlit-prefs-pane-label"/><label data-l10n-id="zotlit-missing"/>',
      },
    );

    await expect(runPlugin(root)).rejects.toThrow(
      /prefs\.xhtml: data-l10n-id="zotlit-missing" is not a message under "zotero\."/,
    );
  });

  it("fails on a variant table without a catch-all", async () => {
    const root = await createFixture({
      en: {
        zotero: {
          broken: [
            {
              declarations: ["input kind"],
              selectors: ["kind"],
              match: { "kind=a": "A", "kind=b": "B" },
            },
          ],
        },
      },
    });

    await expect(runPlugin(root)).rejects.toThrow(
      'Missing catch-all for selector "kind" in message "zotero.broken"',
    );
  });

  it("fails when a message exists only outside the base locale", async () => {
    const root = await createFixture({
      en: { zotero: { present: "Here" } },
      "zh-CN": { zotero: { present: "这里", extra: "多余" } },
    });

    await expect(runPlugin(root)).rejects.toThrow(
      /validation failed:\n.*1 message\(s\) absent from the base locale.*zotero\.extra/,
    );
  });

  it("fails when a locale uses an input the base locale does not declare", async () => {
    const root = await createFixture({
      en: { zotero: { present: "Here" } },
      "zh-CN": { zotero: { present: "这里 {extra}" } },
    });

    await expect(runPlugin(root)).rejects.toThrow(
      /validation failed:\n.*"zotero\.present" uses input\(s\) the base locale does not declare \(extra\)/,
    );
  });
});
