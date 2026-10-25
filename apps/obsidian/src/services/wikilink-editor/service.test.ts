import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Effect, Layer, PubSub, Stream } from "effect";
import { MarkdownView, TFile } from "obsidian";
import type { App, Editor, WorkspaceLeaf } from "obsidian";
import {
  beforeEach as beforeStreamTest,
  afterEach as afterStreamTest,
} from "vitest";
import { describe, expect, it } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { buildRuntime } from "@/lib/effect-layer";
import { CitationLookupStub } from "@/services/citation-index/__fixtures__/citation-lookup";
import { openNoteVault } from "@/services/note-index/__fixtures__";
import { buildSeededSettings } from "@/services/settings/__fixtures__";
import type { SettingsFixture } from "@/services/settings/__fixtures__";
import type { Settings } from "@/services/settings/schema";

import { WikilinkEditor } from "./service";
import type { WikilinkEditorDeps } from "./service";

let streamStack: AsyncDisposableStack;
let streamRuntime: ReturnType<typeof buildRuntime<never>>;
beforeStreamTest(() => {
  streamStack = new AsyncDisposableStack();
  streamRuntime = buildRuntime(Layer.empty, streamStack);
});
afterStreamTest(() => streamStack.disposeAsync());

/** The markdown leaves two notes are open in, as the workspace hands them out. */
const leaves = (dispatched: string[]) =>
  ["note.md", "other.md"].map((path) => {
    const file = new TFile();
    file.path = path;
    const view = stubService<MarkdownView>("MarkdownView", {
      file,
      editor: stubService<Editor>("Editor", {
        cm: stubService<EditorView>("EditorView", {
          dispatch: () => dispatched.push(path),
        }),
      }),
    });
    // The service narrows a leaf's view with `instanceof`.
    Object.setPrototypeOf(view, MarkdownView.prototype);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", { view });
  });

interface Harness extends AsyncDisposable {
  service: WikilinkEditor;
  settings: SettingsFixture;
  bridge: SettingsFixture["bridge"];
  /** Gives the vault's one Literature Note another Item key, or none. */
  writeNote: (itemKey: string | undefined) => Promise<void>;
  citationText: CitationTextStub;
  citationLookup: LookupStub;
  registered: Extension[];
  reconfigures: () => number;
  dispatched: string[];
}

async function harness(overrides: Partial<Settings> = {}): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const settings = stack.use(await buildSeededSettings(overrides));
  const notes = await openNoteVault({ "Doe 2024.md": "DEE23456" }, stack);
  const { noteIndex } = notes;
  const citationText = new CitationTextStub();
  const citationLookup = new LookupStub();
  const dispatched: string[] = [];
  let registered: Extension[] = [];
  let reconfigures = 0;
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      updateOptions: () => reconfigures++,
      getLeavesOfType: () => leaves(dispatched),
    }),
  });
  const plugin = stubService<WikilinkEditorDeps["plugin"]>("Plugin", {
    registerEditorExtension: (extension: Extension) => {
      registered = extension as Extension[];
    },
  });
  const service = new WikilinkEditor(
    stubService<WikilinkEditorDeps>("WikilinkEditorDeps", {
      runtime: streamRuntime,
      app,
      plugin,
      noteIndex: stubService<WikilinkEditorDeps["noteIndex"]>("NoteIndex", {
        changed: noteIndex.changed,
        indexed: noteIndex.indexed,
        "frontmatter-changed": noteIndex["frontmatter-changed"],
      }),
      citationText: stubService<WikilinkEditorDeps["citationText"]>(
        "CitationText",
        {
          changed: citationText.changed,
          invalidated: citationText.invalidated.pipe(
            Stream.map(() => undefined),
          ),
          peek: () => citationText.peek(),
        },
      ),
      citekeyEditor: stubService<WikilinkEditorDeps["citekeyEditor"]>(
        "CitekeyEditor",
        {},
      ),
      citationPopover: stubService<WikilinkEditorDeps["citationPopover"]>(
        "CitationPopover",
        {},
      ),
      citationLookup,
      bridge: settings.bridge,
      settings,
    }),
  );
  await service.ready;
  const owned = stack.move();
  return {
    service,
    settings,
    bridge: settings.bridge,
    writeNote: (itemKey) => notes.writeNote("Doe 2024.md", itemKey),
    citationText,
    citationLookup,
    registered,
    reconfigures: () => reconfigures,
    dispatched,
    [Symbol.asyncDispose]: async () => {
      await service[Symbol.asyncDispose]();
      await owned.disposeAsync();
    },
  };
}

