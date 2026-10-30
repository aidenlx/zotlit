import { expect, it } from "@effect/vitest";
// @vitest-environment happy-dom
import { Menu, TFile } from "@mock/obsidian";
import { Effect, Layer } from "effect";
import type { CachedMetadata, Command } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import { fileMenuHandler } from "@/services/__fixtures__/file-menu";

import { ShowInLibrary } from "./show-in-library";
import {
  layerShowInLibraryActions,
  showInLibraryFileMenu,
} from "./show-in-library-actions";

function note(extension = "md"): TFile {
  const file = new TFile();
  file.extension = extension;
  return file;
}

/** The command the layer adds, over `active` carrying `frontmatter`. */
const harness = Effect.fnUntraced(function* (
  active: TFile | null,
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345g42" },
) {
  const commands: Command[] = [];
  const shown: string[] = [];
  const cache: CachedMetadata = { frontmatter };
  yield* Layer.build(
    layerShowInLibraryActions.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            PluginHost,
            stubService<PluginHost["Service"]>("PluginHost", {
              addCommand: (command: Command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return command;
                }),
            }),
          ),
          Layer.mock(Workspace, {
            getActiveFile: Effect.sync(() => active as never),
          }),
          Layer.mock(MetadataCache, {
            fileCache: () => Effect.succeed(cache),
          }),
          Layer.mock(ShowInLibrary, {
            show: (indexedKey) =>
              Effect.sync(() => {
                shown.push(indexedKey);
              }),
          }),
        ),
      ),
    ),
  );
  return { command: commands[0]!, shown };
});

it.effect("shows the active Literature Note's Item in the Library View", () =>
  Effect.gen(function* () {
    const { command, shown } = yield* harness(note());
    expect(command).toMatchObject({
      id: "show-in-library",
      name: m.command_show_in_library_name(),
    });

    expect(command.checkCallback!(true)).toBe(true);
    expect(shown).toEqual([]);
    expect(command.checkCallback!(false)).toBe(true);
    yield* Effect.yieldNow;
    expect(shown).toEqual(["ABCD2345g42"]);
  }),
);

it.effect("stays off a note that carries no item key", () =>
  Effect.gen(function* () {
    const { command } = yield* harness(note(), {});
    expect(command.checkCallback!(true)).toBe(false);
  }),
);

it.effect("stays off a file that is not a note, or no file at all", () =>
  Effect.gen(function* () {
    expect((yield* harness(note("pdf"))).command.checkCallback!(true)).toBe(
      false,
    );
    expect((yield* harness(null)).command.checkCallback!(true)).toBe(false);
  }),
);

it("offers Show in Library on a Literature Note's file menu", () => {
  const shown: string[] = [];
  const menu = new Menu();
  fileMenuHandler([showInLibraryFileMenu((key) => shown.push(key))], {
    "zotero-key": "ABCD2345g42",
  })(menu as never, note() as never, "more-options");

  expect(menu.items).toHaveLength(1);
  const entry = menu.items[0]!;
  expect(entry.title).toBe(m.library_view_show_in_library());
  expect(entry.section).toBe("view");
  entry.click();
  expect(shown).toEqual(["ABCD2345g42"]);
});

it("leaves the file menu of a note with no item key alone", () => {
  const menu = new Menu();
  fileMenuHandler([showInLibraryFileMenu(() => undefined)], {})(
    menu as never,
    note() as never,
    "more-options",
  );
  expect(menu.items).toHaveLength(0);
});
