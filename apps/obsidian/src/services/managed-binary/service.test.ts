import { createHash } from "node:crypto";
import { describe, expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { openManagedBinary } from "./__fixtures__";
import type { ManagedBinary } from "./service";
import { memoryDevice } from "./test-utils";

/** Node's own typings hand back `ArrayBufferLike` views; the ports take `ArrayBuffer` ones. */
function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

function sha256(binary: Uint8Array): string {
  return createHash("sha256").update(binary).digest("hex");
}

/** A bare `.wasm` asset: the download is the binary itself, with no archive around it. */
const SEGMENTER_BINARY = bytes("jieba wasm bytes");
const OTHER_BINARY = bytes("other wasm bytes");

function disposable(): AsyncDisposable {
  return { [Symbol.asyncDispose]: () => Promise.resolve() };
}

function instance(
  id: string,
  binary: Uint8Array<ArrayBuffer>,
  overrides: Partial<ManagedBinary<AsyncDisposable>> = {},
): ManagedBinary<AsyncDisposable> {
  return {
    id,
    label: `${id} binary`,
    logCategory: ["managed-binary", id],
    pin: {
      version: "2.4.0",
      url: `https://example.invalid/${id}_bg.wasm`,
      sha256: sha256(binary),
    },
    createEngine: () => Promise.resolve(disposable()),
    ...overrides,
  };
}

const SEGMENTER = instance("chinese-segmenter", SEGMENTER_BINARY);
const OTHER = instance("other-binary", OTHER_BINARY);

type Device = ReturnType<typeof memoryDevice>;

/** Serves every pinned URL its own binary, so each instance downloads its own bytes. */
function serve(...binaries: ManagedBinary<AsyncDisposable>[]) {
  const assets = new Map(
    binaries.map((binary) => [
      binary.pin.url,
      binary === OTHER ? OTHER_BINARY : SEGMENTER_BINARY,
    ]),
  );
  return vi.fn((url: string) => {
    const asset = assets.get(url);
    return asset
      ? Promise.resolve(asset.slice())
      : Promise.reject(new Error(`404 ${url}`));
  });
}

function open(
  binary: ManagedBinary<AsyncDisposable>,
  device: Device,
  download = serve(SEGMENTER, OTHER),
) {
  return openManagedBinary(binary, {
    openStore: device.openStore,
    consent: device.consent,
    download,
  });
}

const CACHED = `${SEGMENTER.pin.sha256}.wasm`;

describe("Managed Binary with a bare .wasm pin", () => {
  it.effect(
    "caches the downloaded binary under its own hash in its own directory",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        const download = serve(SEGMENTER);
        await using service = await open(SEGMENTER, device, download);
        expect(service.getStatus()).toEqual({ kind: "absent" });
        expect(download).not.toHaveBeenCalled();

        await service.install();

        expect(download).toHaveBeenCalledWith(SEGMENTER.pin.url);
        expect(device.names(SEGMENTER.id)).toEqual([CACHED]);
        expect(device.files(SEGMENTER.id).get(CACHED)).toEqual(
          SEGMENTER_BINARY,
        );
        expect(service.getStatus()).toEqual({
          kind: "installed",
          version: SEGMENTER.pin.version,
          binary: { directory: "chinese-segmenter", name: CACHED },
        });
      }),
  );

  it.effect("reports no readable binary while a first install runs", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using service = await open(SEGMENTER, device);

      const done = service.install();

      expect(service.getStatus()).toEqual({
        kind: "installing",
        done,
        binary: null,
      });
      await done;
    }),
  );

  it.effect("keeps the installed binary readable while a reinstall runs", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using service = await open(SEGMENTER, device);
      await service.install();
      const installed = { directory: "chinese-segmenter", name: CACHED };

      const done = service.install();

      expect(service.getStatus()).toEqual({
        kind: "installing",
        done,
        binary: installed,
      });
      await done;
      expect(service.getStatus()).toEqual({
        kind: "installed",
        version: SEGMENTER.pin.version,
        binary: installed,
      });
    }),
  );

  it.effect("hands the cached bytes to its engine factory", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      const createEngine = vi.fn((_binary: Blob) =>
        Promise.resolve(disposable()),
      );
      await using service = await open({ ...SEGMENTER, createEngine }, device);
      await service.install();

      await service.getEngine();

      const [passed] = createEngine.mock.calls[0]!;
      expect(new Uint8Array(await passed.arrayBuffer())).toEqual(
        SEGMENTER_BINARY,
      );
    }),
  );

  it.effect(
    "shares one install, its engine start included, with an install during the start",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        const download = serve(SEGMENTER);
        const starting = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let disposed = 0;
        const createEngine = vi.fn(async (_binary: Blob) => {
          starting.resolve();
          await release.promise;
          return {
            [Symbol.asyncDispose]: () => {
              disposed++;
              return Promise.resolve();
            },
          };
        });
        await using service = await open(
          { ...SEGMENTER, createEngine, startOnInstall: true },
          device,
          download,
        );

        const first = service.install();
        await starting.promise;
        const second = service.install();
        const during = service.getStatus().kind;
        release.resolve();
        await Promise.all([first, second]);

        expect(second).toBe(first);
        expect(during).toBe("installing");
        expect(download).toHaveBeenCalledOnce();
        expect(createEngine).toHaveBeenCalledOnce();
        expect(disposed).toBe(1);
        expect(service.getStatus()).toEqual({
          kind: "installed",
          version: SEGMENTER.pin.version,
          binary: { directory: "chinese-segmenter", name: CACHED },
        });
      }),
  );

  it.effect(
    "reports a binary that does not match the pin, and caches nothing",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        const expected = "f".repeat(64);
        await using service = await open(
          { ...SEGMENTER, pin: { ...SEGMENTER.pin, sha256: expected } },
          device,
        );

        await expect(service.install()).rejects.toThrow();

        expect(service.getStatus()).toEqual({
          kind: "failed",
          failure: {
            code: "hash-mismatch",
            expected,
            actual: SEGMENTER.pin.sha256,
          },
        });
        expect(device.names(SEGMENTER.id)).toEqual([]);
      }),
  );

  it.effect(
    "remembers a declined offer across restarts, and forgets it on install",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        {
          await using first = await open(SEGMENTER, device);
          first.decline();
          expect(first.getStatus()).toEqual({ kind: "declined" });
        }

        await using restarted = await open(SEGMENTER, device);
        expect(restarted.getStatus()).toEqual({ kind: "declined" });

        await restarted.install();
        await restarted.uninstall();
        expect(restarted.getStatus()).toEqual({ kind: "absent" });
      }),
  );

  it.effect(
    "clears its directory on uninstall and offers the install again",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        await using service = await open(SEGMENTER, device);
        await service.install();

        await service.uninstall();

        expect(device.names(SEGMENTER.id)).toEqual([]);
        expect(service.getStatus()).toEqual({ kind: "absent" });
      }),
  );

  it.effect(
    "drops binaries earlier releases pinned, leaving downloads in flight alone",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        const stale = bytes("jieba 2.3");
        const inFlight = `${"9".repeat(64)}.f1e2.part`;
        device.files(SEGMENTER.id).set("0123.wasm", stale);
        device.files(SEGMENTER.id).set(inFlight, stale);
        await using service = await open(SEGMENTER, device);

        await service.install();

        expect(device.names(SEGMENTER.id)).toEqual([CACHED, inFlight].sort());
      }),
  );
});

