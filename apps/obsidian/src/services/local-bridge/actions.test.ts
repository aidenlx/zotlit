// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Command, MetadataCache, Workspace } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { fileMenuHandler } from "@/services/__fixtures__/file-menu";
import type { NoteProfile, ResolvedProfile } from "@/services/profile/bindings";
import { defaults } from "@/services/settings/schema";

import {
  addCustomizeActions,
  customizeFileMenu,
  noteCustomizeRequest,
} from "./actions";
import type { CustomizeActionDeps } from "./actions";

/** The one Profile this vault holds beside the built-in Default. */
const BOOKS: { id: ProfileId; label: string } = {
  id: "Bk3Qn7XvT2Lp" as ProfileId,
  label: "Books",
};

interface Note {
  readonly path: string;
  readonly basename: string;
  /** The `zotero-key` the note carries, or `null` for an ordinary note. */
  readonly itemKey: string | null;
  /** The `zotlit-profile` stamp, absent when the note carries none. */
  readonly stamp?: string;
}

interface Harness {
  file: TFile | null;
  command: Command;
  /** The ZotLit menu items a right-click on the note offers. */
  menu: () => Menu;
  customize: ReturnType<typeof vi.fn>;
  /** The pure resolution behind both entries, for the note under test. */
  request: () => ReturnType<typeof noteCustomizeRequest>;
}

function harness(
  note: Note | null,
  { workbench = true, loaded = true } = {},
): Harness {
  const file: TFile | null = note
    ? Object.assign(new TFile(), {
        path: note.path,
        basename: note.basename,
        extension: "md",
      })
    : null;
  const frontmatter: Record<string, string> = {};
  if (note?.itemKey) frontmatter["zotero-key"] = note.itemKey;
  if (note?.stamp) frontmatter["zotlit-profile"] = note.stamp;

  const commands: Command[] = [];
  const customize = vi.fn(() => Promise.resolve());
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getActiveFile: () => file,
    }),
    metadataCache: stubService<MetadataCache>("MetadataCache", {
      getFileCache: () => ({ frontmatter }),
    }),
  });
  const deps: CustomizeActionDeps = {
    settings: stubService<CustomizeActionDeps["settings"]>("PluginSettings", {
      current: Effect.sync(() => ({
        ...defaults,
        "server.workbench": workbench,
      })),
    }),
    profile: stubService<CustomizeActionDeps["profile"]>("PlainProfile", {
      loaded,
      profileOf: () => stampedProfile(note?.stamp),
    }),
    customize,
  };

  addCustomizeActions(
    {
      app,
      addCommand: (command) => {
        commands.push(command);
        return command;
      },
    },
    deps,
  );
  const fileMenu = fileMenuHandler([customizeFileMenu(app, deps)], frontmatter);

  return {
    file,
    command: commands.find(({ id }) => id === "customize-note-template")!,
    menu: () => {
      const menu = new Menu();
      fileMenu(menu as never, file! as never, "more-options");
      return menu;
    },
    customize,
    request: () => noteCustomizeRequest(file!, app, deps),
  };
}

/** The Profile resolution the registry answers a note's stamp with. */
function stampedProfile(stamp: string | undefined): NoteProfile {
  if (stamp === undefined)
    return {
      ok: true,
      profile: stubService<ResolvedProfile>("ResolvedProfile", {
        selector: "default",
      }),
    };
  if (stamp === `${BOOKS.label} (${BOOKS.id})`)
    return {
      ok: true,
      profile: stubService<ResolvedProfile>("ResolvedProfile", {
        selector: BOOKS.id,
      }),
    };
  return { ok: false, stamped: { stamp, id: undefined } };
}

const STAMPED: Note = {
  path: "literatures/@ioannidis2005.md",
  basename: "@ioannidis2005",
  itemKey: "IANNP5A2",
  stamp: `${BOOKS.label} (${BOOKS.id})`,
};

describe("Customize on a Literature Note", () => {
  it("opens the note's own Profile and paper from the command", () => {
    const h = harness(STAMPED);

    expect(h.command.name).toBe(m.command_customize_note_template_name());
    expect(h.command.checkCallback?.(true)).toBe(true);
    expect(h.customize).not.toHaveBeenCalled();

    h.command.checkCallback?.(false);
    expect(h.customize).toHaveBeenCalledExactlyOnceWith({
      profileId: BOOKS.id,
      item: { key: "IANNP5A2", title: "@ioannidis2005" },
      originatingNote: h.file,
    });
  });

  it("offers the same launch from the note's menu, in the action section", () => {
    const h = harness(STAMPED);
    const items = h.menu().items;

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe(m.command_customize_note_template_name());
    expect(items[0]!.section).toBe("action");

    items[0]!.click();
    expect(h.customize).toHaveBeenCalledExactlyOnceWith({
      profileId: BOOKS.id,
      item: { key: "IANNP5A2", title: "@ioannidis2005" },
      originatingNote: h.file,
    });
  });

  it("opens Default for a note that carries no stamp", () => {
    const h = harness({ ...STAMPED, stamp: undefined });

    h.command.checkCallback?.(false);
    expect(h.customize).toHaveBeenCalledExactlyOnceWith({
      profileId: "default",
      item: { key: "IANNP5A2", title: "@ioannidis2005" },
      originatingNote: h.file,
    });
  });

  it("answers a stamp the vault no longer holds with the diagnostic", () => {
    const h = harness({ ...STAMPED, stamp: "Papers (Zz9Wm4YfH6Kd)" });

    expect(h.request()).toMatchObject({
      code: "unknown-literature-note-profile",
      stamp: "Papers (Zz9Wm4YfH6Kd)",
      path: "literatures/@ioannidis2005.md",
      recovery: { action: "switch-profile" },
    });

    // The command still counts as available: the diagnostic is its answer.
    expect(h.command.checkCallback?.(true)).toBe(true);
    h.command.checkCallback?.(false);
    expect(h.customize).not.toHaveBeenCalled();
  });

  it("stays away from a note that is not a Literature Note", () => {
    const plain = harness({
      path: "Reading list.md",
      basename: "Reading list",
      itemKey: null,
    });
    expect(plain.command.checkCallback?.(true)).toBe(false);
    expect(plain.menu().items).toEqual([]);

    // No note at all leaves the command out of the palette too.
    expect(harness(null).command.checkCallback?.(true)).toBe(false);
  });

  it("keeps both Customize entries available while web access is off", () => {
    const off = harness(STAMPED, { workbench: false });

    expect(off.command.checkCallback?.(true)).toBe(true);
    expect(off.menu().items).toHaveLength(1);
  });

  it("waits for the Profile registry before it names a note's Profile", () => {
    const loading = harness(STAMPED, { loaded: false });

    expect(loading.command.checkCallback?.(true)).toBe(false);
    expect(loading.menu().items).toEqual([]);
  });
});
