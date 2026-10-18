import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noObsidianClass,
  noSettingInReact,
} from "../../scripts/oxlint-plugin-obsidian-css";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { lang: "tsx", ecmaFeatures: { jsx: true } },
  },
});

tester.run("no-obsidian-class", noObsidianClass, {
  valid: [
    '<button className="zt:flex zt:rounded-(--clickable-icon-radius)" />',
    'cn("zt:p-2", open && "zt:bg-muted")',
    'const kind = "slider"',
    '<Control kind="dropdown" />',
    "import { Toggle } from './setting-items'",
    'getLogger(["obsidian-private", "metadata-type-manager"])',
    'const view = "bases-table"',
    'tv({ base: "zt:flex", variants: { cta: { true: "zt:text-accent" } } })',
  ],
  invalid: [
    {
      code: '<button className="clickable-icon zt:shrink-0" />',
      errors: [
        { messageId: "obsidianClass", data: { name: "clickable-icon" } },
      ],
    },
    {
      code: "<div className={`setting-item ${extra}`} />",
      errors: [{ messageId: "obsidianClass", data: { name: "setting-item" } }],
    },
    {
      code: 'cn("zt:p-2", primary && "mod-cta")',
      errors: [{ messageId: "obsidianClass", data: { name: "mod-cta" } }],
    },
    {
      code: '<p className={cn("setting-item-description")} />',
      errors: [
        {
          messageId: "obsidianClass",
          data: { name: "setting-item-description" },
        },
      ],
    },
    {
      code: 'const chipIcon = "clickable-icon zt:p-1"',
      errors: [
        { messageId: "obsidianClass", data: { name: "clickable-icon" } },
      ],
    },
    {
      code: '<div className="bases-td zt:flex" />',
      errors: [{ messageId: "obsidianClass", data: { name: "bases-td" } }],
    },
    {
      code: 'cn("zt:p-2", "metadata-input-longtext")',
      errors: [
        {
          messageId: "obsidianClass",
          data: { name: "metadata-input-longtext" },
        },
      ],
    },
    {
      code: 'tv({ slots: { chip: "multi-select-pill" } })',
      errors: [
        { messageId: "obsidianClass", data: { name: "multi-select-pill" } },
      ],
    },
    {
      code: '<select className="dropdown" />',
      errors: [{ messageId: "obsidianClass", data: { name: "dropdown" } }],
    },
    {
      code: 'tv({ slots: { remove: "clickable-icon" } })',
      errors: [
        { messageId: "obsidianClass", data: { name: "clickable-icon" } },
      ],
    },
  ],
});

tester.run("no-setting-in-react", noSettingInReact, {
  valid: ["new SettingsService()", "settings.Setting"],
  invalid: [
    {
      code: "new Setting(el).setName(title)",
      errors: [{ messageId: "setting" }],
    },
  ],
});
