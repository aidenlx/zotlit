import { regex } from "arkregex";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { PropertiesPane, PropertiesResult } from "./properties-tab";

/**
 * The default Profile with one Spread Entry appended, which produces a key of
 * its own and one the first entry already set — so the entry's own order and
 * the fold's differ.
 */
const ROWS_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "---\n# {{ zt.title }}",
  `  - value: { kind: { $eval: 'zt.itemType' }, title: { $eval: 'zt.title' } }
    merge: replace
---
# {{ zt.title }}`,
);

const sample = SAMPLE_ITEMS[0]!;
const controller = new WorkbenchDocumentController(ROWS_PROFILE);
const result = renderProfile(ROWS_PROFILE, sample);

function textOf(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

/** The property names one column lists, in the order it lists them. */
function terms(markup: string): string[] {
  // Its own scan, so the sweep never resumes where another column left off.
  const term = regex("<dt[^>]*>(?<name>[^<]*)</dt>", "g");
  const found: string[] = [];
  for (let match = term.exec(markup); match; match = term.exec(markup)) {
    found.push(match.groups.name);
  }
  return found;
}

function pane(diagnostics: { position: number; message: string }[] = []) {
  return renderToStaticMarkup(
    <PropertiesPane
      controller={controller}
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
      diagnostics={diagnostics}
      selected={null}
      onSelect={() => {}}
    />,
  );
}

describe("the Properties rows", () => {
  it("shows a static entry's own value beside its name", () => {
    expect(textOf(pane())).toContain(`title${sample.item.title}`);
  });

  it("counts a spread's produced fields and names them in fold order", () => {
    expect(textOf(pane())).toContain(
      m.workbench_properties_produced({ count: 2, names: "title, kind" }),
    );
  });

  it("marks only the row a diagnostic names", () => {
    const marked = textOf(
      pane([{ position: 5, message: "The rule stopped." }]),
    ).split(m.workbench_properties_row_problem());

    expect(marked).toHaveLength(2);
    // The marker sits at the end of its own row, so the row it belongs to is
    // the last one named before it.
    expect(marked[0]).toContain(m.workbench_properties_spread());
    expect(marked[0]).not.toContain(m.workbench_properties_add());
  });

  it("leaves every row unmarked while nothing names one", () => {
    expect(textOf(pane())).not.toContain(m.workbench_properties_row_problem());
  });
});

describe("the Properties result column", () => {
  const markup = renderToStaticMarkup(
    <PropertiesResult
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
    />,
  );
  const [byEntry = "", fold = ""] = markup.split(m.workbench_result_fold());

  it("groups every produced field under the entry that produced it", () => {
    expect(terms(byEntry)).toEqual([
      "title",
      "related",
      "collections",
      "citekey",
      "kind",
      "title",
    ]);
  });

  it("lists the frontmatter the note gets in fold order", () => {
    expect(terms(fold)).toEqual([
      "title",
      "related",
      "collections",
      "citekey",
      "kind",
    ]);
  });
});
