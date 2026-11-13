// Uploads the recordings' videos the media store lacks, before a deploy that
// plays them from there (see src/lib/media-store.ts). Each object key carries
// the file's content hash, so a key in the bucket already holds these bytes:
// the script sends only the missing keys, and a second run sends nothing.
//
//   node scripts/upload-media.ts [--dry-run]
//
// It talks to R2 through its S3-compatible API with a bucket-scoped key pair:
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID. With
// --dry-run it uploads nothing and prints each key with what a real run does
// with it; without credentials it lists every key as not checked.

import { AwsClient } from "aws4fetch";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  mediaBucket,
  mediaCacheControl,
  mediaContentType,
  scanVideos,
} from "../src/lib/media-store.ts";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
});
const dryRun = values["dry-run"];

const videos = scanVideos(resolve(import.meta.dirname, ".."));
if (videos.length === 0) {
  throw new Error(
    "No videos under public/img/learn or public/img/landing. Is Git LFS checked out?",
  );
}

const {
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
  CLOUDFLARE_ACCOUNT_ID: accountId,
} = process.env;

if (!accessKeyId || !secretAccessKey || !accountId) {
  if (!dryRun) {
    throw new Error(
      "Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID, or pass --dry-run.",
    );
  }
  for (const video of videos) console.log(`not checked  ${video.key}`);
  console.log(
    `${videos.length} keys; the bucket was not checked (no credentials).`,
  );
  process.exit(0);
}

const r2 = new AwsClient({
  accessKeyId,
  secretAccessKey,
  service: "s3",
  region: "auto",
});
const objectUrl = (key: string) =>
  `https://${accountId}.r2.cloudflarestorage.com/${mediaBucket}/${key}`;

let missing = 0;
for (const video of videos) {
  const head = await r2.fetch(objectUrl(video.key), { method: "HEAD" });
  if (head.ok) {
    console.log(`present      ${video.key}`);
    continue;
  }
  if (head.status !== 404) {
    throw new Error(`HEAD ${video.key} answered ${head.status}.`);
  }
  missing++;
  if (dryRun) {
    console.log(`would upload ${video.key}`);
    continue;
  }
  const put = await r2.fetch(objectUrl(video.key), {
    method: "PUT",
    body: readFileSync(video.file),
    headers: {
      "Content-Type": mediaContentType,
      "Cache-Control": mediaCacheControl,
    },
  });
  if (!put.ok) {
    throw new Error(
      `PUT ${video.key} answered ${put.status}: ${await put.text()}`,
    );
  }
  console.log(`uploaded     ${video.key}`);
}
console.log(
  `${videos.length} keys, ${missing} ${dryRun ? "missing" : "uploaded"}.`,
);
