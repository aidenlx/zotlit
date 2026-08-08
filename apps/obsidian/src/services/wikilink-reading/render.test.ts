// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { wikilinkCitation } from "@/lib/wikilink-citation";
import type { RunMember, WikilinkCitation } from "@/lib/wikilink-citation";

import { internalLink, section } from "./__fixtures__/internal-link";
import { renderCitationRuns, sectionCitationRuns } from "./render";

/** The scan and the swap together, which is how one section renders. */
const renderWikilinkCitations = (
  root: HTMLElement,
  citations: (linktext: string) => WikilinkCitation | null,
  format: (
    run: readonly RunMember<HTMLAnchorElement>[],
  ) => Node | string | null,
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
    fragmentlessDisplay: true,
  });

/** The Citation Display Text of a run, which is what a pending render shows. */
const display = (run: readonly RunMember<HTMLAnchorElement>[]): string =>
  run.length === 1 ? run[0]!.citation.displayText : `run(${run.length})`;

describe("renderWikilinkCitations", () => {
  it("shows the Citation Display Text in the anchor's place", () => {
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

    expect(root.textContent).toBe("[@wang2020, p. 7]");
  });

  it("puts a formatted citation in the anchor", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    const formatted = document.createElement("span");
    formatted.textContent = "(Wang et al. 2020)";
    renderWikilinkCitations(root, citationOf, () => formatted);

    expect(root.querySelector("a")?.firstElementChild).toBe(formatted);
    expect(root.textContent).toBe("(Wang et al. 2020)");
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
  const grouped = (run: readonly RunMember<HTMLAnchorElement>[]): string =>
    `(${run.map(({ citation }) => citation.item.citekey).join("; ")})`;

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
