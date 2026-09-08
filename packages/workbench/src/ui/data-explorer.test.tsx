import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataExplorer } from "./data-explorer";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

afterEach(cleanup);

describe("shared Data Explorer", () => {
  it("shows common labels first, switches to raw keys, and persists the choice", () => {
    const { ui, host, store } = mount(
      <DataExplorer
        root="note"
        data={{ extra: "Other", title: "A paper" }}
        copy={async () => {}}
      />,
    );
    render(ui);
    expect(
      screen.getAllByRole("treeitem")[0]?.textContent?.startsWith("A paper"),
    ).toBe(true);
    expect(screen.getAllByRole("treeitem")[0]?.textContent).toContain(
      m.workbench_field_title(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_explorer_all() }),
    );
    expect(store.getState().explorer).toBe("all");
    expect(host.preferences.get("vault:explorer-variant")).toBe("all");
    expect(screen.getByText("title")).toBeTruthy();
  });
  it("copies values without an editor insertion target", () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const { ui } = mount(
      <DataExplorer root="note" data={{ title: "A paper" }} copy={copy} />,
    );
    render(ui);
    expect(
      screen.queryByRole("button", { name: m.workbench_fields_put_in_note() }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: m.workbench_explorer_menu_copy_value(),
      }),
    );
    expect(copy).toHaveBeenCalledWith("A paper");
  });
  it("inserts the field in the selected template engine", () => {
    const insert = vi.fn<(snippet: string) => void>();
    const { ui } = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        engine="eta"
        copy={async () => {}}
        onInsert={insert}
      />,
    );
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_fields_put_in_note() }),
    );
    expect(insert).toHaveBeenCalledWith("<%= zt.title %>");
  });
  it("expands nested values and opens the live engine menu", () => {
    let eta = false;
    const { ui, host } = mount(
      <DataExplorer
        root="note"
        data={{ metadata: { title: "Nested paper" } }}
        copy={async () => {}}
        engines={() => (eta ? ["liquid", "eta"] : ["liquid"])}
      />,
    );
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
  it("finds a field by its Simple label", () => {
    const { ui } = mount(
      <DataExplorer
        root="note"
        data={{ citationKey: "smith2026", title: "A paper" }}
        copy={async () => {}}
      />,
    );
    render(ui);
    const input = screen.getByRole("searchbox");
    fireEvent.input(input, { target: { value: "Citation key" } });
    fireEvent.change(input, { target: { value: "Citation key" } });
    expect(screen.getByText("smith2026")).toBeTruthy();
    expect(screen.queryByText("A paper")).toBeNull();
  });

  it("offers the exact copy path and annotation navigation through the host", () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const anchor = vi.fn<(node: unknown) => void>();
    const { ui, host } = mount(
      <DataExplorer
        root="note"
        data={{ annotations: [{ text: "Read this" }] }}
        copy={copy}
        canExploreAnnotation={(node) => node.path.length === 2}
        onExploreAnnotation={anchor}
      />,
    );
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
    const { ui } = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        mode={mode}
        copy={async () => {}}
        onInsert={insert}
      />,
    );
    render(ui);
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_fields_put_in_note() }),
    );
    expect(insert).toHaveBeenCalledWith(expected);
  });

  it("shows a copy error without leaving an unhandled rejection", async () => {
    const { ui, host } = mount(
      <DataExplorer
        root="note"
        data={{ title: "A paper" }}
        copy={() => Promise.reject(new Error("Clipboard denied"))}
      />,
    );
    render(ui);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: m.workbench_explorer_menu_copy_value(),
        }),
      );
    });
    expect(host.calls.notices).toEqual([m.workbench_field_copy_failed()]);
  });
});
