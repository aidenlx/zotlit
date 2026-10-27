// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Ref } from "effect";
import type { SettingDefinitionList } from "obsidian";

import { eventually } from "@/lib/__fixtures__/eventually";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { DeviceStorageError } from "@/lib/obsidian-device-storage";
import { AttachmentImport } from "@/services/attachment-import/service";

import { failureOf, recordingRuns, scopedSettingTab } from "./__fixtures__";
import { approvedFoldersPage } from "./approved-folders";
import type { SettingsKey, SettingTabContext } from "./context";

/** The approved-folder list of the page over `service`, with the runs it started. */
const folderList = Effect.fnUntraced(function* (
  service: AttachmentImport["Service"],
) {
  const { tab, runs } = recordingRuns(
    (yield* scopedSettingTab(Context.make(AttachmentImport, service))).tab,
  );
  const page = approvedFoldersPage(
    stubService<SettingTabContext>("SettingTabContext", { tab }),
  );
  const list = page.items?.find(
    (item): item is SettingDefinitionList<SettingsKey> =>
      "type" in item && item.type === "list",
  );
  if (!list) throw new Error("Approved folder list missing");
  return { list, runs };
});

it.effect("lists the approved folders and revokes the one deleted", () =>
  Effect.gen(function* () {
    const folders = yield* Ref.make<readonly string[]>(["/a", "/b"]);
    const revoked = yield* Deferred.make<void>();
    const { list } = yield* folderList(
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFolders: Ref.get(folders),
        revokeFolder: (folder) =>
          Ref.update(folders, (all) =>
            all.filter((path) => path !== folder),
          ).pipe(Effect.andThen(Deferred.succeed(revoked, undefined))),
      }),
    );

    expect(list.items?.map((item) => item.name)).toEqual(["/a", "/b"]);
    list.onDelete?.(0);
    yield* Deferred.await(revoked);
    expect(yield* Ref.get(folders)).toEqual(["/b"]);
  }),
);

it.effect("fails the revoke under its label when storage refuses it", () =>
  Effect.gen(function* () {
    const failure = new DeviceStorageError({
      operation: "saveLocalStorage",
      key: "zotlit-approved-folders",
      message: "Storage is full",
      cause: null,
    });
    const asked: string[] = [];
    const { list, runs } = yield* folderList(
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFolders: Effect.succeed(["/a"]),
        revokeFolder: (folder) =>
          Effect.sync(() => asked.push(folder)).pipe(
            Effect.andThen(Effect.fail(failure)),
          ),
      }),
    );

    list.onDelete?.(0);
    yield* eventually(() => expect(runs).toHaveLength(1));
    expect(asked).toEqual(["/a"]);
    expect(failureOf(runs[0]!)).toBe(failure);
    expect(runs[0]!.label).toBe(m.settings_failed_revoke_folder());
  }),
);
