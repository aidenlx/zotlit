import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { DataExplorer as ControlledDataExplorer } from "./data-explorer";
import type { DataExplorerProps } from "./data-explorer";

import { initialTreeState } from "#/explorer/index";

function DataExplorer(
  props: Omit<
    DataExplorerProps,
    | "collapsedSections"
    | "onCollapsedSectionsChange"
    | "navigation"
    | "onNavigationChange"
  >,
) {
  const [store] = useState(() =>
    createStore(() => ({
      collapsedSections: new Set<string>() as ReadonlySet<string>,
      navigation: initialTreeState(),
    })),
  );
  const { collapsedSections, navigation } = useStore(store);
  return (
    <ControlledDataExplorer
      {...props}
      collapsedSections={collapsedSections}
      navigation={navigation}
      onCollapsedSectionsChange={(collapsedSections) =>
        store.setState({ collapsedSections })
      }
      onNavigationChange={(navigation) => store.setState({ navigation })}
    />
  );
}
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

afterEach(cleanup);

describe("shared Data Explorer", () => {
  it("shows common fields first, then the rest under their sections, and keeps a closed section in its owner", () => {
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ extra: "Other", title: "A paper" }}
        copy={async () => {}}
      />,
    );
    const { ui } = mounted;
    render(ui);
    expect(
      screen
        .getAllByRole("treeitem")[0]
        ?.textContent?.startsWith(m.workbench_field_title()),
    ).toBe(true);
    expect(
      screen.getAllByRole("treeitem")[0]?.textContent?.endsWith("A paper"),
    ).toBe(true);
    expect(screen.getByText("Extra")).toBeTruthy();
    const identifiers = screen.getByRole("button", {
      name: `${m.workbench_explorer_section_identifiers()} (1)`,
    });
    expect(identifiers.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(identifiers);
    expect(screen.queryByText("Extra")).toBeNull();
    expect(identifiers.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(m.workbench_field_title())).toBeTruthy();
  });
  it("names a list by its count and an object by its preview", () => {
    const { ui } = mount(
      <DataExplorer
        root="note"
        data={{
          authors: ["Ada", "Grace"],
          collections: [],
          date: { year: 2011, toString: () => "2011-01" },
        }}
        copy={async () => {}}
      />,
    );
    render(ui);
    const rows = screen.getAllByRole("treeitem");
    expect(rows[0]?.textContent).toBe("Authors (2)");
    expect(
      screen.getByText("Collections").closest('[role="treeitem"]')?.textContent,
    ).toBe("Collections (0)");
    expect(screen.getByText("2011-01")).toBeTruthy();
    expect(screen.queryByText("[2]")).toBeNull();
    expect(screen.queryByText("{1}")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: m.workbench_explorer_toggle_node(),
      })[0]!,
    );
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Grace")).toBeTruthy();
  });

  it("copies values from the row menu without an editor insertion target", () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    using mounted = mount(
      <DataExplorer root="note" data={{ title: "A paper" }} copy={copy} />,
    );
    const { ui, host } = mounted;
    render(ui);
    expect(
      screen.queryByRole("button", { name: m.workbench_fields_put_in_note() }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_explorer_row_actions() }),
    );
    host.calls.menus[0]!.items.find(
      (item) => item.label === m.workbench_explorer_menu_copy_value(),
    )!.onSelect();
    expect(copy).toHaveBeenCalledWith("A paper");
  });
  it("opens the row menu from a right click", () => {
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        copy={async () => {}}
      />,
    );
    const { ui, host } = mounted;
    render(ui);
    fireEvent.contextMenu(screen.getByText("A paper"));
    expect(host.calls.menus).toHaveLength(1);
  });
  it("inserts the field in the selected template engine", () => {
    const insert = vi.fn<(snippet: string) => void>();
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        engine="eta"
        copy={async () => {}}
        onInsert={insert}
      />,
    );
    const { ui } = mounted;
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_fields_put_in_note() }),
    );
    expect(insert).toHaveBeenCalledWith("<%= zt.title %>");
  });
  it("expands nested values and opens the live engine menu", () => {
    let eta = false;
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ metadata: { title: "Nested paper" } }}
        copy={async () => {}}
        engines={() => (eta ? ["liquid", "eta"] : ["liquid"])}
      />,
    );
    const { ui, host } = mounted;
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_explorer_toggle_node() }),
    );
    expect(screen.getByText("Nested paper")).toBeTruthy();
    eta = true;
    fireEvent.click(
      screen.getAllByRole("button", {
        name: m.workbench_explorer_row_actions(),
      })[1]!,
    );
    expect(
      host.calls.menus[0]?.submenus?.some((item) => item.label === "Eta"),
    ).toBe(true);
  });
  it.each([
    ["its label", "Citation key"],
    ["its raw key", "citationKey"],
  ])(
    "finds a field by %s and holds every matching section open",
    (_, query) => {
      using mounted = mount(
        <DataExplorer
          root="note"
          data={{ citationKey: "smith2026", title: "A paper", DOI: "10.1/x" }}
          copy={async () => {}}
        />,
      );
      const { ui } = mounted;
      render(ui);
      fireEvent.click(
        screen.getByRole("button", {
          name: `${m.workbench_explorer_section_common()} (2)`,
        }),
      );
      expect(screen.queryByText("smith2026")).toBeNull();
      const input = screen.getByRole("searchbox");
      fireEvent.input(input, { target: { value: query } });
      fireEvent.change(input, { target: { value: query } });
      expect(screen.getByText("smith2026")).toBeTruthy();
      expect(screen.queryByText("A paper")).toBeNull();
      expect(screen.queryByText("10.1/x")).toBeNull();
      expect(
        screen
          .getByRole("button", {
            name: `${m.workbench_explorer_section_common()} (1)`,
          })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    },
  );

  it("finds a field by its name alone and highlights it like a key match", () => {
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ creators: [{ family: "Ada" }], title: "A paper" }}
        copy={async () => {}}
      />,
    );
    const { ui } = mounted;
    render(ui);
    const input = screen.getByRole("searchbox");
    fireEvent.input(input, { target: { value: "all creators" } });
    fireEvent.change(input, { target: { value: "all creators" } });
    const row = screen.getByRole("treeitem");
    expect(row.textContent?.startsWith(m.workbench_field_creators())).toBe(
      true,
    );
    expect(
      row.querySelector('[data-part="row"]')?.getAttribute("data-state"),
    ).toBe("matched");
    expect(screen.queryByText("A paper")).toBeNull();
  });

  it("offers the exact copy path and annotation navigation through the host", () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const anchor = vi.fn<(node: unknown) => void>();
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ annotations: [{ text: "Read this" }] }}
        copy={copy}
        canExploreAnnotation={(node) => node.path.length === 2}
        onExploreAnnotation={anchor}
      />,
    );
    const { ui, host } = mounted;
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_explorer_toggle_node() }),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: m.workbench_explorer_row_actions(),
      })[1]!,
    );
    const items = host.calls.menus[0]!.items;
    items
      .find((item) => item.label === m.workbench_explorer_menu_copy_path())!
      .onSelect();
    expect(copy).toHaveBeenCalledWith("zt.annotations[0]");
    items
      .find(
        (item) => item.label === m.workbench_explorer_menu_explore_annotation(),
      )!
      .onSelect();
    expect(anchor).toHaveBeenCalledWith(
      expect.objectContaining({ path: ["annotations", 0] }),
    );
  });

  it.each([
    ["expression", "zt.title"],
    ["json-e", '{"$eval":"zt.title"}'],
  ] as const)("inserts %s property syntax", (mode, expected) => {
    const insert = vi.fn<(snippet: string) => void>();
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        mode={mode}
        copy={async () => {}}
        onInsert={insert}
      />,
    );
    const { ui } = mounted;
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_fields_put_in_note() }),
    );
    expect(insert).toHaveBeenCalledWith(expected);
  });

  it("shows a copy error without leaving an unhandled rejection", async () => {
    using mounted = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        copy={() => Promise.reject(new Error("Clipboard denied"))}
      />,
    );
    const { ui, host } = mounted;
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_explorer_row_actions() }),
    );
    await act(async () => {
      host.calls.menus[0]!.items.find(
        (item) => item.label === m.workbench_explorer_menu_copy_value(),
      )!.onSelect();
    });
    expect(host.calls.notices).toEqual([m.workbench_field_copy_failed()]);
  });
});

