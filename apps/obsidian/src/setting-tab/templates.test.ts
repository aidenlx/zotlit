// @vitest-environment happy-dom
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingTabContext } from "./context";
import { templateEngineItems } from "./templates";

function engineRows(unrecognized: readonly string[]) {
  return templateEngineItems({
    template: {
      loaded: true,
      javascriptTemplatesEnabled: false,
      getUnrecognizedFiles: () => unrecognized,
    },
  } as unknown as SettingTabContext);
}

it("names each unrecognized ZotLit file in one row", () => {
  const path = "Templates/zotlit-foo.md";

  expect(engineRows([path])).toContainEqual(
    expect.objectContaining({
      name: m.settings_template_unrecognized_name(),
      desc: m.settings_template_unrecognized_desc({ path }),
    }),
  );
  expect(engineRows([])).not.toContainEqual(
    expect.objectContaining({ name: m.settings_template_unrecognized_name() }),
  );
});
