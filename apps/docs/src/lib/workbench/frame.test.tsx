// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { WorkbenchSkeleton } from "./frame";

describe("WorkbenchSkeleton", () => {
  it("paints the page chrome inert before the editor bundle arrives", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<WorkbenchSkeleton />));

    const shell = host.firstElementChild!;
    expect(shell.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("h1")?.textContent).toBe(m.workbench_loading());
    expect(
      [...host.querySelectorAll('[role="status"]')].map(
        (status) => status.textContent,
      ),
    ).toContain(m.workbench_loading());

    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      m.workbench_tab_note(),
      m.workbench_tab_properties(),
      m.workbench_tab_annotation(),
      m.workbench_tab_name_and_folder(),
    ]);
    for (const tab of tabs)
      expect(tab.getAttribute("aria-disabled")).toBe("true");

    const buttons = [
      ...host.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])'),
    ];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.disabled).toBe(true);
    expect(host.querySelector("select")?.disabled).toBe(true);

    expect(
      host.querySelector(
        `section[aria-label="${m.workbench_connection_heading()}"]`,
      ),
    ).not.toBeNull();
    expect(host.querySelector("#workbench-edit-pane")).not.toBeNull();
    expect(host.querySelector("#workbench-result-pane")).not.toBeNull();
    expect(host.querySelector(".cm-editor")).toBeNull();

    act(() => root.unmount());
    host.remove();
  });
});
