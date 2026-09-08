// @vitest-environment happy-dom
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { advancedPageItems } from "./advanced";
import type { SettingTabContext } from "./context";

function items(webWorkbenchEnabled: boolean) {
  return advancedPageItems({
    webWorkbenchEnabled,
    settings: { current: { "log.to-file": false } },
    localServer: { effectivePort: null },
    localBridge: { connection: null },
  } as unknown as SettingTabContext);
}

it("includes the editor-choice preference only in web-enabled builds", () => {
  const preferenceName = m.profile_editor_preference_name();

  expect(items(true)).toContainEqual(
    expect.objectContaining({ name: preferenceName }),
  );
  expect(items(false)).not.toContainEqual(
    expect.objectContaining({ name: preferenceName }),
  );
});
