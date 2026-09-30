// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import { EntryActions, ImportFallback } from "./entry-actions";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE = "---\nid: Reading12345\nname: Reading note\n---\n# A paper\n";

const profileEntry = {
  kind: "profile",
  copyText: PROFILE,
  file: { name: "zotlit-profile.reading-note.md", text: PROFILE },
} as const;

/** Renders the actions; `button` finds one by its text. */
async function renderActions(
  entry: Parameters<typeof EntryActions>[0]["entry"],
) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<EntryActions entry={entry} />));
  return {
    host,
    button: (label: string) =>
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      ),
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Records every link the page opens instead of following it. */
function recordOpenedLinks() {
  const opened: string[] = [];
  const spy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(this.href);
    });
  return Object.assign(opened, { [Symbol.dispose]: () => spy.mockRestore() });
}

/** Records the title of every toast the page shows. */
function recordToasts() {
  const spy = vi.spyOn(toast, "add").mockImplementation(() => "");
  return {
    titles: () => spy.mock.calls.map(([options]) => options.title),
    [Symbol.dispose]: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one-click import", () => {
  it("copies the whole Profile document, then opens ZotLit's import from the clipboard in Obsidian", async () => {
    const clipboard = Promise.withResolvers<void>();
    const writeText = vi.fn(() => clipboard.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    using opened = recordOpenedLinks();
    using toasts = recordToasts();
    using page = await renderActions(profileEntry);

    await act(async () => page.button(m.docs_directory_import())!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROFILE);
    expect([...opened]).toEqual([]);

    await act(async () => clipboard.resolve());
    expect([...opened]).toEqual([
      "obsidian://zotlit/import-profile?clipboard=true",
    ]);
    expect(toasts.titles()).toEqual([m.docs_directory_import_started()]);
  });

  it("keeps Obsidian closed when the browser refuses the copy, and says how to allow it", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Denied")) },
    });
    using opened = recordOpenedLinks();
    using toasts = recordToasts();
    using page = await renderActions(profileEntry);

    await act(async () => page.button(m.docs_directory_import())!.click());

    expect([...opened]).toEqual([]);
    expect(toasts.titles()).toEqual([m.docs_directory_add_failed()]);
  });

  it("shows one button for a Profile, named Add to ZotLit", async () => {
    using page = await renderActions(profileEntry);

    expect(
      [...page.host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Add to ZotLit"]);
  });

  it("names the manual path when the window does not open: copy, then Import profile… from the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    using toasts = recordToasts();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(<ImportFallback copyText={PROFILE} />));

    const text = host.textContent ?? "";
    expect(text).toContain(m.docs_directory_copy_it());
    expect(text).toContain(m.command_import_profile_name());
    expect(text).toContain(m.profile_import_clipboard());
    await act(async () => host.querySelector("button")!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROFILE);
    expect(toasts.titles()).toEqual([m.docs_directory_copied()]);
    act(() => root.unmount());
    host.remove();
  });

  it("leaves a recipe to its copy and download, since a recipe goes into a field of a profile", async () => {
    using page = await renderActions({
      kind: "property",
      copyText: '{"$eval": "zt.title"}',
      file: { name: "zotlit-property.title.yaml", text: "key: title\n" },
    });

    expect(page.button(m.docs_directory_import())).toBeUndefined();
    expect(page.host.querySelector("p")).toBeNull();
  });
});
