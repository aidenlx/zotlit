import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noMessageMatch } from "../../scripts/oxlint-plugin-errors";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const errors = [{ messageId: "messageMatch" }];

tester.run("no-message-match", noMessageMatch, {
  valid: [
    "if (typeof error.message === 'string') show(error.message)",
    "const text = error.message",
    "logger.warn(error.message)",
    "if (message.endsWith(' list')) done()",
    "if (error.code === 'ENOENT') skip()",
    "effect.pipe(Effect.catchTag('FileExists', () => Effect.succeed(false)))",
    "expect(error.message).toBe('File already exists.')",
    "pattern.test(error.name)",
  ],
  invalid: [
    { code: "if (error.message === 'File already exists.') skip()", errors },
    { code: "if ('x' !== error.message) skip()", errors },
    { code: "if (error?.message === 'x') skip()", errors },
    { code: "if (error.message.includes('does not exist')) skip()", errors },
    { code: "if (error.message.startsWith('File name')) skip()", errors },
    { code: "if (error.message.endsWith('!')) skip()", errors },
    { code: "if (error.message.match(/exists/)) skip()", errors },
    { code: "if (error.message?.includes('x')) skip()", errors },
    { code: "if (/already exists/.test(error.message)) skip()", errors },
  ],
});