describe("WikilinkEditor registration", () => {
  it("installs the extension once so source settings can change live", async () => {
    const { service, registered, reconfigures } = await harness({
      "citation.wikilink-citations": false,
      "citation.show-formatted": false,
    });

    expect(registered).toHaveLength(1);
    expect(reconfigures()).toBe(1);

    await service[Symbol.asyncDispose]();
    expect(registered).toEqual([]);
    expect(reconfigures()).toBe(2);
  });
});

describe("WikilinkEditor redraw", () => {
  it("redraws every open editor when a Literature Note changes", async () => {
    await using harnessed = await harness();
    const { writeNote, dispatched } = harnessed;

    await writeNote("REE34567");
    await expect.poll(() => dispatched).toEqual(["note.md", "other.md"]);
  });

  it("redraws when a gating setting changes", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
    });
    const { bridge, settings, dispatched } = harnessed;

    bridge.runSync(settings.update({ "citation.wikilink-citations": true }));
    expect(dispatched).toEqual(["note.md", "other.md"]);

    dispatched.length = 0;
    bridge.runSync(settings.update({ "citation.show-formatted": false }));
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("redraws when the Hover Action changes who answers a hover", async () => {
    await using harnessed = await harness();
    const { bridge, settings, dispatched } = harnessed;

    bridge.runSync(settings.update({ "citation.hover-action": "off" }));
    expect(dispatched).toEqual(["note.md", "other.md"]);

    // Which mode holds a hover back for a modifier is read at hover time, so
    // nothing drawn depends on it.
    dispatched.length = 0;
    bridge.runSync(
      settings.update({ "citation.hover-require-mod-live-preview": true }),
    );
    expect(dispatched).toEqual([]);
  });

  it("leaves lookup redraws to each open editor view", async () => {
    await using harnessed = await harness();
    const { citationLookup, dispatched } = harnessed;

    citationLookup.emit();
    expect(dispatched).toEqual([]);
  });

  it("leaves the editors alone when an unrelated setting changes", async () => {
    await using harnessed = await harness();
    const { bridge, settings, dispatched } = harnessed;

    bridge.runSync(settings.update({ "citation.open-as-links": false }));
    expect(dispatched).toEqual([]);
  });

  it("redraws the one document whose citation text landed", async () => {
    await using harnessed = await harness();
    const { citationText, dispatched } = harnessed;

    citationText.emit("changed", "note.md");
    expect(dispatched).toEqual(["note.md"]);

    dispatched.length = 0;
    citationText.emit("invalidated");
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("leaves the editors alone when Wikilink Citations is off and formatted presentation changes", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
    });
    const { bridge, settings, dispatched } = harnessed;

    bridge.runSync(settings.update({ "citation.show-formatted": false }));
    expect(dispatched).toEqual([]);
  });
});

class CitationTextStub {
  readonly #changedBus = Effect.runSync(PubSub.unbounded<string>());
  readonly #invalidatedBus = Effect.runSync(PubSub.unbounded<void>());
  readonly changed = Stream.fromPubSub(this.#changedBus);
  readonly invalidated = Stream.fromPubSub(this.#invalidatedBus);

  peek(): null {
    return null;
  }

  load(): Promise<never[]> {
    return Promise.resolve([]);
  }

  emit(event: "changed" | "invalidated", path?: string): void {
    if (event === "changed") PubSub.publishUnsafe(this.#changedBus, path!);
    else PubSub.publishUnsafe(this.#invalidatedBus, undefined);
  }
}

class LookupStub extends CitationLookupStub {
  constructor() {
    super(() => null);
  }
  emit(): void {
    this.refresh();
  }
}
