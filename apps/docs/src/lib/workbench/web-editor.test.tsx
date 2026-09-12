import { EditorView } from "@codemirror/view";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

// @vitest-environment happy-dom
// Web orchestration: route shared callbacks to the page, its field column,
// imported files, connected Item snapshots, and independent preview results.
import { m } from "@/paraglide/messages.js";

import {
  KEY,
  KEPT,
  withSampleItemType,
  emptied,
  open,
  launch,
  press,
  fieldRow,
  chooseAnnotation,
  resultText,
  sourceView,
  chosenTab,
  importFile,
  openMenu,
  openSheet,
  rendered,
  keep,
  title,
  shownItem,
  bridgeFetch,
} from "./page-test-host";
import type { BridgeRequest } from "./page-test-host";

describe("a draft the parser refuses", () => {
  it("keeps the last good result, and opens the pane the problem names", async () => {
    await using page = await open();
    await page.settle();
    const rendersOfGoodSource = rendered().length;
    expect(rendersOfGoodSource).toBeGreaterThan(0);

    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    const broken = view.state.doc
      .toString()
      .replace("# {{ zt.title }}", "{% managed %}\nTwice\n{% endmanaged %}");
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: broken },
        userEvent: "input.type",
      });
    });
    await page.settle();

    // Nothing renders a draft the parser refuses, so the sheet keeps the last
    // good result while the Problems strip carries the repair.
    expect(rendered()).toHaveLength(rendersOfGoodSource);
    expect(page.host.textContent).toContain(m.workbench_problems_heading());

    page.press(m.workbench_problems_where_note());

    expect(chosenTab(page.host)).toBe(m.workbench_tab_note());
  });

  it("opens Profile for a field that tab writes", async () => {
    await using page = await open();
    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    act(() => {
      view.dispatch({
        changes: emptied(view.state.doc.toString(), "name: Default"),
        userEvent: "input.type",
      });
    });
    await page.settle();

    expect(page.host.textContent).toContain(m.workbench_problems_heading());
    page.press(m.workbench_problems_where_details());

    expect(chosenTab(page.host)).toBe(m.workbench_tab_profile());
    // The form writes its fields through controls, so the reader lands in the
    // one holding the field the parser named.
    expect(document.activeElement?.id.endsWith("-field-name")).toBe(true);
  });
});

describe("the paper a profile is written for", () => {
  it("searches paper details in a dialog and restores focus without changing a dismissed choice", async () => {
    await using page = await open();
    page.press(m.workbench_choose_item());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await page.waitFor(() => expect(document.activeElement).toBe(input));
    expect(dialog.textContent).toContain(m.workbench_sample_loaded());
    expect(dialog.textContent).toContain(m.workbench_sample_disconnected());
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Kahneman");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitFor(() =>
      expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(1),
    );
    expect(dialog.textContent).toContain("Thinking, fast and slow");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await page.waitFor(() =>
      expect(document.activeElement).toBe(
        page.host.querySelector("#workbench-sample"),
      ),
    );
    expect(
      page.host.querySelector("#workbench-sample")?.parentElement?.textContent,
    ).toContain("Why Most Published Research Findings Are False");
  });

  it("shows paper details and switches samples through the picker", async () => {
    await using page = await open();
    act(() =>
      page.host.querySelector<HTMLElement>("#workbench-sample")!.click(),
    );
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "Why Most Published Research Findings Are FalseIoannidis · PLoS Medicine",
      "Designing reproducible research interfacesRivera & Chen · Proceedings of the Open Research Conference",
      "Thinking, fast and slowKahneman",
      "Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media citiesBatista",
    ]);
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    for (const key of ["CNPF226A", "NW2CPDTC", "I49R3FTL", "IANNP5A2"]) {
      await page.show(key);
      expect(shownItem(page.host)).toBe(
        SAMPLE_ITEMS.find((sample) => sample.item.key === key)!.item.title,
      );
    }
  });

  it("opens on the bundled sample item its sample item type names", async () => {
    const book = SAMPLE_ITEMS.find(({ item }) => item.itemType === "book")!;
    await using page = await open();

    importFile(page.host, withSampleItemType("book"));

    await page.waitFor(() =>
      expect(shownItem(page.host)).toBe(book.item.title),
    );
  });

  it("names a type no bundled sample carries, and keeps the paper on screen", async () => {
    await using page = await open();

    importFile(page.host, withSampleItemType("webpage"));

    await page.waitFor(() =>
      expect(page.host.textContent).toContain(
        m.docs_workbench_sample_type_missing({ itemType: "webpage" }),
      ),
    );
    expect(shownItem(page.host)).toBe(SAMPLE_ITEMS[0]!.item.title);
  });
});

