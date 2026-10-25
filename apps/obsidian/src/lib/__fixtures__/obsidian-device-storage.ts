// An in-memory device storage for tests. The test drives it; the tag's own
// layer runs over it (`layerDeviceStorageFrom`, or `layerHost` from
// ./obsidian-host-app). It copies the shape of ./obsidian-metadata-cache.
import type { DeviceStorageSource } from "@/lib/obsidian-device-storage";

/** The values a test vault saved on this device, by key. */
export class MemoryDeviceStorage implements DeviceStorageSource {
  readonly values = new Map<string, unknown>();

  /** As Obsidian: `null` for a key that holds nothing. */
  loadLocalStorage(key: string): unknown {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  /** As Obsidian: `null` removes the key. */
  saveLocalStorage(key: string, data: unknown): void {
    if (data === null) this.values.delete(key);
    else this.values.set(key, data);
  }
}
