import { Eta } from "eta/core";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gt, prerelease } from "semver";

import {
  HOST_NOTES,
  parseRepository,
  UPDATE_BETA_JSON,
  UPDATE_JSON,
  xpiDownloadUrl,
  xpiName,
} from "./release-constants.ts";

/**
 * Generate the Mozilla-format Zotero auto-update manifest(s) into `dist/` from
 * the freshly built XPI. Run after `vite build` in the release workflow, which
 * first downloads the current `update*.json` from the rolling `release` host
 * into `dist/` so the version-gate below can compare against them:
 *
 *   node apps/zotero/scripts/build-update-json.ts
 *
 * Each channel file holds a single entry and is written via a **version-gated
 * read-modify-write**: this build's entry replaces the existing one only when
 * `semver.gt(thisVersion, existingEntry)`, otherwise the CI-downloaded file is
 * left in place for the `--clobber` re-upload. This keeps a stable patch
 * (`2.0.1`) from clobbering an active beta (`2.1.0-beta.3`) in
 * `update-beta.json` regardless of which workflow run finishes last.
 *
 * - `update-beta.json` (stable + prerelease channel) is a candidate every run.
 * - `update.json` (stable channel) is a candidate on stable versions only, so a
 *   prerelease never touches the stable channel.
 * - `release-host-notes.md` ({@link HOST_NOTES}) is the markdown body CI applies
 *   to the rolling `release` host, refreshed with this run's version + channels.
 * - In CI, the `attest` step output lists exactly the files this run built (the
 *   XPI plus any channel file actually rewritten) so provenance never attests a
 *   carried-forward manifest.
 *
 * @see https://extensionworkshop.com/documentation/manage/updating-your-extension/
 */

interface UpdateManifest {
  addons: Record<
    string,
    {
      updates: Array<{
        version: string;
        update_link: string;
        update_hash: string;
        applications: {
          zotero: {
            strict_min_version?: string;
            strict_max_version?: string;
          };
        };
      }>;
    }
  >;
}

const scriptDir = import.meta.dirname;
const appRoot = resolve(scriptDir, "..");
const distDir = join(appRoot, "dist");

const pkg = JSON.parse(
  await readFile(join(appRoot, "package.json"), "utf-8"),
) as {
  version: string;
  zotero: {
    id: string;
    strict_min_version?: string;
    strict_max_version?: string;
  };
};
const rootPkg = JSON.parse(
  await readFile(resolve(appRoot, "..", "..", "package.json"), "utf-8"),
) as { repository?: unknown };

const { version, zotero } = pkg;
const repo = parseRepository(rootPkg.repository);

const xpiPath = join(distDir, xpiName(version));
const hash = createHash("sha512")
  .update(await readFile(xpiPath))
  .digest("hex");

const manifest: UpdateManifest = {
  addons: {
    [zotero.id]: {
      updates: [
        {
          version,
          update_link: xpiDownloadUrl(repo, version),
          update_hash: `sha512:${hash}`,
          applications: {
            zotero: {
              ...(zotero.strict_min_version && {
                strict_min_version: zotero.strict_min_version,
              }),
              ...(zotero.strict_max_version && {
                strict_max_version: zotero.strict_max_version,
              }),
            },
          },
        },
      ],
    },
  },
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const isPrerelease = prerelease(version) !== null;

/** Channel files this run actually (re)wrote — basis for host notes + provenance. */
const written: string[] = [];

if (await writeIfNewer(UPDATE_BETA_JSON, serialized)) {
  written.push(UPDATE_BETA_JSON);
}
if (!isPrerelease && (await writeIfNewer(UPDATE_JSON, serialized))) {
  written.push(UPDATE_JSON);
}

await writeFile(join(distDir, HOST_NOTES), await renderHostNotes(written));
await emitAttestPaths(written);

const channels = written.length
  ? written.join(" + ")
  : "no channels (existing entries newer)";
console.log(`Wrote ${channels} + ${HOST_NOTES} for ${zotero.id}@${version}`);

/**
 * Write `serialized` to `dist/{file}` only when this build's version is strictly
 * newer than the entry already there (a CI-downloaded carry-forward, if any).
 * A missing/unparseable file counts as "no existing entry" → write.
 *
 * @returns whether the file was (re)written this run.
 */
async function writeIfNewer(file: string, body: string): Promise<boolean> {
  const existing = await readEntryVersion(file);
  if (existing && !gt(version, existing)) return false;
  await writeFile(join(distDir, file), body);
  return true;
}

/** Version of the addon's single update entry in an existing `dist/{file}`, or `null`. */
async function readEntryVersion(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(join(distDir, file), "utf-8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as UpdateManifest;
  return parsed.addons?.[zotero.id]?.updates?.[0]?.version ?? null;
}

/**
 * In CI, emit the `attest` step output (multiline): paths this run built, for
 * build-provenance. Always the XPI; plus only the channel files rewritten this
 * run, so a carried-forward `update-beta.json` is never re-attested.
 */
async function emitAttestPaths(rewritten: string[]): Promise<void> {
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) return;
  const rel = (f: string): string => `apps/zotero/dist/${f}`;
  const paths = [rel(xpiName(version)), ...rewritten.map(rel)];
  await appendFile(outFile, `attest<<EOF\n${paths.join("\n")}\nEOF\n`);
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Render the markdown body for the rolling `release` GitHub release that hosts
 * the update manifests, from the sibling `release-host-notes.eta` template. CI
 * refreshes the host's notes from this on every run, so the timestamp, version,
 * and touched channel describe exactly what this run just wrote.
 */
async function renderHostNotes(rewritten: string[]): Promise<string> {
  const eta = new Eta();
  const template = await readFile(
    join(scriptDir, "release-host-notes.eta"),
    "utf-8",
  );
  const refreshed = rewritten.length
    ? `${rewritten.map((f) => `\`${f}\``).join(" + ")}`
    : "no channels (existing entries were newer)";
  const compat = zotero.strict_max_version
    ? `${zotero.strict_min_version} – ${zotero.strict_max_version}`
    : zotero.strict_min_version
      ? `${zotero.strict_min_version}+`
      : null;

  return eta.renderString(template, {
    updateJson: UPDATE_JSON,
    updateBetaJson: UPDATE_BETA_JSON,
    addonId: zotero.id,
    compat,
    version,
    refreshedAt: new Date().toISOString(),
    refreshed,
  });
}
