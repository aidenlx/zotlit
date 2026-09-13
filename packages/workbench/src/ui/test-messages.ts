// The shared suite uses the existing pack interpreter over its catalog fixture.
import {
  createLanguagePackRuntime,
  validateLanguagePack,
} from "@zotlit/obsidian-i18n";

import type { WorkbenchMessages } from "./generated/messages";
import english from "./generated/test-en.json";

const pack = validateLanguagePack(JSON.stringify(english), {
  expectedLocale: "en",
});
const runtime = createLanguagePackRuntime(pack);
export const m = Object.fromEntries(
  Object.keys(pack.messages).map((id) => [
    id,
    (inputs?: Record<string, unknown>) => runtime.translate(id, inputs),
  ]),
) as unknown as WorkbenchMessages;
