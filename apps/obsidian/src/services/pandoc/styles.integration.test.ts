import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import { Effect } from "effect";
// The Resolved CSL Style as citeproc reads it: what an installed style actually renders.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import "@mock/dom-parser";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect } from "vitest";

import type { CslItemData } from "@zotlit/db";

import { createCitationEngine } from "./engine";
import { inlineText } from "./inline-content";
import { resolveInstalledStyle as resolveStyleEffect } from "./styles";
import type { CslStyleRequest, ResolvedCslStyle } from "./styles";

const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

/** Instantiating the Haskell runtime dominates every timing here. */
const TIMEOUT = 60_000;

const PARENT = "http://www.zotero.org/styles/journal";
const DEPENDENT = "http://www.zotero.org/styles/journal-german";

/**
 * Renders a fixed word and the issue month, so one rendered entry says both
 * which style formatted it and which locale it was formatted in.
 */
const PARENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Journal</title>
    <id>${PARENT}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number"/></layout></citation>
  <bibliography>
    <layout>
      <text value="journal"/>
      <date variable="issued" prefix=" ">
        <date-part name="month" form="long"/>
      </date>
    </layout>
  </bibliography>
</style>`;

/** A dependent style: an alias for its parent, save for the locale it sets. */
const DEPENDENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Journal (German)</title>
    <id>${DEPENDENT}</id>
    <link href="${PARENT}" rel="independent-parent"/>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
</style>`;

/** Two authors, so a style that joins them says a word the locale translates. */
const ITEM: CslItemData = {
  id: "1/ZETA1234",
  type: "article-journal",
  title: "A study of nothing",
  author: [
    { family: "Zeta", given: "Ann" },
    { family: "Smith", given: "Bob" },
  ],
  issued: { "date-parts": [[2020, 3]] },
};

describe("Resolved CSL Style", () => {
  effectIt.live(
    "renders an independent style in the locale it declares none over",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        expect(yield* library.entryFor({ styleId: PARENT })).toBe(
          "journal March",
        );
      }),
    TIMEOUT,
  );

  effectIt.live(
    "renders a dependent style with its parent's formatting and its own locale",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        expect(yield* library.entryFor({ styleId: DEPENDENT })).toBe(
          "journal März",
        );
      }),
    TIMEOUT,
  );

  effectIt.live(
    "renders in the Citation Locale a request names",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        expect(
          yield* library.entryFor({ styleId: DEPENDENT, locale: "fr-FR" }),
        ).toBe("journal mars");
      }),
    TIMEOUT,
  );

  effectIt.live(
    "renders the embedded default style in the Citation Locale a request names",
    () =>
      Effect.gen(function* () {
        const library = yield* Effect.acquireDisposable(
          Effect.promise(() => installStyles()),
        );

        // The embedded style carries no CSL of its own, so the locale reaches the
        // processor beside it: "and" between two authors turns into "und".
        expect(
          yield* library.entryFor({ styleId: null, locale: "de-DE" }),
        ).toContain("und Bob Smith");
      }),
    TIMEOUT,
  );
});

/** The Zotero library these renders read their styles from, engine included. */
interface StyleLibrary extends AsyncDisposable {
  /** The one bibliography entry `request` renders {@link ITEM} as, as plain text. */
  entryFor(request: CslStyleRequest): Effect.Effect<string>;
}

async function installStyles(): Promise<StyleLibrary> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-csl-render-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  const styles = join(dataDir, "styles");
  await mkdir(join(styles, "hidden"), { recursive: true });
  await writeFile(join(styles, "hidden", "journal.csl"), PARENT_STYLE);
  await writeFile(join(styles, "journal-german.csl"), DEPENDENT_STYLE);

  const engine = stack.use(
    await createCitationEngine(new Blob([await readFile(WASM_PATH)])),
  );
  const held = stack.move();
  return {
    entryFor: (request) =>
      Effect.gen(function* () {
        const style = yield* resolveStyleEffect(dataDir, request).pipe(
          Effect.provide(NodeFileSystem.layer),
        );
        const [entry] = yield* Effect.promise(() =>
          engine.renderBibliography({
            items: [ITEM],
            ...requested(style),
          }),
        );
        return entry ? inlineText(entry.content) : "";
      }),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** What the engine renders one resolved style with, asserting the resolution stood. */
function requested(style: ResolvedCslStyle): {
  styleXml?: string;
  locale?: string;
} {
  expect(style.kind).not.toBe("failed");
  return style.kind === "installed"
    ? { styleXml: style.xml }
    : { locale: style.kind === "default" ? style.locale : undefined };
}
