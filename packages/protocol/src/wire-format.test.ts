import type * as v from "valibot";
import { describe, expect, it } from "vitest";

import { notifyEventSchema } from "./notify";
import { protocolActions, protocolQuerySchema } from "./url";
import { PROTOCOL_VERSION } from "./version";

type ObjectSchema = v.ObjectSchema<
  v.ObjectEntries,
  v.ErrorMessage<v.ObjectIssue> | undefined
>;
type VariantOption = ObjectSchema & {
  entries: {
    event: { literal: string };
  };
};
type ProtocolQuerySchema = typeof protocolQuerySchema & {
  pipe: readonly [
    ObjectSchema & {
      entries: Record<string, unknown>;
    },
    ...unknown[],
  ];
};

function notifyWireSurface(): unknown {
  return notifyEventSchema.options.map((option) => {
    const entries = (option as VariantOption).entries;
    return {
      event: entries.event.literal,
      fields: Object.keys(entries).sort(),
    };
  });
}

function protocolUrlWireSurface(): unknown {
  const querySchema = protocolQuerySchema as ProtocolQuerySchema;
  return {
    actions: protocolActions,
    params: Object.keys(querySchema.pipe[0].entries).sort(),
  };
}

describe("wire format", () => {
  it("matches the protocol version snapshot", () => {
    expect({
      version: PROTOCOL_VERSION,
      notify: notifyWireSurface(),
      url: protocolUrlWireSurface(),
    }).toMatchInlineSnapshot(`
      {
        "notify": [
          {
            "event": "item/update",
            "fields": [
              "add",
              "dataPath",
              "event",
              "modify",
              "profilePath",
              "sourceId",
              "trash",
            ],
          },
          {
            "event": "reader/annot-select",
            "fields": [
              "attachmentID",
              "dataPath",
              "event",
              "itemID",
              "profilePath",
              "selected",
              "sourceId",
            ],
          },
          {
            "event": "reader/active",
            "fields": [
              "attachmentID",
              "dataPath",
              "event",
              "itemID",
              "profilePath",
              "selected",
              "sourceId",
            ],
          },
        ],
        "url": {
          "actions": [
            "open",
            "update",
          ],
          "params": [
            "item",
            "source-id",
          ],
        },
        "version": 1,
      }
    `);
  });
});
