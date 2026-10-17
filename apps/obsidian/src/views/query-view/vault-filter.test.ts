import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { VaultValue } from "./table-notes";
import { planVaultFilter } from "./vault-filter";

/** The Literature Notes by Indexed Key, each with its frontmatter. */
function notes(byKey: Record<string, Record<string, unknown>>) {
  return {
    itemKeys: () => Object.keys(byKey),
    read: (itemKey: string, name: string): VaultValue =>
      Object.hasOwn(byKey, itemKey)
        ? { note: true, value: byKey[itemKey]![name] ?? null }
        : { note: false },
  };
}

const LIBRARY = notes({
  ITEMAAAA: { status: "read", rating: 5, tags: ["x"] },
  ITEMBBBB: { status: "reading", rating: 2 },
  ITEMCCCC: { status: null },
  ITEMDDDD: {},
});

const at = (text: string) => ({ section: "view" as const, path: [0], text });

describe("planVaultFilter", () => {
  it("keeps only the Items whose note passes, where the condition fails for no value", () => {
    expect(
      planVaultFilter({
        conditions: [at('vault["status"] == "read"'), at("vault.rating > 1")],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({ condition: '["ITEMAAAA"].contains(indexedKey)' });
  });

  it("keeps no Item where no note passes", () => {
    expect(
      planVaultFilter({
        conditions: [at('vault.status == "unknown"')],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({ condition: "[].contains(indexedKey)" });
  });

  it("leaves out the Items whose note fails, where the condition holds for no value, so Items without a note stay", () => {
    expect(
      planVaultFilter({
        conditions: [at('vault["status"] != "read"')],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({ condition: '!["ITEMAAAA"].contains(indexedKey)' });
    expect(
      planVaultFilter({
        conditions: [at("vault.status == null")],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({
      condition: '!["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)',
    });
  });

  it("adds no condition where every note passes a condition that holds for no value", () => {
    expect(
      planVaultFilter({
        conditions: [at('vault.missing != "x"')],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({
      condition: null,
    });
    expect(
      planVaultFilter({ conditions: [], stranded: [], notes: LIBRARY }),
    ).toEqual({ condition: null });
  });

  it("reads lists and methods on the value as ZotLit Query does", () => {
    expect(
      planVaultFilter({
        conditions: [at('vault.tags.contains("x")')],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({ condition: '["ITEMAAAA"].contains(indexedKey)' });
    expect(
      planVaultFilter({
        conditions: [at("vault.status.isEmpty()")],
        stranded: [],
        notes: LIBRARY,
      }),
    ).toEqual({ condition: '!["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)' });
  });

  it("marks a vault condition inside an or or not group, and plans nothing", () => {
    const nested = {
      section: "all" as const,
      path: [1, 0],
      text: "vault.x == 1",
    };
    expect(
      planVaultFilter({
        conditions: [at('vault.status == "read"')],
        stranded: [nested],
        notes: LIBRARY,
      }),
    ).toEqual({
      fault: {
        at: { section: "all", path: [1, 0] },
        diagnostic: {
          code: "vault-filter-nested",
          message: m.query_view_vault_filter_nested(),
          hint: m.query_view_vault_filter_nested_hint(),
        },
      },
    });
  });

  it.each([
    'vault.status == "read" && title != null',
    "vault.status == this.item.title",
    'vault[name] == "read"',
    "vault == null",
  ])("marks %s, which cannot be split from the Zotero part", (text) => {
    expect(
      planVaultFilter({ conditions: [at(text)], stranded: [], notes: LIBRARY }),
    ).toEqual({
      fault: {
        at: { section: "view", path: [0] },
        diagnostic: {
          code: "vault-filter-mixed",
          message: m.query_view_vault_filter_mixed(),
          hint: m.query_view_vault_filter_mixed_hint(),
        },
      },
    });
  });

  it("marks a vault condition ZotLit Query cannot plan with its message", () => {
    const planned = planVaultFilter({
      conditions: [at("vault.status.nope()")],
      stranded: [],
      notes: LIBRARY,
    });
    expect(planned).toMatchObject({
      fault: { at: { section: "view", path: [0] } },
    });
    expect("fault" in planned && planned.fault.diagnostic.message).toBeTruthy();
  });
});
