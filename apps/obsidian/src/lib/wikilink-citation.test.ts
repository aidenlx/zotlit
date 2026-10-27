import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { describe, expect } from "vitest";

import { forkEach } from "@/lib/effect-stream";
import { settingsOf } from "@/services/settings/__fixtures__";
import type { Settings } from "@/services/settings/schema";

import {
  WikilinkDisplaySettings,
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "./wikilink-citation";
import type {
  LiteratureNoteTarget,
  WikilinkCitationContext,
} from "./wikilink-citation";

const WANG: LiteratureNoteTarget = {
  path: "literatures/wangMutationalClinicalSpectrum2020a.md",
  indexedKey: "1/WANG2020A",
  citationKey: "wang2020",
};

const WANG_LINK = "literatures/wangMutationalClinicalSpectrum2020a";

const citationSource = (
  linktext: string,
  ctx: WikilinkCitationContext,
): string | null => {
  const citation = wikilinkCitation(linktext, ctx);
  return citation === null
    ? null
    : citationOfRun([{ source: linktext, citation }]).source;
};

function context(
  overrides: Partial<WikilinkCitationContext> = {},
): WikilinkCitationContext {
  return {
    literatureNote: (linkpath) =>
      linkpath.startsWith("literatures/wang") ? WANG : null,
    enabled: true,
    ...overrides,
  };
}

describe("wikilinkCitation", () => {
  it("shows a bare linkpath as its native Zotero citation key", () => {
    expect(citationSource(WANG_LINK, context())).toBe("[@wang2020]");
  });

  it("shows a Citation Fragment as its Pandoc citation text", () => {
    expect(citationSource(`${WANG_LINK}#cite:locator=7`, context())).toBe(
      "[@wang2020, {p. 7}]",
    );
  });

  it("falls back to the filename when the Item carries no native citation key", () => {
    expect(
      citationSource(
        "literatures/xu2019",
        context({
          literatureNote: () => ({
            path: "literatures/xuNoCitekey2019.md",
            indexedKey: "1/XU2019",
            citationKey: null,
          }),
        }),
      ),
    ).toBe("[@xuNoCitekey2019]");
  });

  it("leaves an unrepresentable filename fallback native", () => {
    expect(
      citationSource(
        "literatures/xu2019",
        context({
          literatureNote: () => ({
            path: "literatures/Xu 2019.md",
            indexedKey: "1/XU2019",
            citationKey: null,
          }),
        }),
      ),
    ).toBeNull();
  });

  it("leaves a fragment-carrying link native while Wikilink Citations is off", () => {
    expect(
      citationSource(
        `${WANG_LINK}#cite:locator=7`,
        context({ enabled: false }),
      ),
    ).toBeNull();
  });

  it("leaves a fragment-less link alone while rendering is off", () => {
    expect(citationSource(WANG_LINK, context({ enabled: false }))).toBeNull();
  });

  it("leaves a malformed Citation Fragment raw", () => {
    expect(citationSource(`${WANG_LINK}#cite:page=7`, context())).toBeNull();
    expect(citationSource(`${WANG_LINK}#cite:`, context())).toBeNull();
  });

  it("leaves a heading or block subpath alone", () => {
    expect(citationSource(`${WANG_LINK}#Methods`, context())).toBeNull();
    expect(citationSource(`${WANG_LINK}#^b7c1a2`, context())).toBeNull();
  });

  it("leaves a subpath-only link alone, which names no note", () => {
    expect(citationSource("#Methods", context())).toBeNull();
    expect(citationSource("", context())).toBeNull();
  });

  it("leaves a link that names no Literature Note alone", () => {
    expect(citationSource("plain/note#cite:locator=7", context())).toBeNull();
  });
});

describe("citationRuns", () => {
  /** One link of a stand-in surface: its name, and the text before it. */
  const link = (name: string, separatorBefore: string | null) => ({
    name,
    separatorBefore,
  });
  /** Every named link writes a Citation; a link named "plain" writes none. */
  const runs = (links: { name: string; separatorBefore: string | null }[]) =>
    citationRuns(
      links,
      ({ name }) =>
        name === "plain" ? null : wikilinkCitation(WANG_LINK, context()),
      (_previous, next) => next.separatorBefore,
    ).map((run) => run.map(({ source }) => source.name));

  it("joins Citations a bare semicolon separates", () => {
    expect(runs([link("a", null), link("b", ";")])).toEqual([["a", "b"]]);
  });

  it("joins them through spaces or tabs around the semicolon", () => {
    expect(runs([link("a", null), link("b", " ; "), link("c", "\t;")])).toEqual(
      [["a", "b", "c"]],
    );
  });

  it("ends a run at a comma, at prose, and at a line break", () => {
    expect(
      runs([
        link("a", null),
        link("b", ", "),
        link("c", " and "),
        link("d", ";\n"),
      ]),
    ).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("ends a run at a link too far apart to join at all", () => {
    expect(runs([link("a", null), link("b", null)])).toEqual([["a"], ["b"]]);
  });

  it("ends a run at a link that writes no Citation, and leaves it out", () => {
    expect(runs([link("a", null), link("plain", ";"), link("b", ";")])).toEqual(
      [["a"], ["b"]],
    );
  });
});

describe("citationOfRun", () => {
  /** One run member; the surface it came from is nothing this reads. */
  const member = (linktext: string) => ({
    source: linktext,
    citation: wikilinkCitation(linktext, context())!,
  });

  it("derives a lone fragment-less link as a parenthetical Citation", () => {
    expect(citationOfRun([member(WANG_LINK)])).toEqual({
      source: "[@wang2020]",
      keys: expect.anything(),
      works: [WANG.indexedKey],
    });
  });

  it("reads a run as the grouped source the exporter writes", () => {
    const citation = citationOfRun([
      member(`${WANG_LINK}#cite:locator=7`),
      member(WANG_LINK),
    ]);

    expect(citation.source).toBe("[@wang2020, {p. 7}; @wang2020]");
  });

  it("keeps Author-in-text mode and later items in one Citation", () => {
    const citation = citationOfRun([
      member(`${WANG_LINK}#cite:mode=author-in-text&locator=7`),
      member(WANG_LINK),
    ]);

    expect(citation.source).toBe("@wang2020 [{p. 7}; @wang2020]");
  });
});

/** Lets a Stream consumer take what was just published. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow;
});

/**
 * A display that follows the real settings, seeded with `overrides` before it
 * starts, and counts the redraws it asks for until the test Scope closes.
 */
const following = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const settings = yield* settingsOf({
    plugin: {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
  });
  yield* settings.update(overrides);
  const display = new WikilinkDisplaySettings();
  let redraws = 0;
  const fiber = yield* forkEach(display.redraws(settings.changes), () => {
    redraws++;
  });
  yield* settle;
  return {
    display,
    redraws: () => redraws,
    stop: Fiber.interrupt(fiber),
    update: (next: Partial<Settings>) =>
      Effect.andThen(settings.update(next), settle),
  };
});

describe("WikilinkDisplaySettings", () => {
  it.effect("seeds from the first snapshot without asking for a redraw", () =>
    Effect.gen(function* () {
      const { display, redraws } = yield* following({
        "citation.wikilink-citations": true,
      });

      expect(display.enabled).toBe(true);
      expect(redraws()).toBe(0);
    }),
  );

  it.effect(
    "shows wikilinks only while their source and formatted presentation are on",
    () =>
      Effect.gen(function* () {
        const { display, update } = yield* following({
          "citation.wikilink-citations": true,
          "citation.show-formatted": true,
        });

        yield* update({ "citation.show-formatted": false });
        expect(display.enabled).toBe(false);

        yield* update({
          "citation.show-formatted": true,
          "citation.wikilink-citations": false,
        });
        expect(display.enabled).toBe(false);
      }),
  );

  it.effect(
    "asks for a redraw when a later snapshot changes what a link displays",
    () =>
      Effect.gen(function* () {
        const { redraws, update } = yield* following({
          "citation.wikilink-citations": false,
        });

        yield* update({ "citation.wikilink-citations": true });
        expect(redraws()).toBe(1);

        yield* update({ "citation.show-formatted": false });
        expect(redraws()).toBe(2);
      }),
  );

  it.effect("stays quiet for a setting neither surface reads", () =>
    Effect.gen(function* () {
      const { redraws, update } = yield* following();

      yield* update({ "citation.pandoc-citations": false });
      expect(redraws()).toBe(0);
    }),
  );

  it.effect("takes the click while Citations stay closed as links", () =>
    Effect.gen(function* () {
      const { display, redraws, update } = yield* following({
        "citation.open-as-links": true,
      });
      expect(display.clickIntercepted).toBe(false);

      yield* update({ "citation.open-as-links": false });

      expect(display.clickIntercepted).toBe(true);
      expect(redraws()).toBe(1);
    }),
  );

  it.effect("reads the click apart from the Hover Action", () =>
    Effect.gen(function* () {
      const { display } = yield* following({
        "citation.hover-action": "off",
      });

      expect(display.popoverHover).toBe(false);
      expect(display.clickIntercepted).toBe(true);
    }),
  );

  it.effect("stops following once its consumer is interrupted", () =>
    Effect.gen(function* () {
      const { display, redraws, stop, update } = yield* following();

      yield* stop;
      yield* update({ "citation.wikilink-citations": true });

      expect(display.enabled).toBe(false);
      expect(redraws()).toBe(0);
    }),
  );
});
