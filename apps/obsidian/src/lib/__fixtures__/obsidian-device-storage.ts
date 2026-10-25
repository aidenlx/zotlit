// An in-memory device storage for tests. The test drives it; the tag's own
// layer runs over it (`layerDeviceStorageFrom`, or `layerHost` from
// ./obsidian-host-app). It copies the shape of ./obsidian-metadata-cache.
import type { DeviceStorageSource } from "@/lib/obsidian-device-storage";

/**
 * The values a test vault saved on this device. As Obsidian's App (1.14.4),
 * it keeps each value as JSON text, so a value loads back as a copy.
 */
export class MemoryDeviceStorage implements DeviceStorageSource {
  /** The JSON text of each saved value, by key, as `localStorage` holds it. */
  readonly values = new Map<string, string>();

  /** As Obsidian: `null` for a key that holds nothing or text that is not JSON. */
  loadLocalStorage(key: string): unknown {
    const text = this.values.get(key);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  /** As Obsidian: a falsy value removes the key. */
  saveLocalStorage(key: string, data: unknown): void {
    if (data) this.values.set(key, JSON.stringify(data));
    else this.values.delete(key);
  }
}