describe("the field list", () => {
  it("searches the complete Zotero tree without opening the foot first", async () => {
    await using page = await open();
    const search = page.host.querySelector<HTMLInputElement>(
      `input[aria-label="${m.workbench_fields_search_note()}"]`,
    )!;

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "DOI");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.waitFor(() =>
      expect(
        fieldRow(page.host, "DOI").getAttribute("data-workbench-field"),
      ).toBe("DOI"),
    );
    expect(page.host.textContent).not.toContain(
      m.workbench_fields_no_matches(),
    );
  });
});

describe("the result column", () => {
  it("offers the update-only managed region beside the note", async () => {
    await using page = await open();

    expect(page.host.textContent).toContain(m.workbench_result_heading());
    const select = [...page.host.querySelectorAll("select")].find((select) =>
      select.querySelector('option[value="managed"]'),
    )!;
    act(() => {
      select.value = "managed";
      select.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The part an update rewrites is its own result, so it is read on its own
    // rather than found inside the note a creation gets.
    press(
      page.host.querySelector<HTMLElement>("#workbench-result-pane")!,
      m.workbench_help(),
    );
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      m.workbench_result_managed_lede(),
    );
    expect(page.host.textContent).toContain(m.workbench_result_heading());
  });
});

describe("the simplified editing flow", () => {
  it("keeps an edited draft until the reader confirms opening another file", async () => {
    await using page = await open();
    page.press(m.workbench_advanced());
    const view = sourceView(page.host);
    act(() =>
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: "\nMy annotation format",
        },
        userEvent: "input.type",
      }),
    );
    const edited = view.state.doc.toString();

    importFile(page.host, KEPT);
    await page.waitFor(() =>
      expect(openSheet(page.host).textContent).toContain(
        m.workbench_replace_heading(),
      ),
    );
    expect(title(page.host)).toBe("Default");
    press(openSheet(page.host), m.workbench_keep_editing());
    expect(sourceView(page.host).state.doc.toString()).toBe(edited);

    importFile(page.host, KEPT);
    await page.waitFor(() =>
      expect(openSheet(page.host).textContent).toContain(
        m.workbench_replace_heading(),
      ),
    );
    press(openSheet(page.host), m.workbench_import());
    await page.waitFor(() => expect(title(page.host)).toBe("Kept work"));
  });

  it("can undo an unsupported edit and replace it through the save guard", async () => {
    await using page = await open();
    page.press(m.workbench_advanced());
    const editLanguage = () => {
      const view = sourceView(page.host);
      const from = view.state.doc.toString().indexOf("language: liquid");
      act(() =>
        view.dispatch({
          changes: {
            from,
            to: from + "language: liquid".length,
            insert: "language: eta",
          },
          userEvent: "input.type",
        }),
      );
    };
    editLanguage();
    expect(title(page.host)).toBe(m.workbench_unsupported_heading());
    page.press(m.workbench_undo());
    expect(sourceView(page.host).state.doc.toString()).toBe(
      DEFAULT_PROFILE_SOURCE,
    );
    editLanguage();
    importFile(page.host, KEPT);
    await page.waitFor(() =>
      expect(openSheet(page.host).textContent).toContain(
        m.workbench_replace_heading(),
      ),
    );
    press(openSheet(page.host), m.workbench_import());
    await page.waitFor(() => expect(title(page.host)).toBe("Kept work"));
  });

  it("downloads an imported file without saving over the connected profile", async () => {
    const requests: BridgeRequest[] = [];
    vi.stubGlobal("fetch", bridgeFetch(requests));
    await using page = await launch();
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );

    importFile(page.host, KEPT);
    await page.waitFor(() => expect(title(page.host)).toBe("Kept work"));
    expect(
      [...page.host.querySelectorAll("button")].some(
        (button) => button.textContent === m.workbench_save(),
      ),
    ).toBe(false);
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:profile";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    page.press(m.workbench_download());
    await expect(blobs[0]!.text()).resolves.toBe(KEPT);
    expect(
      requests.some(
        ({ path }) => path === LOCAL_BRIDGE_PATHS.saveSelectedProfile,
      ),
    ).toBe(false);
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!).source).toBe(KEPT);

    openMenu(page.host);
    press(document.body, m.workbench_reload_profile());
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    expect(page.host.textContent).toContain(m.workbench_save());
  });

  it("opens a new property and inserts a field in value syntax", async () => {
    await using page = await open();
    await page.settle();
    page.press(m.workbench_tab_properties());
    page.press(m.workbench_properties_add());
    const row = page.host.querySelector<HTMLElement>('[id$="-property-5"]')!;
    expect(row).not.toBeNull();
    expect(document.activeElement).toBe(row.querySelector("input"));
    const value = EditorView.findFromDOM(
      row.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    act(() =>
      value.dispatch({
        selection: { anchor: 0, head: value.state.doc.length },
      }),
    );
    press(
      fieldRow(page.host, m.workbench_field_authors()),
      m.workbench_fields_put_in_note(),
    );
    expect(value.state.doc.toString()).toBe("zt.authors");
    page.press(m.workbench_advanced());
    expect(sourceView(page.host).state.doc.toString()).toContain(
      "key: property\n    expr: zt.authors",
    );

    const source = sourceView(page.host);
    const from = source.state.doc.toString().lastIndexOf("zt.authors");
    act(() =>
      source.dispatch({
        selection: { anchor: from, head: from + "zt.authors".length },
      }),
    );
    press(
      fieldRow(page.host, m.workbench_field_title()),
      m.workbench_fields_put_in_note(),
    );
    expect(source.state.doc.toString()).toContain(
      "key: property\n    expr: zt.title",
    );
  });

  it("announces the current autocomplete choice after an arrow key", async () => {
    await using page = await open();
    await page.settle();
    page.press(m.workbench_tab_properties());
    page.press(m.workbench_properties_add());
    const value = EditorView.findFromDOM(
      page.host.querySelector<HTMLElement>('[id$="-property-5"] .cm-editor')!,
    )!;
    act(() => {
      value.focus();
      value.dispatch({
        changes: { from: 0, to: value.state.doc.length, insert: "zt." },
        selection: { anchor: 3 },
        userEvent: "input.type",
      });
      value.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    await page.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).not.toBeNull(),
    );
    act(() => {
      value.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await page.waitFor(() => {
      const selected = document.querySelector(
        '[role="option"][aria-selected="true"]',
      )!;
      expect(selected.textContent).toContain("Authors");
      expect(value.contentDOM.getAttribute("aria-activedescendant")).toBe(
        selected.id,
      );
    });
  });
});

describe("the annotation box", () => {
  it("routes a failing note call to the format while keeping a successful example", async () => {
    keep(
      DEFAULT_PROFILE_SOURCE.replace(
        "{{ zt.imgLink | embed }}{{ zt.text }}",
        "{% if zt.type == 'highlight' %}{% render 'missing-for-highlight' %}{% endif %}{{ zt.comment }}",
      ),
      SAMPLE_ITEMS[1]!,
    );
    await using page = await open();
    page.press(m.workbench_restore_accept());
    page.press(m.workbench_tab_annotation());
    await chooseAnnotation(page, "Compare these findings");
    await page.waitFor(() =>
      expect(resultText(page.host)).toContain(
        "Compare these findings with the replication study.",
      ),
    );
    expect(
      page.host.querySelector('[data-part="problem"][role="status"]')
        ?.textContent,
    ).toContain("missing-for-highlight");
    page.press(m.workbench_tab_note());
    expect(resultText(page.host)).toContain("missing-for-highlight");
    press(
      page.host.querySelector<HTMLElement>(
        '[role="region"][data-part="region"]',
      )!,
      m.workbench_annotation_edit_format(),
    );
    expect(chosenTab(page.host)).toBe(m.workbench_tab_annotation());
  });

  it("offers section repair after deleting it from Source", async () => {
    await using page = await open();
    page.press(m.workbench_advanced());
    const source = sourceView(page.host);
    const from = source.state.doc
      .toString()
      .indexOf("--- zotlit:annotation ---");
    act(() =>
      source.dispatch({ changes: { from, to: source.state.doc.length } }),
    );
    page.press(m.workbench_annotation_label());
    expect(chosenTab(page.host)).toBe(m.workbench_tab_annotation());
    page.press(m.workbench_section_repair());
    await page.settle();
    expect(rendered().at(-1)).toBe(
      `${DEFAULT_PROFILE_SOURCE.slice(0, from)}--- zotlit:annotation ---\n`,
    );
  });

  it("preserves an item annotation by identity on refresh and falls back when it leaves", async () => {
    const paper = SAMPLE_ITEMS[1]!;
    const base = paper.roots.annotations[0]!;
    const first = {
      ...base,
      key: "FIRST001",
      indexedKey: "FIRST001",
      text: "First annotation on this paper.",
    };
    const second = {
      ...base,
      key: "SECOND01",
      indexedKey: "SECOND01",
      text: "Second annotation on this paper.",
    };
    const snapshot = (annotations: (typeof first)[], revision: string) => ({
      ...paper,
      revision,
      roots: { ...paper.roots, annotations },
      descriptors: {
        ...paper.descriptors,
        annotations: annotations.map((annotation) => ({
          ...paper.descriptors.annotations[0]!,
          stringCoercions:
            paper.descriptors.annotations[0]!.stringCoercions.map((entry) =>
              entry.path.length === 0
                ? { ...entry, value: annotation.text }
                : entry,
            ),
        })),
      },
    });
    let loaded = snapshot([first, second], "initial");
    vi.stubGlobal("fetch", bridgeFetch([], { item: () => loaded }));
    await using page = await launch();
    await page.waitFor(() =>
      expect(title(page.host)).toBe("Connected profile"),
    );
    await page.waitFor(() =>
      expect(page.host.textContent).toContain(m.workbench_connected_badge()),
    );
    page.press(m.workbench_tab_annotation());
    await chooseAnnotation(page, "Second annotation on this paper.");
    await page.waitFor(() =>
      expect(resultText(page.host)).toContain(
        "Second annotation on this paper.",
      ),
    );

    loaded = snapshot(
      [{ ...second, text: "Updated second annotation." }, first],
      "reordered",
    );
    page.press(m.workbench_tab_note());
    page.press(m.workbench_refresh_item());
    page.press(m.workbench_tab_annotation());
    await page.waitFor(() =>
      expect(resultText(page.host)).toContain("Updated second annotation."),
    );

    loaded = snapshot([first], "removed");
    page.press(m.workbench_tab_note());
    page.press(m.workbench_refresh_item());
    page.press(m.workbench_tab_annotation());
    await page.waitFor(() =>
      expect(resultText(page.host)).toContain(
        "First annotation on this paper.",
      ),
    );

    loaded = snapshot([], "empty");
    page.press(m.workbench_tab_note());
    page.press(m.workbench_refresh_item());
    page.press(m.workbench_tab_annotation());
    await page.waitFor(() =>
      expect(resultText(page.host)).toContain(
        "Clear methods make research easier to reproduce.",
      ),
    );
  });

  it("keeps a built-in choice across paper changes and restores it with the browser draft", async () => {
    {
      await using page = await open();
      page.press(m.workbench_tab_annotation());
      await chooseAnnotation(
        page,
        "Report the assumptions behind each result.",
      );
      page.press(m.workbench_tab_note());
      await page.show(SAMPLE_ITEMS[2]!.item.key);
      page.press(m.workbench_tab_annotation());
      await page.settle();
      await page.waitFor(() =>
        expect(resultText(page.host)).toContain(
          "Report the assumptions behind each result.",
        ),
      );
      page.press(m.workbench_advanced());
      expect(sourceView(page.host).state.doc.toString()).toBe(
        DEFAULT_PROFILE_SOURCE,
      );
    }
    await using restored = await open();
    restored.press(m.workbench_restore_accept());
    restored.press(m.workbench_tab_annotation());
    await restored.settle();
    await restored.waitFor(() =>
      expect(resultText(restored.host)).toContain(
        "Report the assumptions behind each result.",
      ),
    );
    restored.press(m.workbench_tab_note());
    expect(resultText(restored.host)).toContain("Thinking, fast and slow");
  });

  it("keeps Preview annotation choices separate from editor fields and compact examples", async () => {
    await using page = await open();
    page.press(m.workbench_tab_annotation());
    await page.settle();
    await page.waitFor(() =>
      expect(
        page.host.querySelector('[role="region"][data-part="region"]')
          ?.textContent,
      ).toContain("Clear methods make research easier to reproduce."),
    );
    page.press(m.workbench_choose_annotation());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain(m.workbench_annotation_from_item());
    expect(dialog.textContent).toContain(m.workbench_annotation_empty());
    const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "replication");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitFor(() =>
      expect(
        dialog.querySelector('[role="option"][aria-selected="true"]')
          ?.textContent,
      ).toContain("replication study"),
    );
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await page.settle();
    expect(
      page.host.querySelector('[role="region"][data-part="region"]')
        ?.textContent,
    ).toContain("Compare these findings with the replication study.");
    expect(
      fieldRow(page.host, m.workbench_field_comment()).textContent,
    ).toContain("Use this point in the literature review.");
    page.press(m.workbench_tab_note());
    expect(
      page.host.querySelector('[role="region"][data-part="region"]')
        ?.textContent,
    ).toContain("Why Most Published Research Findings Are False");
    expect(
      page.host.querySelector('[role="region"][data-part="region"]')
        ?.textContent,
    ).not.toContain("Compare these findings");
    const placeholder = page.host.querySelector<HTMLElement>(
      "[data-annotation-box]",
    )!;
    act(() =>
      placeholder.querySelector<HTMLButtonElement>("[aria-pressed]")!.click(),
    );
    await page.waitFor(() =>
      expect(
        page.host.querySelector("[data-annotation-preview]")?.textContent,
      ).toContain("Clear methods make research easier to reproduce."),
    );
    const note = EditorView.findFromDOM(
      page.host.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const sourceBefore = note.state.doc.toString();
    press(
      page.host.querySelector<HTMLElement>("[data-annotation-preview]")!,
      m.workbench_choose_annotation(),
    );
    const inlineDialog =
      document.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() =>
      [...inlineDialog.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) =>
          option.textContent?.includes("Report the assumptions"),
        )!
        .click(),
    );
    await page.settle();
    expect(note.state.doc.toString()).toBe(sourceBefore);
    expect(
      page.host.querySelector("[data-annotation-preview]")?.textContent,
    ).toContain("Report the assumptions behind each result.");
    page.press(m.workbench_tab_annotation());
    expect(resultText(page.host)).toContain(
      "Compare these findings with the replication study.",
    );
  });

  /** The default Profile with neither the call nor the section it calls. */
  const SILENT = DEFAULT_PROFILE_SOURCE.replace(
    "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n",
    "",
  ).replace(/\n--- zotlit:annotation ---\n[\s\S]*$/, "\n");

  it("gives a note without the call its loop, and the section it needs, in one press", async () => {
    keep(SILENT, SAMPLE_ITEMS[1]!);
    await using page = await open();
    page.press(m.workbench_restore_accept());
    expect(page.host.textContent).toContain(m.workbench_annotation_insert());
    const note = EditorView.findFromDOM(
      page.host.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const body = note.state.doc.toString();
    act(() => note.dispatch({ selection: { anchor: 0, head: body.length } }));

    page.press(m.workbench_annotation_insert());
    expect(note.state.doc.toString().startsWith(body)).toBe(true);

    expect(
      document.querySelector('[data-slot="toast-viewport"]')?.textContent,
    ).toContain(m.workbench_annotation_section_added());
    expect(page.host.textContent).toContain(m.workbench_tab_annotation());
    expect(page.host.textContent).not.toContain(
      m.workbench_annotation_insert(),
    );
    // The repaired document renders again, loop and section in place.
    await page.waitFor(() =>
      expect(rendered().at(-1)).toContain("{% render_annotation annotation %}"),
    );
    const source = rendered().at(-1)!;
    expect(source).toContain(
      "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n",
    );
    expect(source.endsWith("\n--- zotlit:annotation ---\n")).toBe(true);
  });
});
