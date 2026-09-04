// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { InstalledCitationStyle } from "@zotlit/workbench/bridge";
import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { templateRootAt } from "./fields";
import { NameFolderPane } from "./name-folder";
import type { FieldTrigger } from "./slice-editor";

/**
 * A Profile of the reader's own, which is what carries bindings: one folder
 * written explicitly, one toggle explicitly off, and the other three unset.
 */
const OWN_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "id: default",
  `id: reading
folder: papers
importColoredHighlights: false`,
).replace("name: Default", "name: Reading notes");

function textOf(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, "\n")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * One binding's own row: from the label it names to the next row, or to the
 * end of the bindings section when it is the last one.
 */
function bindingRow(markup: string, key: string): string {
  const start = markup.indexOf(`for="workbench-binding-${key}"`);
  expect(start).toBeGreaterThan(-1);
  const next = markup.indexOf('for="workbench-binding-', start + 1);
  const section = markup.indexOf("</section>", start);
  return markup.slice(start, next === -1 ? section : Math.min(next, section));
}

function pane(
  source: string,
  citationStyles?: readonly InstalledCitationStyle[],
) {
  const controller = new WorkbenchDocumentController(source);
  expect(controller.problems).toEqual([]);
  return renderToStaticMarkup(
    <NameFolderPane
      controller={controller}
      manifest={controller.document!.manifest}
      filename="Tufte1983Visual"
      citationStyles={citationStyles ?? null}
    />,
  );
}

interface OpenPane extends Disposable {
  controller: WorkbenchDocumentController;
  host: HTMLElement;
  /** Every `{{` the note-name editor reported, in the order it reported them. */
  triggers: FieldTrigger[];
}

/** The tab mounted for real, so the editor and the confirmation both run. */
function openPane(source: string): OpenPane {
  const controller = new WorkbenchDocumentController(source);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const triggers: FieldTrigger[] = [];
  act(() => {
    root.render(
      <NameFolderPane
        controller={controller}
        manifest={controller.document!.manifest}
        filename="Tufte1983Visual"
        onFieldTrigger={(trigger) => triggers.push(trigger)}
      />,
    );
  });
  return {
    controller,
    host,
    triggers,
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("the Name and folder tab", () => {
  const own = pane(OWN_PROFILE);

  it("shows the profile's own identity fields", () => {
    expect(own).toContain('value="Reading notes"');
    expect(own).toContain('value="1.0.0"');
    expect(own).toContain('value="ZotLit"');
  });

  it("shows the live note name beside the note-name editor", () => {
    expect(textOf(own)).toContain("Tufte1983Visual");
  });

  it("names the origin of an overridden binding and offers Use default", () => {
    const row = bindingRow(own, "folder");

    expect(row).toContain(m.workbench_name_origin_profile());
    expect(row).toContain(
      m.workbench_name_use_default_for({
        name: m.workbench_name_binding_folder(),
      }),
    );
    expect(row).toContain('value="papers"');
  });

  it("names the origin of an inherited binding and offers Override", () => {
    const row = bindingRow(own, "importFolder");

    expect(row).toContain(m.workbench_name_origin_default());
    expect(row).toContain(
      m.workbench_name_override_for({
        name: m.workbench_name_binding_import_folder(),
      }),
    );
    // The inherited value is shown, and the control stays out of reach.
    expect(row).toContain('value="zotero_notes"');
    expect(row).toContain("disabled");
  });

  it("types the citation style as a CSL ID while no vault lists them", () => {
    const row = bindingRow(own, "citationStyle");

    expect(row).toContain(m.workbench_name_citation_style_placeholder());
    expect(row).not.toContain("<select");
  });

  it("picks the citation style from the styles a connected vault installed", () => {
    const row = bindingRow(
      pane(
        OWN_PROFILE.replace(
          "folder: papers",
          "folder: papers\ncitationStyle: apa",
        ),
        [
          { id: "apa", title: "American Psychological Association" },
          { id: "ieee", title: "IEEE" },
        ],
      ),
      "citationStyle",
    );

    expect(row).toContain("<select");
    expect(row).toContain("American Psychological Association");
    expect(row).toContain("IEEE");
    expect(row).toContain(m.workbench_name_value_no_style());
  });

  it("keeps a style the vault has not installed in the picker", () => {
    const row = bindingRow(
      pane(
        OWN_PROFILE.replace(
          "folder: papers",
          "folder: papers\ncitationStyle: chicago",
        ),
        [{ id: "apa", title: "American Psychological Association" }],
      ),
      "citationStyle",
    );

    expect(row).toContain('value="chicago"');
  });

  it("keeps an explicit false apart from an unset toggle", () => {
    const colored = bindingRow(own, "importColoredHighlights");
    const template = bindingRow(own, "importAnnotationsAsTemplate");

    expect(colored).toContain(m.workbench_name_origin_profile());
    expect(template).toContain(m.workbench_name_origin_default());
    // Both read Off; only the origin tells the reader which one the profile
    // wrote down.
    expect(textOf(colored)).toContain(m.workbench_name_value_off());
    expect(textOf(template)).toContain(m.workbench_name_value_off());
  });

  it("shows the built-in Default's settings read-only, with their home", () => {
    const markup = pane(DEFAULT_PROFILE_SOURCE);
    const text = textOf(markup);

    expect(text).toContain(m.workbench_name_default_lede());
    expect(text).toContain("literatures");
    expect(text).toContain(m.workbench_name_value_no_style());
    expect(markup).not.toContain(m.workbench_name_override());
    expect(markup).not.toContain(m.workbench_name_use_default());
  });

  it("offers the Filename Root over a `{{` typed in the note name", () => {
    using tab = openPane(OWN_PROFILE);
    const view = EditorView.findFromDOM(
      tab.host.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const head = view.state.doc.length;

    act(() => {
      view.dispatch({
        changes: { from: head, insert: "{{ }}" },
        selection: { anchor: head + 2 },
        userEvent: "input.type",
      });
    });

    const trigger = tab.triggers.at(-1)!;
    const { document: profile, source } = tab.controller;
    expect(source.slice(trigger.range.from, trigger.range.to)).toBe("{{");
    expect(templateRootAt(profile, source, trigger.range.from)).toBe(
      "filename",
    );
  });

  it("refuses a line break in the note name", () => {
    using tab = openPane(OWN_PROFILE);
    const view = EditorView.findFromDOM(
      tab.host.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const before = tab.controller.source;

    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n" },
        userEvent: "input.type",
      });
    });

    expect(view.state.doc.lines).toBe(1);
    expect(tab.controller.source).toBe(before);
  });

  it("asks before a language change, then writes the manifest key alone", () => {
    using tab = openPane(OWN_PROFILE);
    const select = tab.host.querySelector("select")!;

    act(() => {
      select.value = "eta";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const confirmation = tab.host.querySelector('[role="alert"]')!;
    expect(confirmation.textContent).toContain(
      m.workbench_name_language_confirm_heading(),
    );
    // The question stands on its own; nothing is written behind it.
    expect(tab.controller.source).toBe(OWN_PROFILE);

    const confirm = [...confirmation.querySelectorAll("button")].find(
      (button) => button.textContent === m.workbench_name_language_confirm(),
    )!;
    act(() => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(tab.controller.source).toBe(
      OWN_PROFILE.replace("language: liquid", "language: eta"),
    );
  });
});
