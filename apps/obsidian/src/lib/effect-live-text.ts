// `processLiveText` (`./live-text.ts`) for Effect code: the loaded view comes
// from the Workspace tag and the disk write goes through the Vault tag.
import { Effect, Schema } from "effect";
import type { TFile } from "obsidian";

import { setViewDataKeepingScroll } from "@/lib/live-text";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { vaultError } from "@/lib/vault-errors";

/** The rewrite function of {@link processLiveText} threw; `cause` holds what it threw. */
export class LiveTextRewriteFailed extends Schema.TaggedError<
  LiveTextRewriteFailed,
  { readonly brand: unique symbol }
>()("LiveTextRewriteFailed", {
  /** The vault path of the note that was left as it was. */
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * Rewrite `file`'s live text with `fn`, as `processLiveText` does: a loaded
 * view that edits the note takes the new text and saves it; else one
 * `Vault.process` writes it. An output equal to its input writes nothing. A
 * view that holds other text than it was given is set back, and the write
 * goes through the vault, so `fn` runs at most twice.
 *
 * Fails with {@link LiveTextRewriteFailed} when `fn` throws, and leaves the
 * note as it was; fails with `VaultError` when the view's save or the vault
 * write rejects.
 */
export const processLiveText = Effect.fn("processLiveText")(function* (
  file: TFile,
  fn: (text: string) => string,
) {
  const failed = (cause: unknown) =>
    new LiveTextRewriteFailed({ path: file.path, cause });
  const view = yield* (yield* Workspace).loadedTextView(file);
  if (view !== null) {
    const text = view.getViewData();
    const next = yield* Effect.try({ try: () => fn(text), catch: failed });
    if (next === text) return;
    setViewDataKeepingScroll(view, next);
    if (view.getViewData() === next) {
      yield* Effect.tryPromise({
        try: () => view.save(),
        catch: vaultError("save", file.path),
      });
      return;
    }
    setViewDataKeepingScroll(view, text);
  }
  yield* (yield* Vault)
    .process(file, (text) => {
      try {
        return fn(text);
      } catch (cause) {
        throw failed(cause);
      }
    })
    .pipe(
      Effect.catchTag("VaultError", (error) =>
        Effect.fail(
          error.cause instanceof LiveTextRewriteFailed ? error.cause : error,
        ),
      ),
    );
});
