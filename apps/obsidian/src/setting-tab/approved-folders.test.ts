// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Ref } from "effect";
import type { SettingDefinitionList } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { DeviceStorageError } from "@/lib/obsidian-device-storage";
import { AttachmentImport } from "@/services/attachment-import/service";
import { eventually } from "@/services/language-pack/__fixtures__";

import { scopedSettingTab } from "./__fixtures__";
import { approvedFoldersPage } from "./approved-folders";
import type { SettingsKey, SettingTabContext } from "./context";

/** The approved-folder list of the page over `service`, with the tab's notices. */
const folderList = Effect.fnUntraced(function* (
  service: AttachmentImport["Service"],
) {
  const { tab, notices } = yield* scopedSettingTab(
    Context.make(AttachmentImport, service),
  );
  const page = approvedFoldersPage(
    stubService<SettingTabContext>("SettingTabContext", { tab }),
  );
  const list = page.items?.find(
    (item): item is SettingDefinitionList<SettingsKey> =>
      "type" in item && item.type === "list",
  );
  if (!list) throw new Error("Approved folder list missing");
  return { list, notices };
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

it.effect("names a failed revoke in a notice", () =>
  Effect.gen(function* () {
    const { list, notices } = yield* folderList(
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFolders: Effect.succeed(["/a"]),
        revokeFolder: () =>
          Effect.fail(
            new DeviceStorageError({
              operation: "saveLocalStorage",
              key: "zotlit-approved-folders",
              message: "Storage is full",
              cause: null,
            }),
          ),
      }),
    );

    list.onDelete?.(0);
    yield* eventually(() =>
      expect(notices.map((notice) => notice.messages[0])).toEqual([
        `${m.settings_failed_revoke_folder()}: Storage is full`,
      ]),
    );
  }),
);
