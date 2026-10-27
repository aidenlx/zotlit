import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import { createObsidianHost } from "./__fixtures__/obsidian-host";
import { layerHost } from "./__fixtures__/obsidian-host-app";
import { processLiveText } from "./effect-live-text";

const PATH = "Notes/Paper.md";

/** The Vault and Workspace tags over `host`'s vault and views. */
function tagsOver(host: ReturnType<typeof createObsidianHost>) {
  return layerHost({
    vault: host.vault,
    workspace: host.workspace,
  });
}

describe("processLiveText", () => {
  it.effect("rewrites a note no view has open on disk", () => {
    const host = createObsidianHost({ [PATH]: "Old" });
    return Effect.gen(function* () {
      yield* processLiveText(host.file(PATH), (text) => `${text} new`);
      expect(host.text(PATH)).toBe("Old new");
    }).pipe(Effect.provide(tagsOver(host)));
  });

  it.effect("rewrites an open note's unsaved text and saves it", () => {
    const host = createObsidianHost({ [PATH]: "Saved" });
    const view = host.openInEditor(host.file(PATH));
    view.edit("Typed");
    return Effect.gen(function* () {
      yield* processLiveText(host.file(PATH), (text) => `${text} new`);
      expect(host.text(PATH)).toBe("Typed new");
      expect(view.getViewData()).toBe("Typed new");
    }).pipe(Effect.provide(tagsOver(host)));
  });

  it.effect(
    "writes through the vault when the view keeps other text, and the view reloads it",
    () => {
      const host = createObsidianHost({ [PATH]: "Old\n" });
      const view = host.openInEditor(host.file(PATH), { lineEndings: "lf" });
      const save = vi.spyOn(view, "save");
      return Effect.gen(function* () {
        yield* processLiveText(host.file(PATH), () => "New\r\n");
        expect(host.text(PATH)).toBe("New\r\n");
        expect(save).not.toHaveBeenCalled();
        expect(view.lastSavedData).toBe("New\r\n");
      }).pipe(Effect.provide(tagsOver(host)));
    },
  );

  it.effect.each([
    ["no view has the note open", false],
    ["a view has the note open", true],
  ] as const)(
    "fails with LiveTextRewriteFailed and leaves the note when the rewrite throws, and %s",
    ([, open]) => {
      const host = createObsidianHost({ [PATH]: "Saved" });
      if (open) host.openInEditor(host.file(PATH));
      const thrown = new Error("Template threw");
      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          processLiveText(host.file(PATH), () => {
            throw thrown;
          }),
        );
        expect(error).toMatchObject({
          _tag: "LiveTextRewriteFailed",
          path: PATH,
          cause: thrown,
        });
        expect(host.text(PATH)).toBe("Saved");
      }).pipe(Effect.provide(tagsOver(host)));
    },
  );

  it.effect("fails with VaultError when the view's save rejects", () => {
    const host = createObsidianHost({ [PATH]: "Saved" });
    const view = host.openInEditor(host.file(PATH));
    const refused = new Error("EACCES");
    vi.spyOn(view, "save").mockRejectedValueOnce(refused);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        processLiveText(host.file(PATH), (text) => `${text} new`),
      );
      expect(error).toMatchObject({
        _tag: "VaultError",
        operation: "save",
        path: PATH,
        cause: refused,
      });
    }).pipe(Effect.provide(tagsOver(host)));
  });
});
