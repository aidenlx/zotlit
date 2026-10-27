// A Query View in a note, a Query File embed or a Query Block, as a case
// reaches it: drawn, settled, and drawn again on each use.

import { obEval, obRun, readUntil } from "./obsidian-cli.ts";
import type { JsonCompatible, ObsidianContext } from "./page-context.ts";
import { createPageHelpers } from "./page-helpers.ts";
import type { NoteQueryView } from "./page-helpers.ts";

/** A note just opened can take longer than one use's wait to load its query. */
const FIRST_DRAW_ATTEMPTS = 6;

/** Opens the message of a failure that no retry can change. */
const CANNOT_REVEAL = "Cannot reveal";
/** Opens the message of a view that stayed undrawn for a whole use. */
const NOT_DRAWN = "Not drawn";

export type { NoteQueryView } from "./page-helpers.ts";

/**
 * Which Query View of a note: the `occurrence`-th embed of `embed`, its link
 * text as written (e.g. `Lab annotations.zotquery#This item`), or the
 * `block`-th ` ```zotquery ` block of its own text. Both count from 0.
 */
export type QueryViewTarget =
  | { embed: string; occurrence?: number }
  | { block: number };

/** What the page needs to find one kind of view, as JSON. */
interface Kind {
  name: string;
  /** Source of a RegExp matching the line the view opens on. */
  opens: string;
  /** Source of a RegExp matching its last line; `null` for one line. */
  closes: string | null;
  index: number;
  /** The element the view's line draws. */
  selector: string;
  /** The `src` that element must hold; `null` for any. */
  src: string | null;
}

const FENCE = "(```|~~~)";

/**
 * An embed's element is its `.internal-embed`, which holds the view of a Query
 * File, or of a Query Block in a section it shows.
 */
function kindOf(target: QueryViewTarget): Kind {
  if ("block" in target)
    return {
      name: `Query Block #${target.block}`,
      opens: `^${FENCE}zotquery\\b`,
      closes: `^${FENCE}\\s*$`,
      index: target.block,
      selector: ".block-language-zotquery",
      src: null,
    };
  const occurrence = target.occurrence ?? 0;
  const link = RegExp.escape(`![[${target.embed}`);
  return {
    name: `embed of ${target.embed} #${occurrence}`,
    opens: `${link}(\\]\\]|\\|)`,
    closes: null,
    index: occurrence,
    selector: ".internal-embed",
    src: target.embed,
  };
}

/** Whether `error`, from an eval that used a {@link NoteQueryView}, is a reveal that failed for good or for a whole use. */
function isRevealFailure(error: unknown): boolean {
  const message = String(error);
  return message.includes(CANNOT_REVEAL) || message.includes(NOT_DRAWN);
}

/**
 * Waits until `notePath`, open in a Markdown leaf, draws `target` with its
 * query settled, and answers a handle to it. With the note open in several
 * leaves, the most recent one counts. Call it for one view of a leaf at a
 * time: each scrolls the note.
 *
 * @throws At once when the note is not open or holds no such view; when it
 *   does not draw the view within about a minute.
 */
export async function revealQueryView(
  vaultId: string,
  notePath: string,
  target: QueryViewTarget,
): Promise<NoteQueryView> {
  const targetData = { path: notePath, kind: kindOf(target) };
  const handle: NoteQueryView = {
    ...targetData,
    // Temporary compatibility for the remaining migration batches; remove in #1855.
    el: `(await (globalThis.__zotlitPageHelpers ??= (${createPageHelpers.toString()})(app)).revealQueryView(${JSON.stringify(targetData)}))`,
  };
  let failure: unknown;
  for (let attempt = 0; attempt < FIRST_DRAW_ATTEMPTS; attempt++) {
    try {
      await obRun(
        vaultId,
        async ({ page }, handle) => {
          await page.revealQueryView(handle);
        },
        handle,
      );
      return handle;
    } catch (error) {
      if (String(error).includes(CANNOT_REVEAL)) throw error;
      failure = error;
    }
  }
  throw failure;
}

/**
 * Polls the typed callback until `ready` accepts its result, for a callback
 * that reads a {@link NoteQueryView}. A view the use cannot
 * reveal fails at once with the page's message rather than as a later retry;
 * any other failed call counts as "not ready yet", and the last one is named
 * when `tries` run out.
 */
type QueryViewReadOptions<T> = {
  ready: (value: T) => boolean;
  what: string;
  tries?: number;
};
type QueryViewReader<A, T> = (
  context: ObsidianContext,
  args: A,
) => (T & JsonCompatible<T>) | Promise<T & JsonCompatible<T>>;

/** Temporary legacy overload for the remaining migration batches; remove in #1855. */
export function readQueryViewUntil<T>(
  vaultId: string,
  code: string,
  options: QueryViewReadOptions<T>,
): Promise<T>;
// oxlint-disable-next-line max-params -- Keep the typed callback API aligned with obRun (#1848).
export function readQueryViewUntil<A, T>(
  vaultId: string,
  callback: QueryViewReader<A, T>,
  args: A & JsonCompatible<A>,
  options: QueryViewReadOptions<T>,
): Promise<T>;
// oxlint-disable-next-line max-params -- The temporary overload shares the typed transport's four arguments (#1848).
export async function readQueryViewUntil<A, T>(
  vaultId: string,
  callback: QueryViewReader<A, T> | string,
  argsOrOptions: (A & JsonCompatible<A>) | QueryViewReadOptions<T>,
  typedOptions?: QueryViewReadOptions<T>,
): Promise<T> {
  const { ready, ...options } =
    typeof callback === "string"
      ? (argsOrOptions as QueryViewReadOptions<T>)
      : typedOptions!;
  let lastError = null as string | null;
  try {
    return await readUntil(
      async () => {
        try {
          // Temporary legacy transport for batches not yet migrated; remove in #1855.
          if (typeof callback === "string")
            return JSON.parse(await obEval(vaultId, callback)) as T | null;
          const args = argsOrOptions as A & JsonCompatible<A>;
          // oxlint-disable-next-line zotlit-tests/no-eval-capture -- Forward the caller-checked callback through the transport.
          return await obRun(vaultId, callback, args);
        } catch (error) {
          if (isRevealFailure(error)) throw error;
          lastError = String(error);
          return null;
        }
      },
      ready,
      options,
    );
  } catch (error) {
    if (lastError === null || isRevealFailure(error)) throw error;
    throw new Error(`${String(error)}; last failed call: ${lastError}`, {
      cause: error,
    });
  }
}
