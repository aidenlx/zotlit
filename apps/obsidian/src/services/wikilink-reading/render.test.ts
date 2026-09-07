// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { citationOfRun, wikilinkCitation } from "@/lib/wikilink-citation";
import type { RunMember, WikilinkCitation } from "@/lib/wikilink-citation";
import { presented } from "@/services/citation-text/__fixtures__";
import type { PresentedCitation } from "@/services/citation-text/present";

import { internalLink, section } from "./__fixtures__/internal-link";
import { renderCitationRuns, sectionCitationRuns } from "./render";

/** The scan and the swap together, which is how one section renders. */
const renderWikilinkCitations = (
  root: HTMLElement,
  citations: (linktext: string) => WikilinkCitation | null,
  format: (
    run: readonly RunMember<HTMLAnchorElement>[],
  ) => PresentedCitation | null,
): number => renderCitationRuns(sectionCitationRuns(root, citations), format);

/** Every `literatures/…` link names a Literature Note; nothing else does. */
const citationOf = (linktext: string): WikilinkCitation | null =>
  wikilinkCitation(linktext, {
    literatureNote: (linkpath) =>
      linkpath.startsWith("literatures/")
        ? {
            path: `${linkpath}.md`,
            indexedKey: "1/ITEM",
            citationKey: linkpath.slice("literatures/".length),
          }
        : null,
    enabled: true,
  });

/** Stand-in formatted text used to exercise the generic DOM swap. */
const display = (
  run: readonly RunMember<HTMLAnchorElement>[],
): PresentedCitation => {
  const only = run.length === 1 ? run[0]!.citation.item : null;
  const details = only?.details;
  return presented(
    only &&
      details?.mode === "normal" &&
      details.prefix === null &&
      details.locator === null &&
      details.suffix === null
      ? `@${only.citekey}`
      : citationOfRun(run).source,
  );
};

describe("renderWikilinkCitations", () => {
  it("shows supplied text in the anchor's place", () => {
    const root = section(
      `<p>Claim (${internalLink("literatures/wang2020")}).</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(1);
    expect(root.textContent).toBe("Claim (@wang2020).");
  });

  it("replaces the breadcrumb a Citation Fragment renders as", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020#cite:locator=7")}</p>`,
    );
    renderWikilinkCitations(root, citationOf, display);

    expect(root.textContent).toBe("[@wang2020, {p. 7}]");
  });

  it("puts the formatted citation, markup and all, in the anchor", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, citationOf, () => ({
      text: {
        content: [
          { t: "Str", c: "(Wang" },
          { t: "Space" },
          { t: "Emph", c: [{ t: "Str", c: "et al." }] },
          { t: "Space" },
          { t: "Str", c: "2020)" },
        ],
        citations: [],
      },
      serials: [],
    }));

    expect(root.querySelector("a")?.innerHTML).toBe(
      "(Wang <em>et al.</em> 2020)",
    );
  });

  it("shows a link the style wrote as text, since the anchor is Obsidian's", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, citationOf, () => ({
      text: {
        content: [
          {
            t: "Link",
            c: [
              ["", [], []],
              [{ t: "Str", c: "doi.org/10.1/x" }],
              ["https://doi.org/10.1/x", ""],
            ],
          },
        ],
        citations: [],
      },
      serials: [],
    }));

    const anchor = root.querySelector("a");
    expect(anchor?.querySelector("a")).toBeNull();
    expect(anchor?.textContent).toBe("doi.org/10.1/x");
  });

  it("keeps the target and every native attribute", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, citationOf, display);

    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("data-href")).toBe("literatures/wang2020");
    expect(anchor?.getAttribute("href")).toBe("literatures/wang2020");
    expect(anchor?.classList.contains("internal-link")).toBe(true);
    expect(anchor?.classList.contains("zt-citation")).toBe(true);
  });

  it("leaves a link that names no Literature Note alone", () => {
    const root = section(`<p>${internalLink("notes/plain")}</p>`);

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(0);
    expect(root.textContent).toBe("notes/plain");
  });

  it("leaves an aliased link alone, since the alias is the chosen display", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020", "Wang et al. (2020)")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(0);
    expect(root.textContent).toBe("Wang et al. (2020)");
  });

  it("leaves an alias that reads like the target alone, as Live Preview does", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020", "literatures/wang2020")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(0);
    expect(root.textContent).toBe("literatures/wang2020");
  });

  it("leaves an external link alone", () => {
    const root = section(
      '<p><a class="external-link" href="https://example.com">literatures/wang2020</a></p>',
    );

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(0);
  });

  it("shows every Citation of one section", () => {
    const root = section(
      `<p>${internalLink("literatures/a")} and ${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(2);
    expect(root.textContent).toBe("@a and @b");
  });

  it("is idempotent, since a replaced anchor no longer shows its own target", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, citationOf, display);

    expect(renderWikilinkCitations(root, citationOf, display)).toBe(0);
    expect(root.textContent).toBe("@wang2020");
  });
});

describe("renderWikilinkCitations over a Citation Run", () => {
  /** The formatted text of a run, which names the works it groups. */
  const grouped = (
    run: readonly RunMember<HTMLAnchorElement>[],
  ): PresentedCitation =>
    presented(
      `(${run.map(({ citation }) => citation.item.citekey).join("; ")})`,
    );

  it("collapses a semicolon-joined run into its first anchor", () => {
    const root = section(
      `<p>Both ${internalLink("literatures/a")}; ${internalLink("literatures/b")}.</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(1);
    expect(root.textContent).toBe("Both (a; b).");
    expect(root.querySelectorAll("a")).toHaveLength(1);
    expect(root.querySelector("a")?.getAttribute("data-href")).toBe(
      "literatures/a",
    );
  });

  it("joins a run written with no space around the separator", () => {
    const root = section(
      `<p>${internalLink("literatures/a")};${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(1);
    expect(root.textContent).toBe("(a; b)");
  });

  it("keeps two Citations apart when anything but a semicolon separates them", () => {
    const root = section(
      `<p>${internalLink("literatures/a")}, then ${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(2);
    expect(root.textContent).toBe("(a), then (b)");
  });

  it("ends a run at a line break, which writes no text of its own", () => {
    const root = section(
      `<p>${internalLink("literatures/a")};<br>${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(2);
  });

  it("ends a run at a paragraph break", () => {
    const root = section(
      `<p>${internalLink("literatures/a")};</p><p>${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(2);
  });

  it("ends a run at a link that names no Literature Note", () => {
    const root = section(
      `<p>${internalLink("literatures/a")}; ${internalLink("notes/plain")}; ${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, citationOf, grouped)).toBe(2);
    expect(root.textContent).toBe("(a); notes/plain; (b)");
  });
});
