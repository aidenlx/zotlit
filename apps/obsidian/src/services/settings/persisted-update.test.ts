import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESET_SETTING, SettingsService } from "./service";

async function makeHarness(data: Record<string, unknown> = {}) {
  const plugin = {
    data: { __VERSION__: 10, ...data },
    async loadData() {
      return this.data;
    },
    async saveData(next: unknown) {
      this.data = next as typeof this.data;
    },
  };
  const unchanged = (raw: unknown) => raw;
  const service = new SettingsService({
    plugin,
    migrateLegacy: unchanged,
    migrateV1: unchanged,
    migrateV2: unchanged,
    migrateV3: unchanged,
    migrateV4: unchanged,
    migrateV5: unchanged,
    migrateV6: unchanged,
    migrateV7: unchanged,
    migrateV8: unchanged,
    migrateV9: unchanged,
  });
  await service.ready;
  return {
    service,
    plugin,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

describe("persisted settings update", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes only after save and retains unrelated updates made during save", async () => {
    await using h = await makeHarness({
      "note.template-conversion-pending": true,
    });
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const save = h.plugin.saveData.bind(h.plugin);
    const saveSpy = vi
      .spyOn(h.plugin, "saveData")
      .mockImplementationOnce(async (data) => {
        entered.resolve();
        await proceed.promise;
        await save(data);
      });
    const seen: boolean[] = [];
    const unsubscribe = h.service.subscribe((value) => {
      if (value) seen.push(value["note.template-conversion-pending"]);
    });
    using _subscription = { [Symbol.dispose]: unsubscribe };
    const update = h.service.updatePersisted({
      "note.template-conversion-pending": false,
    });
    await entered.promise;
    h.service.update({ "template.folder": "other-templates" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.service.current?.["note.template-conversion-pending"]).toBe(true);
    expect((await h.service.loaded)["note.template-conversion-pending"]).toBe(
      true,
    );
    expect(seen).toEqual([true, true]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const drained = h.service.flush();
    proceed.resolve();
    await update;
    await drained;
    expect(h.service.current?.["template.folder"]).toBe("other-templates");
    expect(seen).toEqual([true, true, false]);
    expect(h.plugin.data).toEqual({
      __VERSION__: 10,
      "note.template-conversion-pending": false,
      "template.folder": "other-templates",
    });
  });

  it("keeps the original patch values on save failure and saves concurrent unrelated changes", async () => {
    await using h = await makeHarness({
      "note.template-conversion-pending": true,
    });
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    vi.spyOn(h.plugin, "saveData").mockImplementationOnce(async () => {
      entered.resolve();
      await proceed.promise;
      throw new Error("disk full");
    });
    const update = h.service.updatePersisted({
      "note.template-conversion-pending": false,
    });
    const failed = expect(update).rejects.toThrow("disk full");
    await entered.promise;
    h.service.update({ "template.folder": "other-templates" });
    await vi.advanceTimersByTimeAsync(1000);
    proceed.resolve();
    await failed;
    await h.service.flush();
    expect(h.service.current?.["note.template-conversion-pending"]).toBe(true);
    expect(h.plugin.data).toEqual({
      __VERSION__: 10,
      "note.template-conversion-pending": true,
      "template.folder": "other-templates",
    });
  });

  it("preserves broken overrides, removes unknown keys, and supports explicit reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await using h = await makeHarness({
      "note.template-conversion-pending": true,
      "template.folder": 17,
      unknown: "discard",
    });
    await h.service.updatePersisted({
      "note.template-conversion-pending": false,
    });
    await h.service.flush();
    expect(h.plugin.data).toEqual({
      __VERSION__: 10,
      "note.template-conversion-pending": false,
      "template.folder": 17,
    });
    await h.service.updatePersisted({ "template.folder": RESET_SETTING });
    await h.service.flush();
    expect(h.plugin.data).toEqual({
      __VERSION__: 10,
      "note.template-conversion-pending": false,
    });
    expect(h.service.diagnostics).toEqual([]);
  });

  it("reserves only the persisted patch keys while saving", async () => {
    await using h = await makeHarness();
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const save = h.plugin.saveData.bind(h.plugin);
    vi.spyOn(h.plugin, "saveData").mockImplementationOnce(async (data) => {
      entered.resolve();
      await proceed.promise;
      await save(data);
    });
    const update = h.service.updatePersisted({
      "note.template-conversion-pending": true,
    });
    await entered.promise;
    expect(() =>
      h.service.update({ "note.template-conversion-pending": false }),
    ).toThrow("being saved");
    expect(() => h.service.reset()).toThrow("being saved");
    expect(() => h.service.reset(["template.folder"])).not.toThrow();
    proceed.resolve();
    await update;
  });
});
