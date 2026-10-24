import { describe, expect } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Effect, Layer } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";

import {
  LIBRARY_SCOPE_COMMAND,
  LIBRARY_SCOPE_GUIDE_COMMAND,
  layerLibraryScopeCli,
  registerLibraryScopeCli,
} from "./cli";
import type { ResolvedLibraryScope } from "./scope";
import { LibraryScope } from "./service";

function setup(current: ResolvedLibraryScope | null) {
  const { host, commands, command } = fakeCliHost();
  registerLibraryScopeCli(host, {
    libraryScope: { current: Effect.succeed(current) },
  });
  return {
    commands,
    handler: command(LIBRARY_SCOPE_COMMAND).handler,
    guideHandler: command(LIBRARY_SCOPE_GUIDE_COMMAND).handler,
  };
}

describe("Library Scope CLI registration", () => {
  it("publishes both commands with description and no flags", () => {
    const { commands } = setup(null);

    expect(commands.get(LIBRARY_SCOPE_COMMAND)).toMatchObject({
      description:
        "Report the resolved Library Scope: mode, available Libraries, and unavailable selectors",
      flags: null,
    });
    expect(commands.get(LIBRARY_SCOPE_GUIDE_COMMAND)).toMatchObject({
      description: "Print the zotlit:library-scope CLI guide",
      flags: null,
    });
  });

  it.effect("reports an all-scope resolution", () =>
    Effect.gen(function* () {
      const { handler } = setup({
        mode: "all",
        invalid: false,
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
        ],
        unavailable: [],
      });

      expect(JSON.parse(yield* handler({}))).toEqual({
        contractVersion: 1,
        command: LIBRARY_SCOPE_COMMAND,
        ok: true,
        mode: "all",
        invalid: false,
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
        ],
        unavailable: [],
      });
    }),
  );

  it.effect(
    "reports a selected-scope resolution with available and unavailable selectors",
    () =>
      Effect.gen(function* () {
        const { handler } = setup({
          mode: "selected",
          invalid: false,
          available: [
            { selector: { type: "personal" }, libraryID: 1, name: null },
            {
              selector: { type: "group", groupID: 5 },
              libraryID: 7,
              name: "Lab Group",
            },
          ],
          unavailable: [{ type: "group", groupID: 9 }],
        });

        expect(JSON.parse(yield* handler({}))).toEqual({
          contractVersion: 1,
          command: LIBRARY_SCOPE_COMMAND,
          ok: true,
          mode: "selected",
          invalid: false,
          available: [
            { selector: { type: "personal" }, libraryID: 1, name: null },
            {
              selector: { type: "group", groupID: 5 },
              libraryID: 7,
              name: "Lab Group",
            },
          ],
          unavailable: [{ type: "group", groupID: 9 }],
        });
      }),
  );

  it.effect(
    "reports invalid: true when the saved value failed validation",
    () =>
      Effect.gen(function* () {
        const { handler } = setup({
          mode: "selected",
          invalid: true,
          available: [
            { selector: { type: "personal" }, libraryID: 1, name: null },
          ],
          unavailable: [],
        });

        const output = JSON.parse(yield* handler({}));
        expect(output.ok).toBe(true);
        expect(output.invalid).toBe(true);
      }),
  );

  it.effect("reports the database as unreadable when current is null", () =>
    Effect.gen(function* () {
      const { handler } = setup(null);

      expect(JSON.parse(yield* handler({}))).toEqual({
        contractVersion: 1,
        command: LIBRARY_SCOPE_COMMAND,
        ok: false,
        diagnostic: {
          code: "DATABASE_UNREADABLE",
          message: "The connected Zotero source is not currently readable.",
          hint: "Run the command again once the connected Zotero source is readable.",
        },
      });
    }),
  );

  it.effect("rejects an unknown parameter before reading the database", () =>
    Effect.gen(function* () {
      const { handler } = setup({
        mode: "all",
        invalid: false,
        available: [],
        unavailable: [],
      });

      const output = JSON.parse(yield* handler({ bogus: "1" }));
      expect(output).toMatchObject({
        contractVersion: 1,
        command: LIBRARY_SCOPE_COMMAND,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          details: { parameter: "bogus" },
        },
      });
    }),
  );

  it.effect(
    "prints the guide, and rejects an unknown parameter the same way",
    () =>
      Effect.gen(function* () {
        const { guideHandler } = setup(null);

        const guide = yield* guideHandler({});
        expect(guide).toContain("zotlit:library-scope");
        expect(guide).toContain("zotlit:library-scope-guide");

        const rejected = JSON.parse(yield* guideHandler({ bogus: "1" }));
        expect(rejected).toMatchObject({
          contractVersion: 1,
          command: LIBRARY_SCOPE_GUIDE_COMMAND,
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "bogus" },
          },
        });
      }),
  );
});

it.effect("registers its commands when the layer is built", () =>
  Effect.gen(function* () {
    const { host, commands } = fakeCliHost();
    yield* Layer.build(
      layerLibraryScopeCli.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PluginHost, host as PluginHostShape),
            Layer.succeed(
              LibraryScope,
              stubService<LibraryScope["Service"]>("LibraryScope", {
                current: Effect.succeed(null),
              }),
            ),
          ),
        ),
      ),
    );

    expect([...commands.keys()]).toEqual([
      LIBRARY_SCOPE_COMMAND,
      LIBRARY_SCOPE_GUIDE_COMMAND,
    ]);
  }),
);
