// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { internalLink, section } from "./__fixtures__/internal-link";
import { renderWikilinkCitations } from "./render";

/** The Citation Display Text of every `literatures/…` link, as a stand-in. */
const display = (linktext: string): string | null =>
  linktext.startsWith("literatures/") ? `@${linktext.slice(12)}` : null;

describe("renderWikilinkCitations", () => {
  it("shows the Citation Display Text in the anchor's place", () => {
    const root = section(
      `<p>Claim (${internalLink("literatures/wang2020")}).</p>`,
    );

    expect(renderWikilinkCitations(root, display)).toBe(1);
    expect(root.textContent).toBe("Claim (@wang2020).");
  });

  it("replaces the breadcrumb a Citation Fragment renders as", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020#cite:locator=7")}</p>`,
    );
    renderWikilinkCitations(root, () => "[@wang2020, p. 7]");

    expect(root.textContent).toBe("[@wang2020, p. 7]");
  });

  it("keeps the target, the class, and every other attribute", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, display);

    const anchor = root.querySelector("a");
    expect(anchor?.getAttribute("data-href")).toBe("literatures/wang2020");
    expect(anchor?.getAttribute("href")).toBe("literatures/wang2020");
    expect(anchor?.className).toBe("internal-link");
  });

  it("leaves a link the display has nothing to show for alone", () => {
    const root = section(`<p>${internalLink("notes/plain")}</p>`);

    expect(renderWikilinkCitations(root, display)).toBe(0);
    expect(root.textContent).toBe("notes/plain");
  });

  it("leaves an aliased link alone, since the alias is the chosen display", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020", "Wang et al. (2020)")}</p>`,
    );

    expect(renderWikilinkCitations(root, display)).toBe(0);
    expect(root.textContent).toBe("Wang et al. (2020)");
  });

  it("leaves an alias that reads like the target alone, as Live Preview does", () => {
    const root = section(
      `<p>${internalLink("literatures/wang2020", "literatures/wang2020")}</p>`,
    );

    expect(renderWikilinkCitations(root, display)).toBe(0);
    expect(root.textContent).toBe("literatures/wang2020");
  });

  it("leaves an external link alone", () => {
    const root = section(
      '<p><a class="external-link" href="https://example.com">literatures/wang2020</a></p>',
    );

    expect(renderWikilinkCitations(root, () => "@wang2020")).toBe(0);
  });

  it("shows every link of one section", () => {
    const root = section(
      `<p>${internalLink("literatures/a")} and ${internalLink("literatures/b")}</p>`,
    );

    expect(renderWikilinkCitations(root, display)).toBe(2);
    expect(root.textContent).toBe("@a and @b");
  });

  it("is idempotent, since a replaced anchor no longer shows its own target", () => {
    const root = section(`<p>${internalLink("literatures/wang2020")}</p>`);
    renderWikilinkCitations(root, display);

    expect(renderWikilinkCitations(root, display)).toBe(0);
    expect(root.textContent).toBe("@wang2020");
  });
});
