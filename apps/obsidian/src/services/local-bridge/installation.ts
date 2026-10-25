// The installation id: a random id naming this vault on this device, which the
// grant carries so the page can key its drafts. It is device state, never a
// path and never a secret — see `policies/local-storage.md`.

import { Effect } from "effect";

import { DeviceStorage } from "@/lib/obsidian-device-storage";

import { randomHex } from "./random";

const STORAGE_KEY = "zotlit-local-bridge-installation";

/** 128 bits of randomness — long enough that two devices sharing a synced vault
 *  never mint the same id. */
const INSTALLATION_ID_BYTES = 16;

/**
 * The id this device uses for this vault, minted and stored on first read. A
 * record that is not a non-empty string reads as no id at all and is replaced,
 * so a corrupted entry costs the page its drafts rather than the connection.
 * A store Obsidian cannot read or write costs the same: the minted id holds
 * for this load only.
 */
export const loadInstallationId = Effect.gen(function* () {
  const storage = yield* DeviceStorage;
  const minted = randomHex(INSTALLATION_ID_BYTES);
  return yield* Effect.gen(function* () {
    const held = yield* storage.load(STORAGE_KEY);
    if (typeof held === "string" && held.length > 0) return held;
    yield* storage.save(STORAGE_KEY, minted);
    return minted;
  }).pipe(
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning("Could not keep the installation id").pipe(
          Effect.annotateLogs({ operation: error.operation }),
        ),
        minted,
      ),
    ),
  );
}).pipe(Effect.withSpan("LocalBridge.loadInstallationId"));
