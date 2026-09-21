// Runs in a disposable Electron renderer so transactions use Chromium's IndexedDB.
import { sizedWebp } from "./__fixtures__/webp";
import { encodeExcerptImage } from "./encode";
import { PNG_FORMAT, WEBP_FORMAT } from "./format";
import { openExcerptStore } from "./store";

/** The budget assertions need exact lengths; every payload carries a PNG signature. */
const UNIT = 1_000;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

async function pngOf(width: number, height: number): Promise<Uint8Array> {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const paint = element.getContext("2d");
  if (!paint) throw new Error("Canvas context unavailable");
  paint.fillStyle = "#3d7ab8";
  paint.fillRect(0, 0, width, height);
  return new Uint8Array(
    await (
      await new Promise<Blob>((resolve, reject) =>
        element.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("PNG failed"))),
          "image/png",
        ),
      )
    ).arrayBuffer(),
  );
}

/** Writes a record with the browser's own IndexedDB, bypassing the store schema. */
async function writeRaw(
  databaseName: string,
  record: Record<string, unknown>,
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const transaction = database.transaction("images", "readwrite");
    await new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore("images").put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function run(): Promise<string[]> {
  const passed: string[] = [];
  const png = await pngOf(8, 8);
  const signature = png.subarray(0, 8);
  const marker = (bytes: Uint8Array) => bytes[signature.byteLength]!;
  const payload = (units: number, value = 7) => {
    const bytes = new Uint8Array(Math.max(units * UNIT, signature.byteLength));
    bytes.fill(value);
    bytes.set(signature);
    return bytes;
  };
  const entry = (units: number, value = 7) => ({
    bytes: payload(units, value),
    format: PNG_FORMAT,
    pdf: { size: 100, mtimeMs: 10 },
  });
  {
    using store = await openExcerptStore("restart", 10 * UNIT);
    await store.put("first", entry(4));
  }
  {
    using store = await openExcerptStore("restart", 10 * UNIT);
    using otherVault = await openExcerptStore("other-vault", 10 * UNIT);
    check(
      (await store.get("first"))?.bytes.byteLength === 4 * UNIT &&
        marker((await store.get("first"))!.bytes) === 7,
      "Restart lost generated pixels",
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
      marker((await store.get("first"))!.bytes) === 7,
      "Recently used entry was evicted",
    );
    await store.put("first", entry(2, 10));
    await store.put("fourth", entry(4, 11));
    check(
      marker((await store.get("third"))!.bytes) === 9,
      "Replacement byte accounting evicted an entry early",
    );
    await store.put("oversized", entry(11));
    check(
      (await store.get("oversized")) === undefined,
      "Oversized entry exceeded budget",
    );
    check(
      held.bytes.byteLength === 4 * UNIT && marker(held.bytes) === 7,
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
      marker((await store.get("c"))!.bytes) === 3,
      "Last transaction lost its entry",
    );
    await store.clear();
    check(
      (await store.get("c")) === undefined,
      "Clear retained derived pixels",
    );
    await store.put("full-budget", entry(10));
    check(
      (await store.get("full-budget"))?.bytes.byteLength === 10 * UNIT,
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
      (await store.get("full-budget"))?.bytes.byteLength === 10 * UNIT,
      "Failed transaction damaged an existing entry",
    );
    check(
      (await store.get("failed")) === undefined,
      "Failed transaction committed pixels",
    );
    await store.put("recovered", entry(10, 12));
    check(
      marker((await store.get("recovered"))!.bytes) === 12 &&
        (await store.get("full-budget")) === undefined,
      "Failed transaction damaged accounting",
    );
    passed.push("failed transaction rolls back pixels and accounting");
  }
  {
    // Both formats and every record generation share one store.
    using store = await openExcerptStore("formats", 10 * UNIT);
    const source = document.createElement("canvas");
    source.width = 12;
    source.height = 9;
    const paint = source.getContext("2d");
    if (!paint) throw new Error("Canvas context unavailable");
    paint.fillStyle = "rgba(10, 20, 30, 0.5)";
    paint.fillRect(0, 0, 12, 9);
    const webp = await encodeExcerptImage(source, new AbortController().signal);
    check(webp.format.format === "webp", "Canvas did not encode lossless WebP");
    const pdf = { size: 1, mtimeMs: 1 };
    await store.put("webp", { bytes: webp.bytes, format: webp.format, pdf });
    const stored = await store.get("webp", pdf);
    check(
      stored?.format.format === "webp" && sameBytes(stored.bytes, webp.bytes),
      "Lossless WebP did not survive the cache",
    );
    await writeRaw("formats-zotlit-excerpt-images", {
      key: "legacy",
      bytes: png,
      pdf,
      byteCount: png.byteLength,
      lastAccess: 1,
    });
    const legacy = await store.get("legacy");
    check(
      legacy?.format.format === "png" && sameBytes(legacy.bytes, png),
      "Legacy PNG record did not survive as PNG",
    );
    await store.put("mismatch", { bytes: webp.bytes, format: PNG_FORMAT, pdf });
    check(
      (await store.get("mismatch")) === undefined,
      "Metadata that disagrees with its payload reached a caller",
    );
    await store.put("truncated", {
      bytes: webp.bytes.subarray(0, 8),
      format: WEBP_FORMAT,
      pdf,
    });
    check(
      (await store.get("truncated")) === undefined,
      "Truncated WebP reached a caller",
    );
    await store.put("declared-bomb", {
      bytes: sizedWebp(16_383, 16_383),
      format: WEBP_FORMAT,
      pdf,
    });
    check(
      (await store.get("declared-bomb")) === undefined,
      "A record declaring 1 GiB of RGBA reached a caller",
    );
    passed.push("mixed PNG and WebP records");
  }
  {
    // One Annotation's latest image: the reference a display reads before its
    // saved pixels resolve, which survives a launch and leaves with its bytes.
    const reference = {
      key: "first",
      fingerprint: "F1",
      pdf: { size: 1, mtimeMs: 1 },
    };
    {
      using store = await openExcerptStore("latest", 10 * UNIT);
      await store.put("first", entry(4));
      await store.putLatest("annot", reference);
      check(
        (await store.latest("annot"))?.key === "first",
        "A reference did not survive its write",
      );
    }
    {
      using store = await openExcerptStore("latest", 10 * UNIT);
      using otherVault = await openExcerptStore(
        "latest-other-vault",
        10 * UNIT,
      );
      check(
        (await store.latest("annot"))?.fingerprint === "F1",
        "A reference did not survive a launch",
      );
      check(
        (await otherVault.latest("annot")) === undefined,
        "Vault identities collided on a reference",
      );
      await store.putLatest("annot", { ...reference, fingerprint: "F2" });
      check(
        (await store.latest("annot"))?.fingerprint === "F2",
        "A later reference did not replace the one before it",
      );
      await store.putLatest("other", reference);
      await store.clear();
      check(
        (await store.latest("annot")) === undefined &&
          (await store.latest("other")) === undefined,
        "Clear retained references",
      );
      await store.put("first", entry(10));
      check(
        (await store.get("first"))?.bytes.byteLength === 10 * UNIT,
        "References outlived the accounting clear",
      );
    }
    passed.push("latest references");
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
    using store = await openExcerptStore("schema", 10 * UNIT);
    check(
      (await store.get("old")) === undefined,
      "Schema retained obsolete records",
    );
    await store.put("new", entry(3));
    check(
      (await store.get("new"))?.bytes.byteLength === 3 * UNIT,
      "Schema reset is not writable",
    );
    passed.push("schema reset");
  }
  return passed;
}