it("keeps two Explorer owners independent through display and filter changes", () => {
  using mounted = mount(
    <>
      <section aria-label="First explorer">
        <DataExplorer
          root="note"
          data={{ authors: ["Ada"], title: "First paper" }}
          copy={async () => {}}
        />
      </section>
      <section aria-label="Second explorer">
        <DataExplorer
          root="note"
          data={{ authors: ["Grace"], title: "Second paper" }}
          copy={async () => {}}
        />
      </section>
    </>,
  );
  render(mounted.ui);
  const left = within(screen.getByRole("region", { name: "First explorer" }));
  const right = within(screen.getByRole("region", { name: "Second explorer" }));
  fireEvent.click(
    left.getByRole("button", { name: m.workbench_explorer_toggle_node() }),
  );
  expect(left.getByText("Ada")).toBeTruthy();
  expect(right.queryByText("Grace")).toBeNull();
  const common = `${m.workbench_explorer_section_common()} (2)`;
  fireEvent.click(left.getByRole("button", { name: common }));
  expect(left.queryByText(m.workbench_field_title())).toBeNull();
  expect(right.getByText(m.workbench_field_title())).toBeTruthy();
  fireEvent.click(left.getByRole("button", { name: common }));
  const filter = left.getByRole("searchbox");
  fireEvent.input(filter, { target: { value: "title" } });
  fireEvent.change(filter, { target: { value: "title" } });
  expect(left.queryByText("Ada")).toBeNull();
  expect(right.getByText("Second paper")).toBeTruthy();
  fireEvent.input(filter, { target: { value: "" } });
  fireEvent.change(filter, { target: { value: "" } });
  expect(left.getByText("Ada")).toBeTruthy();
});
