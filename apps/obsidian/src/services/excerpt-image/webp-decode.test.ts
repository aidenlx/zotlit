import { expect, it, vi } from "vitest";

import { losslessWebp } from "./__fixtures__/webp";
import { decodeWebpPixels, verifyWebpDecodes } from "./webp-decode";

it("uses the native decoder and closes the frame before the decoder", async () => {
  const closed: string[] = [];
  class FakeImageDecoder {
    tracks = { ready: Promise.resolve() };

    async decode() {
      return {
        image: {
          codedWidth: 2,
          codedHeight: 2,
          allocationSize: () => 16,
          async copyTo(destination: Uint8Array) {
            destination.fill(7);
          },
          close() {
            closed.push("frame");
          },
        },
      };
    }

    close() {
      closed.push("decoder");
    }
  }
  using _globals = {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
  vi.stubGlobal("ImageDecoder", FakeImageDecoder);
  await expect(decodeWebpPixels(losslessWebp)).resolves.toEqual({
    width: 2,
    height: 2,
    data: new Uint8Array(16).fill(7),
  });
  expect(closed).toEqual(["frame", "decoder"]);
});

it("rejects a decoder result outside the bounded RGBA contract", async () => {
  class FakeImageDecoder {
    tracks = { ready: Promise.resolve() };

    async decode() {
      return {
        image: {
          codedWidth: 2,
          codedHeight: 2,
          allocationSize: () => 15,
          copyTo: async () => {},
          close() {},
        },
      };
    }

    close() {}
  }
  using _globals = {
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
    },
  };
  vi.stubGlobal("ImageDecoder", FakeImageDecoder);
  await expect(decodeWebpPixels(losslessWebp)).rejects.toThrow(
    "unexpected RGBA allocation",
  );
});

it("verifies dimensions and decoded byte count at the validation seam", async () => {
  const decode = vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8Array(16),
  }));
  await expect(
    verifyWebpDecodes(losslessWebp, decode),
  ).resolves.toBeUndefined();
  expect(decode).toHaveBeenCalledOnce();
});
