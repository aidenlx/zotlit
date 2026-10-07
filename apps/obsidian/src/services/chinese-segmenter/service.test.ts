import { cut_for_search, initSync } from "jieba-wasm/web";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ManagedBinaryService } from "@/services/managed-binary/service";
import type { BinaryPin } from "@/services/managed-binary/service";
import {
  memoryDevice,
  vaultConsent,
} from "@/services/managed-binary/test-utils";

import { CHINESE_SEGMENTER } from "./service";

/** The web-target binary the plugin pins, read from the `jieba-wasm` dev dependency. */
const packageDir = join(
  dirname(createRequire(import.meta.url).resolve("jieba-wasm/web")),
  "..",
  "..",
);
const BINARY = new Uint8Array(
  await readFile(join(packageDir, "pkg", "web", "jieba_rs_wasm_bg.wasm")),
);
const { version } = JSON.parse(
  await readFile(join(packageDir, "package.json"), "utf8"),
) as { version: string };

const PIN: BinaryPin = {
  version,
  url: `https://cdn.jsdelivr.net/npm/jieba-wasm@${version}/pkg/web/jieba_rs_wasm_bg.wasm`,
  sha256: createHash("sha256").update(BINARY).digest("hex"),
};
const SEGMENTER = { ...CHINESE_SEGMENTER, pin: PIN };
const CACHED = `${PIN.sha256}.wasm`;

type Device = ReturnType<typeof memoryDevice>;

function serve(asset: Uint8Array<ArrayBuffer> = BINARY) {
  return vi.fn((_url: string) => Promise.resolve(asset.slice()));
}

/** The segmenter as one vault on `device` sees it. */
function open(
  device: Device,
  { download = serve(), consent = device.consent, pin = PIN } = {},
) {
  return new ManagedBinaryService(
    { ...SEGMENTER, pin },
    { openStore: device.openStore, download, consent },
  );
}

describe("Chinese Segmenter", () => {
  it("caches the pinned binary under zotlit/chinese-segmenter and reports its version", async () => {
    const device = memoryDevice();
    const download = serve();
    await using segmenter = open(device, { download });
    await segmenter.ready;
    expect(segmenter.getStatus()).toEqual({ kind: "absent" });

    await segmenter.install();

    expect(download).toHaveBeenCalledExactlyOnceWith(PIN.url);
    expect(device.names("chinese-segmenter")).toEqual([CACHED]);
    expect(segmenter.getStatus()).toEqual({ kind: "installed", version });
  });

  it("cuts a Chinese title with the installed binary", async () => {
    const device = memoryDevice();
    await using segmenter = open(device);
    await segmenter.ready;
    await segmenter.install();

    const { module } = await segmenter.getEngine();
    initSync({ module });

    expect(cut_for_search("长江流域的城市化研究", true)).toEqual([
      "长江",
      "江流",
      "流域",
      "长江流域",
      "的",
      "城市",
      "城市化",
      "研究",
    ]);
  });

  it("reports a download that does not match the pin, and keeps nothing", async () => {
    const device = memoryDevice();
    await using segmenter = open(device, {
      download: serve(new Uint8Array(new TextEncoder().encode("tampered"))),
    });
    await segmenter.ready;

    await expect(segmenter.install()).rejects.toThrow();

    expect(segmenter.getStatus()).toMatchObject({
      kind: "failed",
      failure: { code: "hash-mismatch", expected: PIN.sha256 },
    });
    expect(device.names("chinese-segmenter")).toEqual([]);
  });

  it("shows as installed in a second vault on the device without a download", async () => {
    const device = memoryDevice();
    {
      await using first = open(device);
      await first.ready;
      await first.install();
    }

    const download = serve();
    await using second = open(device, { download, consent: vaultConsent() });
    await second.ready;

    expect(second.getStatus()).toEqual({ kind: "installed", version });
    expect(download).not.toHaveBeenCalled();
  });

  it("remembers a dismissed offer per vault, and uninstall removes the binary device-wide and forgets it", async () => {
    const device = memoryDevice();
    const otherVault = vaultConsent();
    {
      await using dismissed = open(device);
      await dismissed.ready;
      dismissed.decline();
    }
    {
      await using restarted = open(device);
      await restarted.ready;
      expect(restarted.getStatus()).toEqual({ kind: "declined" });
    }
    {
      await using other = open(device, { consent: otherVault });
      await other.ready;
      expect(other.getStatus()).toEqual({ kind: "absent" });
      await other.install();
    }

    {
      await using dismissed = open(device);
      await dismissed.ready;
      expect(dismissed.getStatus()).toEqual({ kind: "installed", version });
      await dismissed.uninstall();
    }

    expect(device.names("chinese-segmenter")).toEqual([]);
    await using restarted = open(device);
    await using other = open(device, { consent: otherVault });
    await Promise.all([restarted.ready, other.ready]);
    expect(restarted.getStatus()).toEqual({ kind: "absent" });
    expect(other.getStatus()).toEqual({ kind: "absent" });
  });

  it("reports a downloaded binary that does not start as init-failed at install", async () => {
    const device = memoryDevice();
    const garbage = new Uint8Array(new TextEncoder().encode("not wasm"));
    const pin = {
      ...PIN,
      sha256: createHash("sha256").update(garbage).digest("hex"),
    };
    await using segmenter = open(device, { download: serve(garbage), pin });
    await segmenter.ready;

    await expect(segmenter.install()).rejects.toThrow();

    expect(segmenter.getStatus()).toMatchObject({
      kind: "failed",
      failure: { code: "init-failed" },
    });
  });
});
