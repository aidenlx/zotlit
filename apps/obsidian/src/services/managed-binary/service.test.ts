import { it } from "@effect/vitest";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { describe, expect, vi } from "vitest";

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
        await using opened = await open(SEGMENTER, device, download);
        const { service, handle } = opened;
        expect(handle.runSync(service.getStatus)).toEqual({ kind: "absent" });
        expect(download).not.toHaveBeenCalled();

        await handle.runPromise(service.install);

        expect(download).toHaveBeenCalledWith(SEGMENTER.pin.url);
        expect(device.names(SEGMENTER.id)).toEqual([CACHED]);
        expect(device.files(SEGMENTER.id).get(CACHED)).toEqual(
          SEGMENTER_BINARY,
        );
        expect(handle.runSync(service.getStatus)).toEqual({
          kind: "installed",
          version: SEGMENTER.pin.version,
          binary: { directory: "chinese-segmenter", name: CACHED },
        });
      }),
  );

  it.effect("reports no readable binary while a first install runs", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using opened = await open(SEGMENTER, device);
      const { service, handle } = opened;

      const done = handle.runPromise(service.install);

      expect(handle.runSync(service.getStatus)).toEqual({
        kind: "installing",
        done: expect.anything(),
        binary: null,
      });
      await done;
    }),
  );

  it.effect("keeps the installed binary readable while a reinstall runs", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      await using opened = await open(SEGMENTER, device);
      const { service, handle } = opened;
      await handle.runPromise(service.install);
      const installed = { directory: "chinese-segmenter", name: CACHED };

      const done = handle.runPromise(service.install);

      expect(handle.runSync(service.getStatus)).toEqual({
        kind: "installing",
        done: expect.anything(),
        binary: installed,
      });
      await done;
      expect(handle.runSync(service.getStatus)).toEqual({
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
      await using opened = await open({ ...SEGMENTER, createEngine }, device);
      const { service, handle } = opened;
      await handle.runPromise(service.install);

      await handle.runPromise(service.getEngine);

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
        await using opened = await open(
          { ...SEGMENTER, createEngine, startOnInstall: true },
          device,
          download,
        );
        const { service, handle } = opened;

        const first = handle.runPromise(service.install);
        await starting.promise;
        const second = handle.runPromise(service.install);
        const during = handle.runSync(service.getStatus).kind;
        release.resolve();
        await Promise.all([first, second]);

        expect(during).toBe("installing");
        expect(download).toHaveBeenCalledOnce();
        expect(createEngine).toHaveBeenCalledOnce();
        expect(disposed).toBe(1);
        expect(handle.runSync(service.getStatus)).toEqual({
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
        await using opened = await open(
          { ...SEGMENTER, pin: { ...SEGMENTER.pin, sha256: expected } },
          device,
        );
        const { service, handle } = opened;

        await expect(handle.runPromise(service.install)).rejects.toThrow();

        expect(handle.runSync(service.getStatus)).toEqual({
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
          first.handle.runSync(first.service.decline);
          expect(first.handle.runSync(first.service.getStatus)).toEqual({
            kind: "declined",
          });
        }

        await using restarted = await open(SEGMENTER, device);
        expect(restarted.handle.runSync(restarted.service.getStatus)).toEqual({
          kind: "declined",
        });

        await restarted.handle.runPromise(restarted.service.install);
        await restarted.handle.runPromise(restarted.service.uninstall);
        expect(restarted.handle.runSync(restarted.service.getStatus)).toEqual({
          kind: "absent",
        });
      }),
  );

  it.effect(
    "clears its directory on uninstall and offers the install again",
    () =>
      Effect.promise(async () => {
        const device = memoryDevice();
        await using opened = await open(SEGMENTER, device);
        const { service, handle } = opened;
        await handle.runPromise(service.install);

        await handle.runPromise(service.uninstall);

        expect(device.names(SEGMENTER.id)).toEqual([]);
        expect(handle.runSync(service.getStatus)).toEqual({ kind: "absent" });
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
        await using opened = await open(SEGMENTER, device);
        const { service, handle } = opened;

        await handle.runPromise(service.install);

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

      await segmenter.handle.runPromise(segmenter.service.install);

      expect(
        segmenter.handle.runSync(segmenter.service.getStatus),
      ).toMatchObject({ kind: "installed" });
      expect(other.handle.runSync(other.service.getStatus)).toEqual({
        kind: "absent",
      });
      expect(device.names(OTHER.id)).toEqual([]);

      await other.handle.runPromise(other.service.install);
      expect(device.names(SEGMENTER.id)).toEqual([CACHED]);
      expect(device.names(OTHER.id)).toEqual([`${OTHER.pin.sha256}.wasm`]);

      await segmenter.handle.runPromise(segmenter.service.uninstall);

      expect(segmenter.handle.runSync(segmenter.service.getStatus)).toEqual({
        kind: "absent",
      });
      expect(other.handle.runSync(other.service.getStatus)).toMatchObject({
        kind: "installed",
      });
      expect(device.names(OTHER.id)).toEqual([`${OTHER.pin.sha256}.wasm`]);
    }),
  );

  it.effect("remember a declined offer for each binary on its own", () =>
    Effect.promise(async () => {
      const device = memoryDevice();
      {
        await using segmenter = await open(SEGMENTER, device);
        segmenter.handle.runSync(segmenter.service.decline);
      }

      await using segmenter = await open(SEGMENTER, device);
      await using other = await open(OTHER, device);

      expect(segmenter.handle.runSync(segmenter.service.getStatus)).toEqual({
        kind: "declined",
      });
      expect(other.handle.runSync(other.service.getStatus)).toEqual({
        kind: "absent",
      });
    }),
  );
});
