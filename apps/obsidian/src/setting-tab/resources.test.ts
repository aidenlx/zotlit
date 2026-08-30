// @vitest-environment happy-dom
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingTabContext } from "./context";
import { templateConversionReminderItem } from "./resources";

it("uses the conversion prompt in the settings reminder with the configured target path", () => {
  const reminder = templateConversionReminderItem({
    settings: { current: { "template.folder": "Research templates" } },
  } as unknown as SettingTabContext);
  expect(reminder.name).toBe(m.welcome_template_conversion_title());
  expect(reminder.desc).toBe(
    m.welcome_template_conversion_body({
      path: "Research templates/zotlit-profile.default.md",
    }),
  );
});
