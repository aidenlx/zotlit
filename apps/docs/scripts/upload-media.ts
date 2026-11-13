// Uploads the recordings' videos the media store lacks, before a deploy that
// plays them from there (see src/lib/media-store.ts). Each object key carries
// the file's content hash, so a key in the bucket already holds these bytes:
// a run sends only the missing keys, and a second run sends nothing.

import { AwsClient } from "aws4fetch";
import { resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  mediaBucket,
  mediaCacheControl,
  mediaContentType,
  scanVideos,
  uploadMissing,
} from "../src/lib/media-store.ts";

const credentials = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

const { dryRun } = await yargs(hideBin(process.argv))
  .scriptName("upload-media.ts")
  .usage(
    "$0 [--dry-run]\n\nUpload the lesson and landing MP4s under public/img that the media store lacks.",
  )
  .option("dry-run", {
    describe:
      "Upload nothing: print each key and whether a real run uploads it; without credentials, list every key as not checked",
    type: "boolean",
    default: false,
  })
  .epilogue(
    [
      `Bucket: ${mediaBucket}, through R2's S3 API. Each object is uploaded with Content-Type: ${mediaContentType} and Cache-Control: ${mediaCacheControl}.`,
      `Credentials, from the environment: ${credentials.join(", ")} (the S3 key pair of a token with Workers R2 Storage Bucket Item Read and Write on ${mediaBucket}).`,
      "A HEAD that answers other than 200 or 404, or a failed PUT, ends the run with an error.",
    ].join("\n"),
  )
  .strict()
  .version(false)
  .parse();

const packageRoot = resolve(import.meta.dirname, "..");
const videos = scanVideos(packageRoot);
if (videos.length === 0) {
  throw new Error(
    "No videos under public/img/learn or public/img/landing. Is Git LFS checked out?",
  );
}

const [accessKeyId, secretAccessKey, accountId] = credentials.map(
  (name) => process.env[name],
);
if (!accessKeyId || !secretAccessKey || !accountId) {
  if (!dryRun) {
    throw new Error(`Set ${credentials.join(", ")}, or pass --dry-run.`);
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
const results = await uploadMissing(videos, {
  fetch: (url, init) => r2.fetch(url, init),
  accountId,
  dryRun,
});
for (const { key, state } of results) console.log(`${state.padEnd(12)} ${key}`);
const sent = results.filter((r) => r.state !== "present").length;
console.log(
  `${videos.length} keys, ${sent} ${dryRun ? "missing" : "uploaded"}.`,
);
