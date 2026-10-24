import { cut_for_search, initSync } from "jieba-wasm/web";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { openManagedBinary } from "@/services/managed-binary/__fixtures__";
import type { BinaryPin } from "@/services/managed-binary/service";
import { memoryDevice } from "@/services/managed-binary/test-utils";

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

type Device = ReturnType<typeof memoryDevice>;

function serve(asset: Uint8Array<ArrayBuffer> = BINARY) {
  return vi.fn((_url: string) => Promise.resolve(asset.slice()));
}

/** The segmenter as one vault on `device` sees it. */
function open(
  device: Device,
  { download = serve(), consent = device.consent, pin = PIN } = {},
) {
  return openManagedBinary(
    { ...SEGMENTER, pin },
    { openStore: device.openStore, download, consent },
  );
}

describe("Chinese Segmenter", () => {
  it.effect("cuts a Chinese title with the installed binary", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using segmenter = await open(device);
      await segmenter.handle.runPromise(segmenter.service.install());

      const { module } = (await segmenter.handle.runPromise(
        segmenter.service.getEngine(),
      ))!;
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
    }),
  );

  it.effect(
    "reports a downloaded binary that does not start as init-failed at install",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        const garbage = new Uint8Array(new TextEncoder().encode("not wasm"));
        const pin = {
          ...PIN,
          sha256: createHash("sha256").update(garbage).digest("hex"),
        };
        await using segmenter = await open(device, {
          download: serve(garbage),
          pin,
        });

        await expect(
          segmenter.handle.runPromise(segmenter.service.install()),
        ).rejects.toThrow();

        expect(
          segmenter.handle.runSync(segmenter.service.getStatus()),
        ).toMatchObject({
          kind: "failed",
          failure: { code: "init-failed" },
        });
      }),
  );
});
