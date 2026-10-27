import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { batchImportToast } from "@/services/note-import/batch-import-notices";

import { batchUpdateToast, importNotices, updateAllToast } from "./notices";

describe("batchUpdateToast", () => {
  it.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.notice_protocol_item_not_found()],
    ["not-found", m.notice_protocol_item_not_found()],
    ["single-update", undefined],
    ["batch-modal", undefined],
  ] as const)("tells a link's %s update: %s", (outcome, message) => {
    expect(batchUpdateToast.success({ outcome })).toBe(message);
  });

  it("shows nothing for an update that failed", () => {
    expect(batchUpdateToast.error()).toBeUndefined();
  });
});

describe("updateAllToast", () => {
  it.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.batch_update_all_empty()],
    ["no-library-in-scope", m.batch_all_no_library_in_scope()],
    ["unavailable-target", m.batch_all_library_unavailable()],
    ["collection-not-found", m.notice_collection_not_found()],
    ["batch-modal", undefined],
  ] as const)(
    "tells an update-all link's %s update: %s",
    (outcome, message) => {
      expect(updateAllToast.success({ outcome })).toBe(message);
    },
  );

  it("shows nothing for an update that failed", () => {
    expect(updateAllToast.error(new Error("classify failed"))).toBeUndefined();
  });
});

describe("importNotices", () => {
  it("shows the import failure a link run ended with", () => {
    expect(
      importNotices(batchImportToast()).error(new Error("index failed")),
    ).toBe(m.batch_import_failed());
  });
});
