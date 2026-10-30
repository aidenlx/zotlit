import { Effect, Fiber } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import { TabBar } from "@zotlit/workbench/ui";
import type { WorkbenchHost } from "@zotlit/workbench/ui";

// @vitest-environment happy-dom
import { m } from "@/paraglide/messages.js";

import { useWebHost } from "./host";
import { PageRuntime } from "./runtime";

let host!: WorkbenchHost;
const notices: string[] = [];

interface PageProps {
  insertTarget?: WorkbenchHost["insertTarget"];
  snapshot?: (typeof SAMPLE_ITEMS)[number];
}

function Page(props: PageProps) {
  return (
    <PageRuntime>
      <BoundPage {...props} />
    </PageRuntime>
  );
}

function BoundPage({
  insertTarget = () => ({ slice: "note", range: { from: 3, to: 3 } }),
  snapshot = SAMPLE_ITEMS[0]!,
}: PageProps) {
  const bound = useWebHost({
    snapshot,
    notice: (text) => void notices.push(text),
    insertTarget,
  });
  host = bound.host;
  return (
    <>
      <button type="button" id="anchor">
        anchor
      </button>
      {bound.overlays}
    </>
  );
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Page />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  notices.length = 0;
  vi.unstubAllGlobals();
});

function texts(selector: string): string[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].map(
    (element) => element.textContent,
  );
}

describe("the web host", () => {
  it("opens a Base UI menu at the anchor and runs the chosen item", async () => {
    const chosen: string[] = [];
    act(() =>
      host.menu({
        anchor: document.getElementById("anchor")!,
        items: [
          { label: "Duplicate", onSelect: () => chosen.push("duplicate") },
          {
            label: "Delete",
            disabled: true,
            onSelect: () => chosen.push("delete"),
          },
        ],
      }),
    );
    expect(texts('[role="menuitem"]')).toEqual(["Duplicate", "Delete"]);
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
    act(() => item.click());
    expect(chosen).toEqual(["duplicate"]);
  });

  it("supplies site messages to shared controls inside a standalone dialog", async () => {
    await act(async () => {
      host.dialog({ title: "Profile panes", content: <TabBar /> });
    });
    expect(texts('[role="dialog"] [role="tab"]')).toContain(
      m.workbench_tab_match(),
    );
  });

  it("asks a confirmation in a dialog and answers with the reader's choice", async () => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = Effect.runPromise(
        host.confirm({
          title: "Change the format?",
          body: "The old value stays one undo away.",
          confirm: "Change",
        }),
      );
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Change the format?");
    expect(dialog.textContent).toContain("The old value stays one undo away.");
    expect(texts('[role="dialog"] button')).toEqual([
      "Change",
      m.workbench_cancel(),
    ]);
    act(() =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Change")!
        .click(),
    );
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("takes a confirmation away when the Workbench interrupts it", async () => {
    let fiber!: Fiber.Fiber<boolean>;
    act(() => {
      fiber = host.run(
        host.confirm({ title: "Replace?", body: "", confirm: "Replace" }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => await Effect.runPromise(Fiber.interrupt(fiber)));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps empty groups and returns keyboard focus to the originating chooser", async () => {
    const anchor = document.getElementById("anchor")!;
    anchor.focus();
    let answer!: Promise<string | null>;
    act(() => {
      answer = Effect.runPromise(
        host.suggester({
          anchor,
          title: "Choose an annotation",
          selected: "a",
          groups: [
            {
              label: "Current Item",
              options: [],
              empty: "This Item has no annotations.",
            },
            {
              label: "Examples",
              options: [{ id: "a", label: "Example annotation" }],
            },
          ],
        }),
      );
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This Item has no annotations.",
    );
    expect(
      document.querySelector('[role="option"]')?.getAttribute("aria-label"),
    ).toBe(m.workbench_sample_selected({ name: "Example annotation" }));
    await act(async () => {
      document.querySelector<HTMLElement>('[role="option"]')!.click();
    });
    await expect(answer).resolves.toBe("a");
    await vi.waitFor(() => expect(document.activeElement).toBe(anchor));
  });

  it("keeps the existing host bound to the latest insertion selection", () => {
    const existing = host;
    act(() =>
      root.render(
        <Page
          insertTarget={() => ({
            slice: "annotation",
            range: { from: 17, to: 24 },
          })}
        />,
      ),
    );
    expect(host).toBe(existing);
    expect(existing.insertTarget()).toEqual({
      slice: "annotation",
      range: { from: 17, to: 24 },
    });
    act(() => root.render(<Page insertTarget={() => null} />));
    expect(existing.insertTarget()).toBeNull();
  });

  it("names the sample's custom fields, which custom[...] reads", async () => {
    const sample = SAMPLE_ITEMS[0]!;
    act(() =>
      root.render(
        <Page
          snapshot={{
            ...sample,
            seed: sample.seed && {
              ...sample.seed,
              customFieldNames: ["Shelf"],
            },
          }}
        />,
      ),
    );
    await expect(
      Effect.runPromise(host.matchData.customFields),
    ).resolves.toEqual(["Shelf"]);
  });

  it("binds what needs no popup: tooltip, notice, names, storage", async () => {
    expect(host.tooltip("Undo")).toEqual({ title: "Undo" });
    host.notice("Saved");
    expect(notices).toEqual(["Saved"]);
    await expect(
      Effect.runPromise(host.matchData.collections),
    ).resolves.toEqual([["Shared key"]]);
    await expect(Effect.runPromise(host.matchData.libraries)).resolves.toEqual([
      { id: "personal" },
    ]);
    host.persistence.write("vault", "explorer", "all");
    expect(host.persistence.read("vault", "explorer")).toBe("all");
    expect(host.persistence.read("device", "explorer")).toBeNull();
    host.persistence.write("vault", "explorer", null);
    expect(host.persistence.read("vault", "explorer")).toBeNull();
  });
});
