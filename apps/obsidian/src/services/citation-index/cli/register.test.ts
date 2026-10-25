import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";

import { registerCitationsCli } from "./register";

it.effect("publishes all citation commands and their parameter help", () =>
  Effect.gen(function* () {
    const { host, command, commands } = fakeCliHost();
    registerCitationsCli(host, {} as never);
    expect([...commands.keys()]).toEqual([
      "zotlit:annotation-uses",
      "zotlit:cited-by",
      "zotlit:references",
      "zotlit:citations-guide",
    ]);
    expect(command("zotlit:references").flags).toMatchObject({
      file: { required: true, value: "<vault-path>" },
    });
    expect(command("zotlit:annotation-uses").flags).toMatchObject({
      key: { required: true, value: "<annotation-key>" },
    });
    expect(command("zotlit:cited-by").flags).toHaveProperty("citekey");
    expect(yield* command("zotlit:citations-guide").handler({})).toContain(
      "ZOTLIT-CITATIONS(1)",
    );
  }),
);
