// @vitest-environment happy-dom
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import { EntrySource } from "./entry-source";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: Record<string, string>;
    children: React.ReactNode;
  }) => (
    <a
      href={to.replace("$kind", params.kind!).replace("$slug", params.slug!)}
      {...props}
    >
      {children}
    </a>
  ),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FILE = "---\nname: Books\n---\n{% managed %}\n# {{ zt.title }}\n";
const NOTE = "{% managed %}\n# {{ zt.title }}\n";

type Props = ComponentProps<typeof EntrySource>;

const profile: Props["entry"] = {
  kind: "profile",
  copyText: FILE,
  file: { name: "zotlit-profile.books.md", text: FILE },
  details: { kind: "profile" },
  profileSource: {
    note: NOTE,
    partials: [
      { name: "links-row", id: "partials/links-row" },
      { name: "local-only", id: null },
    ],
  },
  notes: [
    {
      id: "book-full-details",
      itemType: "book",
      variant: "full-details",
      noteName: "Kahneman 2011",
      properties: null,
      frontmatter: "title: Thinking\n",
      body: "# Thinking\n",
    },
    {
      id: "book-few-details",
      itemType: "book",
      variant: "few-details",
      noteName: null,
      properties: null,
      frontmatter: null,
      body: "# Untitled\n",
    },
  ],
};

const partials: Props["partials"] = [
  {
    id: "partials/links-row",
    title: "Links row",
    summary: "One row of links.",
  },
];

async function render(props: Props) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<EntrySource {...props} />));
  const byText = (selector: string, text: string) =>
    [...host.querySelectorAll<HTMLElement>(selector)].find(
      (node) => node.textContent === text,
    );
  return {
    host,
    tab: (name: string) => byText('[role="tab"]', name),
    button: (name: string) => byText("button", name),
    panel: () =>
      host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])'),
    rerender: (next: Props) =>
      act(async () => root.render(<EntrySource {...next} />)),
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function recordToasts() {
  const spy = vi.spyOn(toast, "add").mockImplementation(() => "");
  return {
    titles: () => spy.mock.calls.map(([options]) => options.title),
    [Symbol.dispose]: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a Profile's Source section", () => {
  const props: Props = {
    entry: profile,
    partials,
    example: "book-full-details",
  };

  it("names its fold, then offers the file, each packed partial, and the example note as tabs", async () => {
    using page = await render(props);

    expect(page.host.querySelector("summary")?.textContent).toBe(
      m.docs_directory_source_heading(),
    );
    expect(
      [...page.host.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual([
      "zotlit-profile.books.md",
      "links-row",
      "local-only",
      m.docs_directory_source_example_tab(),
    ]);
  });

  it("shows the note part first, and the whole file when the reader asks for it", async () => {
    using page = await render(props);
    const code = () => page.panel()?.querySelector("pre")?.textContent;

    expect(code()).toBe(NOTE);
    await act(async () =>
      page.button(m.docs_directory_source_whole_file())!.click(),
    );
    expect(code()).toBe(FILE);
    await act(async () =>
      page.button(m.docs_directory_source_note_part())!.click(),
    );
    expect(code()).toBe(NOTE);
  });

  it("links a partial's tab to its entry page, and says when a packed partial has none", async () => {
    using page = await render(props);

    await act(async () => page.tab("links-row")!.click());
    const link = page.panel()!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/templates/partials/links-row");
    expect(link.textContent).toBe(
      m.docs_directory_source_partial_open({ title: "Links row" }),
    );
    expect(page.panel()!.textContent).toContain("One row of links.");

    await act(async () => page.tab("local-only")!.click());
    expect(page.panel()!.querySelector("a")).toBeNull();
    expect(page.panel()!.textContent).toContain(
      m.docs_directory_source_partial_packed(),
    );
  });

  it("holds the raw Markdown of the current example note, and follows the switcher", async () => {
    using page = await render(props);

    await act(async () =>
      page.tab(m.docs_directory_source_example_tab())!.click(),
    );
    expect(page.panel()!.querySelector("pre")?.textContent).toBe(
      "---\ntitle: Thinking\n---\n# Thinking\n",
    );

    await page.rerender({ ...props, example: "book-few-details" });
    expect(page.panel()!.querySelector("pre")?.textContent).toBe(
      "# Untitled\n",
    );
  });

  it("copies and downloads the whole file, whichever part is showing", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        opened.push(this.download);
      },
    );
    URL.createObjectURL = () => "blob:file";
    URL.revokeObjectURL = () => {};
    using toasts = recordToasts();
    using page = await render(props);

    await act(async () => page.button(m.docs_directory_copy_file())!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FILE);
    await act(async () => page.button(m.docs_directory_download())!.click());
    expect(opened).toEqual(["zotlit-profile.books.md"]);
    expect(toasts.titles()).toEqual([
      m.docs_directory_copied(),
      m.docs_directory_downloaded({ file: "zotlit-profile.books.md" }),
    ]);
  });
});

describe("a part entry's Source section", () => {
  const partial: Props["entry"] = {
    kind: "partial",
    copyText: "{{ zt.title }}\n",
    file: {
      name: "zotlit-partial.title.md",
      text: "---\nlanguage: liquid\n---\n{{ zt.title }}\n",
    },
    profileSource: null,
    notes: [],
    details: {
      kind: "partial",
      context: "note",
      call: '{% render "title" with zt as zt -%}',
    },
  };
  const props: Props = { entry: partial, partials: [], example: undefined };

  it("holds the call a look writes to use a partial, after the file", async () => {
    using page = await render(props);

    expect(
      [...page.host.querySelectorAll("pre")].map((pre) => pre.textContent),
    ).toEqual([
      "---\nlanguage: liquid\n---\n{{ zt.title }}\n",
      '{% render "title" with zt as zt -%}',
    ]);
    expect(page.host.textContent).toContain(m.docs_directory_source_call());
  });

  it("offers the download of the file, which the header no longer holds", async () => {
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        opened.push(this.download);
      },
    );
    URL.createObjectURL = () => "blob:file";
    URL.revokeObjectURL = () => {};
    using toasts = recordToasts();
    using page = await render(props);

    await act(async () => page.button(m.docs_directory_download())!.click());

    expect(opened).toEqual(["zotlit-partial.title.md"]);
    expect(toasts.titles()).toEqual([
      m.docs_directory_downloaded({ file: "zotlit-partial.title.md" }),
    ]);
  });

  it("leaves the call to a partial: a property folds its file alone", async () => {
    using page = await render({
      ...props,
      entry: {
        ...partial,
        kind: "property",
        details: { kind: "property", key: "year", merge: "replace" },
      },
    });

    expect(page.host.querySelectorAll("pre")).toHaveLength(1);
  });

  it("folds its own file, with no tabs", async () => {
    using page = await render(props);

    expect(page.host.querySelector("summary")?.textContent).toBe(
      m.docs_directory_source_heading(),
    );
    expect(page.host.querySelector('[role="tab"]')).toBeNull();
    expect(page.host.querySelector("pre")?.textContent).toBe(
      "---\nlanguage: liquid\n---\n{{ zt.title }}\n",
    );
    expect(page.host.textContent).toContain("zotlit-partial.title.md");
  });
});
