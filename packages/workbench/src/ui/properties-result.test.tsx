import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PropertiesPane, PropertiesResult } from "./properties-tab";
// Row summaries and generated frontmatter, migrated from the web Properties suite.
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
  SAMPLE_ITEMS,
} from "#/render/index";

const ROWS_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "---\n# {{ zt.title }}",
  `  - value: {"kind":{"$eval":"zt.itemType"},"title":{"$eval":"zt.title"}}
    merge: replace
---
# {{ zt.title }}`,
);
const controller = new WorkbenchDocumentController(ROWS_PROFILE);
const result = renderProfile(ROWS_PROFILE, SAMPLE_ITEMS[0]!);
afterEach(cleanup);

function pane(diagnostics: { position: number; message: string }[] = []) {
  const mounted = mount(
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
  return Object.assign(mounted, { container: render(mounted.ui).container });
}

function output(showMarkdown = false) {
  const mounted = mount(
    <PropertiesResult
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
      frontmatterBlock={result.frontmatterBlock}
      showMarkdown={showMarkdown}
    />,
  );
  return Object.assign(mounted, { container: render(mounted.ui).container });
}

describe("the Properties rows", () => {
  it("shows a static entry's own value beside its name", () => {
    using mounted = pane();
    expect(mounted.container.textContent).toContain(
      "titleWhy Most Published Research Findings Are False",
    );
  });
  it("counts a spread's produced fields and names them in fold order", () => {
    using mounted = pane();
    expect(mounted.container.textContent).toContain(
      m.workbench_properties_produced({ count: 2, names: "title, kind" }),
    );
  });
  it("marks only the row a diagnostic names", () => {
    using mounted = pane([{ position: 5, message: "The rule stopped." }]);
    const rows = [...mounted.container.querySelectorAll('[data-part="row"]')];
    expect(
      rows.filter((row) =>
        row.textContent.includes(m.workbench_properties_row_problem()),
      ),
    ).toEqual([rows[4]]);
    expect(rows[4]?.textContent).toContain(m.workbench_properties_spread());
  });
  it("leaves every row unmarked while nothing names one", () => {
    using mounted = pane();
    expect(mounted.container.textContent).not.toContain(
      m.workbench_properties_row_problem(),
    );
  });
});

describe("the Properties result column", () => {
  it("groups every produced field under the entry that produced it", () => {
    using mounted = output();
    expect(
      [...mounted.container.querySelectorAll("details dt")].map(
        (term) => term.textContent,
      ),
    ).toEqual(["title", "related", "collections", "citekey", "kind", "title"]);
  });
  it("lists the frontmatter the note gets in fold order", () => {
    using mounted = output();
    expect(
      [...mounted.container.querySelectorAll("section dt")].map(
        (term) => term.textContent,
      ),
    ).toEqual(["title", "related", "collections", "citekey", "kind"]);
  });
  it("hands over the generated YAML when Markdown is asked for", () => {
    using mounted = output(true);
    const raw = mounted.container.textContent;
    expect(raw).toBe(result.frontmatterBlock);
    expect(raw).toContain("title:");
    expect(raw).not.toContain(m.workbench_result_fold());
  });
});
