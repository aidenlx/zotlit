import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noLogTapeInEffectFile } from "../../scripts/oxlint-plugin-logging";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const filename = "/repo/apps/obsidian/src/services/example.ts";
const logtape = [{ messageId: "logtape" }];

tester.run("no-logtape-in-effect-file", noLogTapeInEffectFile, {
  valid: [
    {
      code: 'import { getLogger } from "@/lib/log";',
      filename,
    },
    {
      code: 'import { Effect } from "@/lib/effect";',
      filename,
    },
    {
      code: 'import type { EffectBridge } from "@/lib/effect-bridge";\nimport { getLogger } from "@/lib/log";',
      filename,
    },
  ],
  invalid: [
    {
      code: 'import { Effect } from "@/lib/effect";\nimport { getLogger } from "@/lib/log";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { Effect } from "effect";\nimport { getLogger } from "@logtape/logtape";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { withLogCategory } from "@/lib/effect-log";\nexport { getLogger } from "../lib/log";',
      filename,
      errors: logtape,
    },
    {
      code: 'import type { Effect } from "@/lib/effect";\nimport { getLogger } from "@/lib/log";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { effectBridge } from "@/lib/effect-bridge";\nimport { getLogger } from "@/lib/log";',
      filename,
      errors: logtape,
    },
  ],
});
