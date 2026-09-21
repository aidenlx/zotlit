// Runs in a disposable Electron renderer so transactions use Chromium's IndexedDB.
import { losslessWebp } from "./__fixtures__/webp";
import { openExcerptStore } from "./store";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function run(): Promise<string[]> {
  const passed: string[] = [];
  const entry = (
    count: number,
    marker = 7,
    format: "png" | "webp" = "png",
  ) => ({
    bytes: new Uint8Array(count).fill(marker),
    pdf: { size: 100, mtimeMs: 10 },
    format,
    mimeType: `image/${format}` as `image/${"png" | "webp"}`,
    extension: format,
  });
  {
    using store = await openExcerptStore("restart", 10);
    await store.put("first", entry(4));
  }
  {
    using store = await openExcerptStore("restart", 10);
    using otherVault = await openExcerptStore("other-vault", 10);
    using formats = await openExcerptStore(
      "formats",
      losslessWebp.byteLength + 1,
    );
    check(
      (await store.get("first"))?.bytes[0] === 7,
      "Restart lost generated pixels",
    );
    await formats.put("webp", {
      ...entry(losslessWebp.byteLength, 13, "webp"),
      bytes: new Uint8Array(losslessWebp),
    });
    check(
      (await formats.get("webp"))?.format === "webp" &&
        (await formats.get("webp"))?.mimeType === "image/webp" &&
        (await formats.get("webp"))?.extension === "webp",
      "Mixed PNG/WebP metadata was not retained",
    );
    check(
      (await otherVault.get("first")) === undefined,
      "Vault identities collided",
    );
    passed.push("restart and vault isolation");
    const held = (await store.get("first"))!;
    await store.put("second", entry(4, 8));
    await store.get("first");
    await store.put("third", entry(4, 9));
    check(
      (await store.get("second")) === undefined,
      "LRU did not evict oldest use",
    );
    check(
      (await store.get("first"))?.bytes[0] === 7,
      "Recently used entry was evicted",
    );
    await store.put("first", entry(2, 10));
    await store.put("fourth", entry(4, 11));
    check(
      (await store.get("third"))?.bytes[0] === 9,
      "Replacement byte accounting evicted an entry early",
    );
    await store.put("oversized", entry(11));
    check(
      (await store.get("oversized")) === undefined,
      "Oversized entry exceeded budget",
    );
    check(
      held.bytes.length === 4 && held.bytes[0] === 7,
      "Owned bytes changed after replacement",
    );
    passed.push("LRU, replacement accounting, oversized and owned bytes");
    await store.clear();
    await Promise.all([
      store.put("a", entry(6, 1)),
      store.put("b", entry(6, 2)),
      store.put("c", entry(6, 3)),
    ]);
    check(
      (await store.get("a")) === undefined &&
        (await store.get("b")) === undefined,
      "Concurrent writes exceeded budget",
    );
    check(
      (await store.get("c"))?.bytes[0] === 3,
      "Last transaction lost its entry",
    );
    await store.clear();
    check(
      (await store.get("c")) === undefined,
      "Clear retained derived pixels",
    );
    await store.put("full-budget", entry(10));
    check(
      (await store.get("full-budget"))?.bytes.length === 10,
      "Clear retained stale accounting",
    );
    passed.push("transaction serialization and clear accounting");
    const put = Object.getOwnPropertyDescriptor(
      IDBObjectStore.prototype,
      "put",
    )!.value as IDBObjectStore["put"];
    {
      using cleanup = new DisposableStack();
      cleanup.defer(() => {
        IDBObjectStore.prototype.put = put;
      });
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === "images") this.transaction.abort();
        return request;
      };
      await store.put("failed", entry(4)).then(
        () => {
          throw new Error("Aborted write succeeded");
        },
        () => undefined,
      );
    }
    check(
      (await store.get("full-budget"))?.bytes.length === 10,
      "Failed transaction damaged an existing entry",
    );
    check(
      (await store.get("failed")) === undefined,
      "Failed transaction committed pixels",
    );
    await store.put("recovered", entry(10, 12));
    check(
      (await store.get("recovered"))?.bytes[0] === 12 &&
        (await store.get("full-budget")) === undefined,
      "Failed transaction damaged accounting",
    );
    passed.push("failed transaction rolls back pixels and accounting");
  }
  // Simulate the next schema version using the real open/upgrade machinery.
  const originalOpen = Object.getOwnPropertyDescriptor(
    IDBFactory.prototype,
    "open",
  )!.value as IDBFactory["open"];
  const open = originalOpen.bind(indexedDB);
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = open("schema-zotlit-excerpt-images", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("old-format").put("obsolete", "old");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  legacy.close();
  {
    using cleanup = new DisposableStack();
    cleanup.defer(() => {
      indexedDB.open = originalOpen;
    });
    indexedDB.open = (name, version) =>
      open(name, name === "schema-zotlit-excerpt-images" ? 2 : version);
    using store = await openExcerptStore("schema", 10);
    check(
      (await store.get("old")) === undefined,
      "Schema retained obsolete records",
    );
    await store.put("new", entry(3));
    check(
      (await store.get("new"))?.bytes.length === 3,
      "Schema reset is not writable",
    );
    passed.push("schema reset");
  }
  return passed;
}
