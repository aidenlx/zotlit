import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import {
  WikilinkDisplaySettings,
  wikilinkDisplayText,
} from "./wikilink-citation";
import type {
  LiteratureNoteTarget,
  WikilinkCitationContext,
} from "./wikilink-citation";

const WANG: LiteratureNoteTarget = {
  path: "literatures/wangMutationalClinicalSpectrum2020a.md",
  citationKey: "wang2020",
};

const WANG_LINK = "literatures/wangMutationalClinicalSpectrum2020a";

function context(
  overrides: Partial<WikilinkCitationContext> = {},
): WikilinkCitationContext {
  return {
    literatureNote: (linkpath) =>
      linkpath.startsWith("literatures/wang") ? WANG : null,
    fragmentlessDisplay: true,
    ...overrides,
  };
}

describe("wikilinkDisplayText", () => {
  it("shows a bare linkpath as its Citation Key Property value", () => {
    expect(wikilinkDisplayText(WANG_LINK, context())).toBe("@wang2020");
  });

  it("shows a Citation Fragment as its Pandoc citation text", () => {
    expect(wikilinkDisplayText(`${WANG_LINK}#cite:locator=7`, context())).toBe(
      "[@wang2020, p. 7]",
    );
  });

  it("falls back to the filename when the note carries no Citation Key Property", () => {
    expect(
      wikilinkDisplayText(
        "literatures/xu2019",
        context({
          literatureNote: () => ({
            path: "literatures/xuNoCitationKeyProperty2019.md",
            citationKey: null,
          }),
        }),
      ),
    ).toBe("@xuNoCitationKeyProperty2019");
  });

  it("shows a fragment-carrying link whatever the display toggle says", () => {
    expect(
      wikilinkDisplayText(
        `${WANG_LINK}#cite:locator=7`,
        context({ fragmentlessDisplay: false }),
      ),
    ).toBe("[@wang2020, p. 7]");
  });

  it("leaves a fragment-less link alone while the display toggle is off", () => {
    expect(
      wikilinkDisplayText(WANG_LINK, context({ fragmentlessDisplay: false })),
    ).toBeNull();
  });

  it("leaves a malformed Citation Fragment raw", () => {
    expect(
      wikilinkDisplayText(`${WANG_LINK}#cite:page=7`, context()),
    ).toBeNull();
    expect(wikilinkDisplayText(`${WANG_LINK}#cite:`, context())).toBeNull();
  });

  it("leaves a heading or block subpath alone", () => {
    expect(wikilinkDisplayText(`${WANG_LINK}#Methods`, context())).toBeNull();
    expect(wikilinkDisplayText(`${WANG_LINK}#^b7c1a2`, context())).toBeNull();
  });

  it("leaves a subpath-only link alone, which names no note", () => {
    expect(wikilinkDisplayText("#Methods", context())).toBeNull();
    expect(wikilinkDisplayText("", context())).toBeNull();
  });

  it("leaves a link that names no Literature Note alone", () => {
    expect(
      wikilinkDisplayText("plain/note#cite:locator=7", context()),
    ).toBeNull();
  });
});

describe("WikilinkDisplaySettings", () => {
  it("seeds from the first snapshot without asking for a redraw", () => {
    const settings = new SettingsStub({
      "citation.wikilink-citations": true,
      "citation.key-links-frontmatter-key": "bibkey",
    });
    const display = new WikilinkDisplaySettings();
    let redraws = 0;

    display.watch(settings, () => redraws++);

    expect(display.fragmentlessDisplay).toBe(true);
    expect(display.citationKeyProperty).toBe("bibkey");
    expect(redraws).toBe(0);
  });

  it("shows fragment-less links only while both wikilink toggles are on", () => {
    const settings = new SettingsStub({
      "citation.wikilink-citations": true,
      "citation.wikilink-display": true,
    });
    const display = new WikilinkDisplaySettings();
    display.watch(settings, () => undefined);

    settings.update({ "citation.wikilink-display": false });
    expect(display.fragmentlessDisplay).toBe(false);

    settings.update({
      "citation.wikilink-display": true,
      "citation.wikilink-citations": false,
    });
    expect(display.fragmentlessDisplay).toBe(false);
  });

  it("asks for a redraw when a later snapshot changes what a link displays", () => {
    const settings = new SettingsStub({
      "citation.wikilink-citations": false,
    });
    const display = new WikilinkDisplaySettings();
    let redraws = 0;
    display.watch(settings, () => redraws++);

    settings.update({ "citation.wikilink-citations": true });
    expect(redraws).toBe(1);

    settings.update({ "citation.key-links-frontmatter-key": "bibkey" });
    expect(redraws).toBe(2);
  });

  it("stays quiet for a setting neither surface reads", () => {
    const settings = new SettingsStub();
    const display = new WikilinkDisplaySettings();
    let redraws = 0;
    display.watch(settings, () => redraws++);

    settings.update({ "citation.citekey-editor": false });
    expect(redraws).toBe(0);
  });

  it("stops following once unsubscribed", () => {
    const settings = new SettingsStub();
    const display = new WikilinkDisplaySettings();
    let redraws = 0;

    display.watch(settings, () => redraws++)();
    settings.update({ "citation.wikilink-citations": true });

    expect(display.fragmentlessDisplay).toBe(false);
    expect(redraws).toBe(0);
  });
});

class SettingsStub {
  current: Readonly<Settings>;
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}
