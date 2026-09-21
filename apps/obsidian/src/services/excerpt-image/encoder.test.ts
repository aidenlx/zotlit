import { expect, it, vi } from "vitest";

import { losslessWebp } from "./__fixtures__/webp";
import { encodeLosslessWebp, MAX_WEBP_DIMENSION } from "./encoder";

it("requests native lossless WebP with literal quality 1 and preserves dimensions", async () => {
  const canvas = {
    width: 2,
    height: 2,
    toBlob: vi.fn(
      (callback: (blob: Blob) => void, type: string, quality: number) => {
        expect(type).toBe("image/webp");
        expect(quality).toBe(1);
        callback(new Blob([losslessWebp.buffer as ArrayBuffer], { type }));
      },
    ),
  };
  await expect(encodeLosslessWebp(canvas)).resolves.toMatchObject({
    format: "webp",
    mimeType: "image/webp",
    extension: "webp",
    width: 2,
    height: 2,
  });
  expect(canvas.toBlob).toHaveBeenCalledOnce();
});

it("rejects dimensions that native WebP silently crops", async () => {
  const toBlob = vi.fn();
  await expect(
    encodeLosslessWebp({
      width: MAX_WEBP_DIMENSION + 1,
      height: 1,
      toBlob,
    }),
  ).rejects.toThrow("WebP limits");
  expect(toBlob).not.toHaveBeenCalled();
});

it("rejects a MIME or codec mismatch before publication", async () => {
  const wrongMime = {
    width: 2,
    height: 2,
    toBlob(callback: (blob: Blob) => void) {
      callback(
        new Blob([losslessWebp.buffer as ArrayBuffer], { type: "image/png" }),
      );
    },
  };
  await expect(encodeLosslessWebp(wrongMime)).rejects.toThrow("MIME");
  const lossy = {
    width: 2,
    height: 2,
    toBlob(callback: (blob: Blob) => void) {
      callback(
        new Blob(
          [
            new Uint8Array([
              82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0,
              0, 0,
            ]).buffer as ArrayBuffer,
          ],
          { type: "image/webp" },
        ),
      );
    },
  };
  await expect(encodeLosslessWebp(lossy)).rejects.toThrow("non-lossless");
});
