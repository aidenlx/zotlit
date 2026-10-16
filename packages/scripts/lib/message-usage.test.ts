import { describe, expect, it } from "vitest";

import {
  compareWithBaseline,
  messageKeys,
  unusedMessageKeys,
} from "./message-usage.ts";

const keys = messageKeys({
  $schema: "https://inlang.com/schema/inlang-message-format",
  query_view_filter: "Filter",
  query_view_filter_error: "The filter has an error.",
  workbench_problems_count: [{ match: {}, declarations: [] }],
  zotero: { menu_item_open: { label: "Open" }, prefs_pane_label: "ZotLit" },
});

describe("unusedMessageKeys", () => {
  it("reads a key by its whole name, also after `m.`", () => {
    expect(
      unusedMessageKeys(keys, [
        "m.query_view_filter_error(); m.workbench_problems_count({ count })",
        'm["zotero.prefs_pane_label"]()',
      ]),
    ).toEqual(["query_view_filter", "zotero.menu_item_open"]);
  });

  it("reads Companion copy by its Fluent ID", () => {
    expect(
      unusedMessageKeys(keys, [
        '<menuitem data-l10n-id="zotlit-menu-item-open" />',
      ]),
    ).toContain("query_view_filter");
    expect(
      unusedMessageKeys(keys, [
        'document.l10n.setAttributes(el, "zotlit-menu-item-open")',
      ]),
    ).not.toContain("zotero.menu_item_open");
  });
});

describe("compareWithBaseline", () => {
  it("names new, read-again, and removed keys", () => {
    expect(
      compareWithBaseline(
        ["query_view_filter"],
        ["query_view_filter_error", "settings_retired"],
        keys,
      ),
    ).toEqual({
      added: ["query_view_filter"],
      used: ["query_view_filter_error"],
      gone: ["settings_retired"],
    });
  });
});