describe("two Managed Binaries on one device", () => {
  it.effect("keep separate stores and statuses", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using segmenter = await open(SEGMENTER, device);
      await using other = await open(OTHER, device);

      await segmenter.install();

      expect(segmenter.getStatus()).toMatchObject({ kind: "installed" });
      expect(other.getStatus()).toEqual({ kind: "absent" });
      expect(device.names(OTHER.id)).toEqual([]);

      await other.install();
      expect(device.names(SEGMENTER.id)).toEqual([CACHED]);
      expect(device.names(OTHER.id)).toEqual([`${OTHER.pin.sha256}.wasm`]);

      await segmenter.uninstall();

      expect(segmenter.getStatus()).toEqual({ kind: "absent" });
      expect(other.getStatus()).toMatchObject({ kind: "installed" });
      expect(device.names(OTHER.id)).toEqual([`${OTHER.pin.sha256}.wasm`]);
    }),
  );

  it.effect("remember a declined offer for each binary on its own", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      {
        await using segmenter = await open(SEGMENTER, device);
        segmenter.decline();
      }

      await using segmenter = await open(SEGMENTER, device);
      await using other = await open(OTHER, device);

      expect(segmenter.getStatus()).toEqual({ kind: "declined" });
      expect(other.getStatus()).toEqual({ kind: "absent" });
    }),
  );
});
