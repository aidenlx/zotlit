import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";

import { readerPageItems } from "./reader";

describe("reader settings", () => {
  it("opens annotation links in the ZotLit reader by default", () => {
    expect(defaults["reader.open-annotation-links"]).toBe(true);
  });

  it("offers the annotation link opening choice on the Reader page", () => {
    expect(readerPageItems()).toContainEqual({
      id: "settings_reader_open_annotation_links",
      name: m.settings_reader_open_annotation_links_name(),
      desc: m.settings_reader_open_annotation_links_desc(),
      control: {
        type: "toggle",
        key: "reader.open-annotation-links",
      },
    });
  });
});
