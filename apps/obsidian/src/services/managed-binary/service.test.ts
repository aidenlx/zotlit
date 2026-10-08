import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ManagedBinaryService } from "./service";
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
  return new ManagedBinaryService(binary, {
    openStore: device.openStore,
    consent: device.consent,
    download,
  });
}

const CACHED = `${SEGMENTER.pin.sha256}.wasm`;

describe("ManagedBinaryService with a bare .wasm pin", () => {
  it("caches the downloaded binary under its own hash in its own directory", async () => {
    const device = memoryDevice();
    const download = serve(SEGMENTER);
    await using service = open(SEGMENTER, device, download);
    await service.ready;
    expect(service.getStatus()).toEqual({ kind: "absent" });
    expect(download).not.toHaveBeenCalled();

    await service.install();

    expect(download).toHaveBeenCalledWith(SEGMENTER.pin.url);
    expect(device.names(SEGMENTER.id)).toEqual([CACHED]);
    expect(device.files(SEGMENTER.id).get(CACHED)).toEqual(SEGMENTER_BINARY);
    expect(service.getStatus()).toEqual({
      kind: "installed",
      version: SEGMENTER.pin.version,
    });
  });

  it("hands the cached bytes to its engine factory", async () => {
    const device = memoryDevice();
    const createEngine = vi.fn((_binary: Blob) =>
      Promise.resolve(disposable()),
    );
    await using service = open({ ...SEGMENTER, createEngine }, device);
    await service.ready;
    await service.install();

    await service.getEngine();

    const [passed] = createEngine.mock.calls[0]!;
    expect(new Uint8Array(await passed.arrayBuffer())).toEqual(
      SEGMENTER_BINARY,
    );
  });

  it("shares one install, its engine start included, with an install during the start", async () => {
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
    await using service = open(
      { ...SEGMENTER, createEngine, startOnInstall: true },
      device,
      download,
    );
    await service.ready;

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
    });
  });

  it("reports a binary that does not match the pin, and caches nothing", async () => {
    const device = memoryDevice();
    const expected = "f".repeat(64);
    await using service = open(
      { ...SEGMENTER, pin: { ...SEGMENTER.pin, sha256: expected } },
      device,
    );
    await service.ready;

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
  });

  it("remembers a declined offer across restarts, and forgets it on install", async () => {
    const device = memoryDevice();
    {
      await using first = open(SEGMENTER, device);
      await first.ready;
      first.decline();
      expect(first.getStatus()).toEqual({ kind: "declined" });
    }

    await using restarted = open(SEGMENTER, device);
    await restarted.ready;
    expect(restarted.getStatus()).toEqual({ kind: "declined" });

    await restarted.install();
    await restarted.uninstall();
    expect(restarted.getStatus()).toEqual({ kind: "absent" });
  });

  it("clears its directory on uninstall and offers the install again", async () => {
    const device = memoryDevice();
    await using service = open(SEGMENTER, device);
    await service.ready;
    await service.install();

    await service.uninstall();

    expect(device.names(SEGMENTER.id)).toEqual([]);
    expect(service.getStatus()).toEqual({ kind: "absent" });
  });

  it("drops binaries earlier releases pinned, leaving downloads in flight alone", async () => {
    const device = memoryDevice();
    const stale = bytes("jieba 2.3");
    const inFlight = `${"9".repeat(64)}.f1e2.part`;
    device.files(SEGMENTER.id).set("0123.wasm", stale);
    device.files(SEGMENTER.id).set(inFlight, stale);
    await using service = open(SEGMENTER, device);
    await service.ready;

    await service.install();

    expect(device.names(SEGMENTER.id)).toEqual([CACHED, inFlight].sort());
  });
});

describe("two Managed Binaries on one device", () => {
  it("keep separate stores and statuses", async () => {
    const device = memoryDevice();
    await using segmenter = open(SEGMENTER, device);
    await using other = open(OTHER, device);
    await Promise.all([segmenter.ready, other.ready]);

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
  });

  it("remember a declined offer for each binary on its own", async () => {
    const device = memoryDevice();
    {
      await using segmenter = open(SEGMENTER, device);
      await segmenter.ready;
      segmenter.decline();
    }

    await using segmenter = open(SEGMENTER, device);
    await using other = open(OTHER, device);
    await Promise.all([segmenter.ready, other.ready]);

    expect(segmenter.getStatus()).toEqual({ kind: "declined" });
    expect(other.getStatus()).toEqual({ kind: "absent" });
  });
});
