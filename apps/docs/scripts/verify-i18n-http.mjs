// Built-Worker HTTP checks. Preview and fetch share this process and network namespace.
// Run after the production-line build has completed:
//   pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs
// A --config path (relative to the repository root) or DOCS_HTTP_VITE_CONFIG
// can select an environment-specific Vite config. Evidence stays in .scratch.
// All discovered English pages and their Chinese locale routes are checked.
// Add --expected-html <count> to require a specific English page count.
// This checks HTTP output. It does not run a browser or test hydration.
import { Temporal } from "@js-temporal/polyfill";
import { regex } from "arkregex";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import englishMessages from "../../../messages/en.json" with { type: "json" };
import chineseMessages from "../../../messages/zh-CN.json" with { type: "json" };
import { scanChinesePages } from "../src/lib/content-scan.ts";

const optionConstraints = {
  port: {
    minimum: 0,
    maximum: 65_535,
    default: "0",
    describe: "Preview port; 0 uses an OS-assigned port",
  },
  concurrency: {
    minimum: 1,
    maximum: 8,
    default: "4",
    describe: "Concurrent HTTP requests",
  },
  "expected-html": {
    minimum: 1,
    maximum: 10_000,
    describe: "Require this many discovered English HTML pages",
  },
  "expected-redirects": {
    minimum: 1,
    maximum: 2_000,
    default: "54",
    describe: "Require this many legacy redirect rules",
  },
};
const limitations = [
  "Locale editions follow native Chinese file presence; copy quality is not checked.",
  "No external redirect destinations are fetched; live GitHub facts are not verified.",
  "Browser hydration, interaction, clipboard, and fragments are not tested.",
];
const configEnvironment = "DOCS_HTTP_VITE_CONFIG";
const values = yargs(hideBin(process.argv))
  .scriptName("verify-i18n-http")
  .usage("$0 [options]")
  .strict()
  .version(false)
  .option("config", {
    type: "string",
    describe: `Vite config relative to the workspace root (or $${configEnvironment})`,
  })
  .option("output", {
    type: "string",
    default: ".scratch/i18n-poc/http-matrix.json",
    describe: "JSON evidence path relative to the workspace root",
  })
  .options(
    Object.fromEntries(
      Object.entries(optionConstraints).map(([name, constraint]) => [
        name,
        {
          type: "string",
          describe: constraint.describe,
          ...(constraint.default === undefined
            ? {}
            : { default: constraint.default }),
        },
      ]),
    ),
  )
  .check((args) => {
    for (const [name, { minimum, maximum }] of Object.entries(
      optionConstraints,
    )) {
      const value = args[name];
      if (value === undefined) continue;
      const number = Number(value);
      if (
        typeof value !== "string" ||
        !value.trim() ||
        !Number.isInteger(number) ||
        number < minimum ||
        number > maximum
      ) {
        throw new Error(
          `--${name} must be an integer from ${minimum} to ${maximum}.`,
        );
      }
    }
    return true;
  })
  .epilogue(
    [
      "Run after a production-line build. Preview and HTTP fetch share one process.",
      "Numeric option ranges:",
      ...Object.entries(optionConstraints).map(
        ([name, { minimum, maximum }]) =>
          `  --${name}: ${minimum} to ${maximum}`,
      ),
      ...limitations,
    ].join("\n"),
  )
  .help()
  .parseSync();

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const clientRoot = join(packageRoot, "dist/client");
const chinesePages = new Set([
  ...scanChinesePages(packageRoot),
  "/",
  "/community",
  "/workbench",
  "/blog",
  "/changelog",
]);
const configFile = resolve(
  workspaceRoot,
  values.config ??
    process.env[configEnvironment] ??
    join(packageRoot, "vite.config.ts"),
);
const outputPath = resolve(workspaceRoot, values.output);
const concurrency = Number(values.concurrency);
const port = Number(values.port);
const expectedHtml =
  values["expected-html"] === undefined
    ? null
    : Number(values["expected-html"]);
const expectedRedirects = Number(values["expected-redirects"]);
const startedAt = Temporal.Now.instant().toString();
const started = performance.now();
const publicOrigin = "https://zotlit.aidenlx.site";
const betaOrigin = "https://zotlit-beta.aidenlx.site";
const legacyOrigin = "https://zotlit-v1.aidenlx.site";
const incomingQuery =
  "?probe=http-matrix&from=incoming&src=%2Fdo-not-use&lang=fr";
const evidence = {
  schemaVersion: 1,
  startedAt,
  node: process.version,
  method: "Vite preview plus native HTTP fetch in one Node process; no browser",
  limitations,
  configFile: relative(workspaceRoot, configFile),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim(),
  inventory: {},
  groups: {},
  checks: [],
  requests: [],
};
let origin;
let requestId = 0;

const hash = (text) => createHash("sha256").update(text).digest("hex");
const chinesePath = (path) => `/zh-CN${path === "/" ? "" : path}`;
const englishPath = (path) => path.replace(/^\/zh-CN(?=\/|$)/, "") || "/";
const decode = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

function check(group, label, { passed, actual, expected }) {
  const entry = {
    group,
    label,
    passed: Boolean(passed),
    ...(actual === undefined ? {} : { actual }),
    ...(expected === undefined ? {} : { expected }),
  };
  evidence.checks.push(entry);
  const stats = (evidence.groups[group] ??= { passed: 0, failed: 0 });
  stats[entry.passed ? "passed" : "failed"]++;
  if (!entry.passed)
    console.error(
      `FAIL [${group}] ${label}: ${JSON.stringify({ actual, expected })}`,
    );
  return entry.passed;
}

async function parallel(items, work) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        await work(item);
      }
    }),
  );
}

async function phase(name, work) {
  const before = evidence.checks.length;
  console.log(`START ${name}`);
  try {
    await work();
  } catch (error) {
    check(name, "phase completed", {
      passed: false,
      actual: error.stack ?? String(error),
      expected: "no exception",
    });
  }
  const checks = evidence.checks.slice(before);
  console.log(
    `END ${name}: ${checks.filter((item) => item.passed).length}/${checks.length} checks passed`,
  );
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(
    regex(
      "(?<name>[^\\s=<>/]+)\\s*=\\s*(?:\"(?<double>[^\"]*)\"|'(?<single>[^']*)'|(?<bare>[^\\s>]+))",
      "g",
    ),
  )) {
    const { name, double, single, bare } = match.groups;
    result[name.toLowerCase()] = decode(double ?? single ?? bare);
  }
  return result;
}

function htmlMetadata(body) {
  const links = [...body.matchAll(/<link\b[^>]*>/gi)].map((match) =>
    attributes(match[0]),
  );
  const metas = [...body.matchAll(/<meta\b[^>]*>/gi)].map((match) =>
    attributes(match[0]),
  );
  return {
    lang: attributes(body.match(/<html\b[^>]*>/i)?.[0] ?? "").lang ?? null,
    title: decode(
      regex("<title[^>]*>(?<title>[\\s\\S]*?)</title>", "i").exec(body)?.groups
        .title ?? "",
    ),
    canonicals: links
      .filter((link) => link.rel === "canonical")
      .map((link) => link.href),
    alternates: links
      .filter((link) => link.rel === "alternate" && link.hreflang)
      .map((link) => ({ locale: link.hreflang, href: link.href })),
    robots: metas
      .filter((meta) => meta.name === "robots")
      .map((meta) => meta.content),
  };
}

function visibleText(body) {
  return decode(
    body
      .replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replaceAll(/<[^>]*>/g, " ")
      .replaceAll("&nbsp;", " "),
  );
}

function contentLinks(html) {
  return [...html.matchAll(/<a\b[^>]*>/gi)]
    .map((match) => attributes(match[0]).href)
    .filter((href) => {
      if (!href || href.startsWith("#")) return false;
      const url = new URL(href, origin);
      const path = englishPath(url.pathname);
      return (
        [origin, publicOrigin].includes(url.origin) &&
        path !== "/changelog/rss.xml" &&
        (path === "/" ||
          /^\/(docs|blog|changelog|community|workbench)(\/|$)/.test(path))
      );
    });
}

async function request(group, path, { method = "GET", headers = {} } = {}) {
  const url = new URL(path, origin);
  if (url.origin !== origin)
    throw new Error(`External network follow prohibited: ${url.href}`);
  const record = {
    id: ++requestId,
    group,
    method,
    url: url.href,
    requestHeaders: { accept: "text/html", ...headers },
    startedAt: Temporal.Now.instant().toString(),
  };
  evidence.requests.push(record);
  const time = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: record.requestHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    Object.assign(record, {
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      headers: Object.fromEntries(response.headers),
      bytes: Buffer.byteLength(body),
      sha256: hash(body),
      durationMs: Math.round(performance.now() - time),
    });
    if (/text\/html/i.test(record.headers["content-type"] ?? ""))
      record.html = htmlMetadata(body);
    if (response.status >= 400) record.bodyExcerpt = body.slice(0, 700);
    return { response, body, record };
  } catch (error) {
    record.error = error.stack ?? String(error);
    record.durationMs = Math.round(performance.now() - time);
    check(group, `${method} ${path} responds`, {
      passed: false,
      actual: String(error),
      expected: "HTTP response",
    });
    return null;
  }
}

function verifyHtml(group, result, path) {
  if (!result) return;
  const { record, body } = result;
  const localized = path === "/zh-CN" || path.startsWith("/zh-CN/");
  const unlocalized = englishPath(path);
  const hasChinese = chinesePages.has(unlocalized);
  const fallback = localized && !hasChinese;
  const uiLocale = localized ? "zh-CN" : "en";
  const messages = localized ? chineseMessages : englishMessages;
  const fallbackNoticeText = messages.docs_locale_fallback;
  const englishActionText = messages.docs_read_in_english;
  const contentLocale = localized && hasChinese ? "zh-CN" : "en";
  const canonicalPath = localized && hasChinese ? path : unlocalized;
  const label = new URL(record.url).pathname;
  check(group, `${label} status`, {
    passed: record.status === 200,
    actual: record.status,
    expected: 200,
  });
  check(group, `${label} remains at requested locale URL`, {
    passed:
      new URL(record.url).pathname === path &&
      !record.redirected &&
      !record.headers.location,
    actual: {
      path: new URL(record.url).pathname,
      location: record.headers.location ?? null,
    },
    expected: path,
  });
  check(group, `${label} HTML content type`, {
    passed: /text\/html/i.test(record.headers["content-type"] ?? ""),
    actual: record.headers["content-type"],
    expected: "text/html",
  });
  if (!record.html) return;
  check(group, `${label} edition content language`, {
    passed: record.html.lang === contentLocale,
    actual: record.html.lang,
    expected: contentLocale,
  });
  check(group, `${label} title`, {
    passed: Boolean(record.html.title),
    actual: record.html.title,
    expected: "non-empty",
  });
  const expectedCanonical = new URL(canonicalPath, publicOrigin).href;
  const canonical = record.html.canonicals;
  check(group, `${label} one edition canonical`, {
    passed:
      canonical.length === 1 &&
      new URL(canonical[0], publicOrigin).href === expectedCanonical,
    actual: canonical,
    expected: [expectedCanonical],
  });
  const chineseAlternates = record.html.alternates.filter(
    (item) => item.locale === "zh-CN",
  );
  check(group, `${label} Chinese alternate follows native file presence`, {
    passed: hasChinese
      ? chineseAlternates.length === 1 &&
        new URL(chineseAlternates[0].href, publicOrigin).href ===
          new URL(chinesePath(unlocalized), publicOrigin).href
      : chineseAlternates.length === 0,
    actual: chineseAlternates,
    expected: hasChinese ? chinesePath(unlocalized) : "no Chinese alternate",
  });
  const englishCanonical = new URL(unlocalized, publicOrigin).href;
  for (const locale of ["en", "x-default"]) {
    check(group, `${label} ${locale} alternate`, {
      passed: record.html.alternates.some(
        (item) =>
          item.locale === locale &&
          new URL(item.href, publicOrigin).href === englishCanonical,
      ),
      actual: record.html.alternates,
      expected: englishCanonical,
    });
  }
  const noindex = record.html.robots.some((value) =>
    /\bnoindex\b/i.test(value),
  );
  check(group, `${label} robots policy`, {
    passed: noindex === (fallback || unlocalized === "/workbench"),
    actual: record.html.robots,
    expected:
      fallback || unlocalized === "/workbench" ? "noindex" : "indexable",
  });
  if (localized) {
    check(group, `${label} fallback HTTP noindex`, {
      passed:
        /\bnoindex\b/i.test(record.headers["x-robots-tag"] ?? "") === fallback,
      actual: record.headers["x-robots-tag"],
      expected: fallback ? "noindex" : "no fallback noindex",
    });
    check(group, `${label} edition Content-Language header`, {
      passed: record.headers["content-language"] === contentLocale,
      actual: record.headers["content-language"],
      expected: contentLocale,
    });
    check(group, `${label} fallback notice follows missing file`, {
      passed: body.includes(fallbackNoticeText) === fallback,
      expected: fallback ? "localized fallback notice" : "no fallback notice",
    });
    let localeLinksBody = body;
    if (fallback) {
      const notices = [
        ...body.matchAll(
          regex(
            "<div\\b[^>]*\\brole=(?:\"note\"|'note')[^>]*>(?<body>[\\s\\S]*?)</div>",
            "gi",
          ),
        ),
      ].filter(
        (match) =>
          attributes(match[0].match(/^<div\b[^>]*>/i)[0]).lang === uiLocale &&
          visibleText(match.groups.body).includes(fallbackNoticeText),
      );
      const actions = notices.flatMap((notice) =>
        [
          ...notice.groups.body.matchAll(
            regex("<a\\b[^>]*>(?<body>[\\s\\S]*?)</a>", "gi"),
          ),
        ].map((anchor) => ({
          notice: notice[0],
          markup: anchor[0],
          attributes: attributes(anchor[0].match(/^<a\b[^>]*>/i)[0]),
          text: visibleText(anchor.groups.body).trim(),
        })),
      );
      const expectedEnglishHref = canonicalPath + new URL(record.url).search;
      const validEnglishAction =
        notices.length === 1 &&
        actions.length === 1 &&
        actions[0].text === englishActionText &&
        actions[0].attributes.href === expectedEnglishHref &&
        actions[0].attributes.target === undefined;
      record.fallbackEnglishActions = actions.map((action) => ({
        text: action.text,
        href: action.attributes.href,
        target: action.attributes.target ?? null,
      }));
      check(
        group,
        `${label} explicit English action preserves path and query`,
        {
          passed: validEnglishAction,
          actual: record.fallbackEnglishActions,
          expected: [
            {
              text: englishActionText,
              href: expectedEnglishHref,
              target: null,
            },
          ],
        },
      );
      // Exempt only this verified anchor, never every link with the same URL.
      localeLinksBody = validEnglishAction
        ? body.replace(
            actions[0].notice,
            actions[0].notice.replace(actions[0].markup, ""),
          )
        : body;
    }
    const internal = contentLinks(localeLinksBody);
    record.internalContentLinks = contentLinks(body);
    check(group, `${label} internal HTML links retain locale`, {
      passed: internal.every((href) =>
        new URL(href, origin).pathname.startsWith("/zh-CN"),
      ),
      actual: internal.filter(
        (href) => !new URL(href, origin).pathname.startsWith("/zh-CN"),
      ),
      expected: "Chinese internal content URLs",
    });
    if (unlocalized === "/docs" || unlocalized.startsWith("/docs/")) {
      const sidebar =
        regex(
          '<aside\\b[^>]*\\bid="nd-sidebar"[^>]*>(?<body>[\\s\\S]*?)</aside>',
          "i",
        ).exec(body)?.groups.body ?? "";
      const links = contentLinks(sidebar);
      check(group, `${label} localized sidebar links`, {
        passed:
          links.length > 0 &&
          links.every((href) =>
            new URL(href, origin).pathname.startsWith("/zh-CN"),
          ),
        actual: {
          count: links.length,
          wrong: links.filter(
            (href) => !new URL(href, origin).pathname.startsWith("/zh-CN"),
          ),
        },
        expected: "non-empty Chinese sidebar",
      });
    }
  } else if (record.headers["content-language"]) {
    check(group, `${label} English Content-Language when present`, {
      passed: record.headers["content-language"] === "en",
      actual: record.headers["content-language"],
      expected: "en",
    });
  }
  if (unlocalized === "/docs" || unlocalized.startsWith("/docs/")) {
    const expected = `${localized ? "/zh-CN" : ""}/llms.mdx${unlocalized}/content.md`;
    const markdownUrls = [
      ...body.matchAll(
        regex("[\"']?markdownUrl[\"']?\\s*:\\s*[\"'](?<url>[^\"']+)[\"']", "g"),
      ),
    ].map((match) => match.groups.url);
    record.loaderMarkdownUrls = markdownUrls;
    check(group, `${label} serialized Markdown action URL`, {
      passed:
        markdownUrls.length > 0 &&
        markdownUrls.every((url) => url === expected),
      actual: markdownUrls,
      expected: expected,
    });
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function main() {
  await using resources = new AsyncDisposableStack();
  if (!existsSync(configFile))
    throw new Error(`Missing preview config: ${configFile}`);
  const redirectText = await readFile(join(clientRoot, "_redirects"), "utf8");
  const rules = redirectText
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [source, destination, status, extra] = line.trim().split(/\s+/);
      if (!source || !destination || !status || extra)
        throw new Error(`Invalid _redirects line: ${line}`);
      return { source, destination, status: Number(status) };
    });
  const htmlFiles = (await walk(clientRoot))
    .map((path) => relative(clientRoot, path).replaceAll("\\", "/"))
    .filter(
      (path) =>
        path.endsWith(".html") &&
        !path.startsWith("assets/") &&
        !path.startsWith("zh-CN/") &&
        path !== "404.html" &&
        path !== "404/index.html",
    )
    .sort();
  const pages = htmlFiles.map((file) =>
    file === "index.html"
      ? "/"
      : `/${file.replace(/\/index\.html$/, "").replace(/\.html$/, "")}`,
  );
  const builtHtml = await Promise.all(
    htmlFiles.map(async (file, index) => ({
      file,
      path: pages[index],
      sha256: hash(await readFile(join(clientRoot, file))),
    })),
  );
  // SSR can conceal a missing locale asset. Inspect the build independently so
  // a native Chinese edition survives Worker quota exhaustion or an outage.
  const nativeAssets = [];
  for (const page of pages.filter((path) => chinesePages.has(path))) {
    const localized = chinesePath(page);
    const htmlFile = join(clientRoot, localized.slice(1), "index.html");
    const html = existsSync(htmlFile) ? await readFile(htmlFile, "utf8") : null;
    const metadata = html === null ? null : htmlMetadata(html);
    check("assets", `${localized} native HTML asset`, {
      passed:
        metadata?.lang === "zh-CN" &&
        metadata.canonicals.length === 1 &&
        metadata.canonicals[0] === new URL(localized, publicOrigin).href,
      actual: metadata,
      expected: {
        lang: "zh-CN",
        canonical: new URL(localized, publicOrigin).href,
      },
    });
    nativeAssets.push({
      path: localized,
      sha256: html === null ? null : hash(html),
    });
    if (!/^\/(?:docs|blog|changelog)(?:\/|$)/.test(page)) continue;
    for (const path of [
      `${localized}.md`,
      `/zh-CN/llms.mdx${page}/content.md`,
    ]) {
      const file = join(clientRoot, path.slice(1));
      const body = existsSync(file) ? await readFile(file, "utf8") : null;
      check("assets", `${path} native Markdown asset`, {
        passed:
          body !== null && body.trim().length > 0 && !/<html\b/i.test(body),
        actual: body === null ? "missing" : `${body.length} characters`,
        expected: "authored Markdown asset",
      });
      nativeAssets.push({ path, sha256: body === null ? null : hash(body) });
    }
  }
  evidence.inventory = {
    redirects: rules,
    redirectFileSha256: hash(redirectText),
    previewConfigSha256: hash(await readFile(configFile)),
    workerEntrySha256: hash(
      await readFile(join(packageRoot, "dist/server/index.js")),
    ),
    workerConfigurationSha256: hash(
      await readFile(join(packageRoot, "dist/server/wrangler.json")),
    ),
    scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    html: builtHtml,
    nativeAssets,
    expectedHtml,
    expectedRedirects,
    chinesePages: [...chinesePages].sort(),
  };
  check("inventory", "redirect count", {
    passed: rules.length === expectedRedirects,
    actual: rules.length,
    expected: expectedRedirects,
  });
  check("inventory", "English prerender HTML inventory is non-empty", {
    passed: pages.length > 0,
    actual: pages.length,
    expected: "at least one English page",
  });
  if (expectedHtml !== null) {
    check("inventory", "English prerender HTML count", {
      passed: pages.length === expectedHtml,
      actual: pages.length,
      expected: expectedHtml,
    });
  }
  check("inventory", "unique redirect sources", {
    passed: new Set(rules.map((rule) => rule.source)).size === rules.length,
  });
  check("inventory", "unique HTML routes", {
    passed: new Set(pages).size === pages.length,
  });
  check("inventory", "all legacy redirects are permanent", {
    passed: rules.every((rule) => rule.status === 308),
  });
  check("inventory", "all redirects have exact non-root legacy sources", {
    passed: rules.every(
      (rule) =>
        !rule.source.includes("*") &&
        !["/", "/zh-CN", "/zh-CN/"].includes(rule.source),
    ),
  });
  check("inventory", "modern locale targets have no redirect rules", {
    passed: pages.every(
      (page) =>
        !rules.some((rule) => [page, chinesePath(page)].includes(rule.source)),
    ),
  });

  process.env.NO_PROXY = `${process.env.NO_PROXY ?? ""},127.0.0.1,localhost`;
  process.env.no_proxy = process.env.NO_PROXY;
  const require = createRequire(join(packageRoot, "package.json"));
  const { preview } = await import(pathToFileURL(require.resolve("vite")).href);
  const previewServer = resources.adopt(
    await preview({
      root: packageRoot,
      configFile,
      logLevel: "warn",
      preview: { host: "127.0.0.1", port, strictPort: true },
    }),
    async (server) => {
      try {
        await server.close();
      } catch (error) {
        check("shutdown", "preview closed", {
          passed: false,
          actual: String(error),
          expected: "clean shutdown",
        });
      }
    },
  );
  const address = previewServer.httpServer.address();
  if (typeof address !== "object" || address === null)
    throw new Error("Preview has no listening TCP address.");
  origin = `http://127.0.0.1:${address.port}`;
  evidence.origin = origin;
  console.log(
    `Preview ${origin}; ${pages.length} English HTML pages; ${rules.length} legacy rules`,
  );

  await phase("legacy", async () => {
    await parallel(rules, async (rule) => {
      for (const { method, query } of [
        { method: "GET", query: "" },
        { method: "GET", query: incomingQuery },
        { method: "HEAD", query: incomingQuery },
      ]) {
        const expected = new URL(rule.destination, origin);
        if (!expected.search) expected.search = query;
        const result = await request("legacy", `${rule.source}${query}`, {
          method,
        });
        if (!result) continue;
        const label = `${method} ${rule.source}${query ? " with incoming query" : ""}`;
        check("legacy", `${label} exact status`, {
          passed: result.record.status === rule.status,
          actual: result.record.status,
          expected: rule.status,
        });
        const actualLocation = result.record.headers.location
          ? new URL(result.record.headers.location, origin).href
          : null;
        check("legacy", `${label} exact destination and query`, {
          passed: actualLocation === expected.href,
          actual: actualLocation,
          expected: expected.href,
        });
        if (expected.origin === origin && method === "GET") {
          const landing = await request(
            "legacy-landing",
            expected.pathname + expected.search,
          );
          verifyHtml("legacy-landing", landing, expected.pathname);
          if (landing)
            check(
              "legacy-landing",
              `${rule.source} completes in one redirect`,
              {
                passed:
                  landing.record.status === 200 &&
                  !landing.record.headers.location,
                actual: landing.record.status,
                expected: 200,
              },
            );
          if (rule.source.startsWith("/zh-CN/"))
            check("legacy-landing", `${rule.source} retains Chinese route`, {
              passed: expected.pathname.startsWith("/zh-CN/"),
              actual: expected.pathname,
              expected: "/zh-CN/…",
            });
        } else if (expected.origin !== origin)
          check("legacy", `${label} exact frozen V1 origin`, {
            passed: expected.origin === legacyOrigin,
            actual: expected.origin,
            expected: legacyOrigin,
          });
      }
    });
  });

  await phase("html", async () => {
    await parallel(
      pages.flatMap((page) => [page, chinesePath(page)]),
      async (path) => verifyHtml("html", await request("html", path), path),
    );
  });

  await phase("slashes", async () => {
    await parallel(
      pages.flatMap((page) => [
        ...(page === "/" ? [] : [page]),
        chinesePath(page),
      ]),
      async (target) => {
        const result = await request("slashes", `${target}/${incomingQuery}`);
        if (!result) return;
        const expected = new URL(target + incomingQuery, origin).href;
        const actual = result.record.headers.location
          ? new URL(result.record.headers.location, origin).href
          : null;
        check("slashes", `${target}/ normalization status`, {
          passed: result.record.status === 307,
          actual: result.record.status,
          expected: 307,
        });
        check("slashes", `${target}/ keeps locale and query`, {
          passed: actual === expected,
          actual: actual,
          expected: expected,
        });
      },
    );
  });

  await phase("markdown", async () => {
    const markdownPages = pages.filter((page) =>
      /^\/(docs|blog|changelog)(\/|$)/.test(page),
    );
    await parallel(
      markdownPages.flatMap((page) => [page, chinesePath(page)]),
      async (path) => {
        const unlocalized = englishPath(path);
        const contentPath = `${path.startsWith("/zh-CN/") ? "/zh-CN" : ""}/llms.mdx${unlocalized}/content.md`;
        const responses = [];
        for (const { url, headers } of [
          { url: `${path}.md`, headers: {} },
          { url: contentPath, headers: {} },
          { url: path, headers: { accept: "text/markdown" } },
        ]) {
          const result = await request("markdown", url, { headers });
          if (!result) continue;
          responses.push(result.record.sha256);
          check(
            "markdown",
            `${url} ${headers.accept ?? "suffix/content"} status`,
            {
              passed: result.record.status === 200,
              actual: result.record.status,
              expected: 200,
            },
          );
          check("markdown", `${url} Markdown content type`, {
            passed: /text\/markdown/i.test(
              result.record.headers["content-type"] ?? "",
            ),
            actual: result.record.headers["content-type"],
            expected: "text/markdown",
          });
          check("markdown", `${url} Markdown body`, {
            passed: /^# /m.test(result.body) && !/<html\b/i.test(result.body),
            actual: result.body.slice(0, 100),
            expected: "Markdown heading without HTML shell",
          });
          if (["/blog", "/changelog"].includes(unlocalized)) {
            const links = [
              ...result.body.matchAll(
                regex("^- \\[[^\\]]+\\]\\((?<url>/[^)]+)\\)", "gm"),
              ),
            ].map((match) => match.groups.url);
            check("markdown", `${url} index links retain requested locale`, {
              passed:
                links.length > 0 &&
                links.every((href) => href.startsWith(`${path}/`)),
              actual: links.filter((href) => !href.startsWith(`${path}/`)),
              expected: `${path}/…`,
            });
          } else {
            check("markdown", `${url} exported page URL retains locale`, {
              passed: result.body.split("\n", 1)[0].includes(`(${path})`),
              actual: result.body.split("\n", 1)[0],
              expected: `heading with (${path})`,
            });
          }
          if (path.startsWith("/zh-CN/")) {
            const fallback = !chinesePages.has(unlocalized);
            check("markdown", `${url} fallback noindex`, {
              passed:
                /\bnoindex\b/.test(
                  result.record.headers["x-robots-tag"] ?? "",
                ) === fallback,
              actual: result.record.headers["x-robots-tag"],
              expected: fallback ? "noindex" : "no fallback noindex",
            });
            const contentLocale = fallback ? "en" : "zh-CN";
            check("markdown", `${url} edition content language`, {
              passed:
                result.record.headers["content-language"] === contentLocale,
              actual: result.record.headers["content-language"],
              expected: contentLocale,
            });
          }
        }
        check("markdown", `${path} suffix/content/Accept body agreement`, {
          passed: responses.length === 3 && new Set(responses).size === 1,
          actual: responses,
          expected: "three equal SHA-256 digests",
        });
      },
    );
  });

  await phase("search", async () => {
    for (const locale of [null, "en", "zh-CN", "fr"]) {
      const path = `/api/search?query=Zotero${locale === null ? "" : `&locale=${locale}`}`;
      const result = await request("search", path, {
        headers: { accept: "application/json" },
      });
      if (!result) continue;
      const expectedStatus = locale === "fr" ? 400 : 200;
      check("search", `${locale ?? "default"} status`, {
        passed: result.record.status === expectedStatus,
        actual: result.record.status,
        expected: expectedStatus,
      });
      let data;
      try {
        data = JSON.parse(result.body);
      } catch {
        check("search", `${locale ?? "default"} JSON body`, {
          passed: false,
          actual: result.body.slice(0, 100),
          expected: "JSON",
        });
        continue;
      }
      if (locale === "fr") {
        check("search", "unsupported locale error", {
          passed: data.error === "Unsupported locale",
          actual: data,
          expected: { error: "Unsupported locale" },
        });
        continue;
      }
      check("search", `${locale ?? "default"} has search results`, {
        passed: Array.isArray(data) && data.length > 0,
        actual: Array.isArray(data) ? data.length : data,
        expected: "non-empty array",
      });
      const pageResults = Array.isArray(data)
        ? data.filter((item) => item.type === "page")
        : [];
      const rootName = locale === "zh-CN" ? "文档" : "Docs";
      check("search", `${locale ?? "default"} root breadcrumb locale`, {
        passed:
          pageResults.length > 0 &&
          pageResults.every((page) => page.breadcrumbs?.[0] === rootName),
        actual: pageResults.map((page) => page.breadcrumbs?.[0]),
        expected: rootName,
      });
      const urls = Array.isArray(data)
        ? data.map((item) => item.url).filter((url) => typeof url === "string")
        : [];
      result.record.searchUrls = urls;
      check("search", `${locale ?? "default"} every result has URL`, {
        passed: urls.length > 0 && urls.length === data.length,
        actual: urls.length,
        expected: data.length,
      });
      const prefix = locale === "zh-CN" ? "/zh-CN/docs" : "/docs";
      check("search", `${locale ?? "default"} result URL locale`, {
        passed: urls.every((url) => {
          const path = new URL(url, origin).pathname;
          return path === prefix || path.startsWith(`${prefix}/`);
        }),
        actual: urls,
        expected: `${prefix}/…`,
      });
    }
  });

  await phase("errors-and-beta", async () => {
    for (const path of [
      "/not-a-page-http-matrix",
      "/docs/not-a-page-http-matrix",
      "/blog/not-a-page-http-matrix",
      "/docs/not-a-page-http-matrix.md",
    ].flatMap((path) => [path, chinesePath(path)])) {
      const result = await request("errors-and-beta", path);
      if (result)
        check("errors-and-beta", `${path} is a direct 404`, {
          passed:
            result.record.status === 404 && !result.record.headers.location,
          actual: {
            status: result.record.status,
            location: result.record.headers.location ?? null,
          },
          expected: { status: 404, location: null },
        });
    }
    for (const path of [
      "/changelog/9999.0.0-http-matrix",
      "/zh-CN/changelog/9999.0.0-http-matrix",
    ]) {
      const result = await request("errors-and-beta", path);
      if (!result) continue;
      check("errors-and-beta", `${path} unknown release is temporary`, {
        passed: result.record.status === 307,
        actual: result.record.status,
        expected: 307,
      });
      check("errors-and-beta", `${path} beta destination retains locale`, {
        passed: result.record.headers.location === `${betaOrigin}${path}`,
        actual: result.record.headers.location,
        expected: `${betaOrigin}${path}`,
      });
      const target = `${path.startsWith("/zh-CN/") ? "/zh-CN" : ""}/llms.mdx/changelog/9999.0.0-http-matrix/content.md`;
      for (const { url, headers } of [
        { url: `${path}.md`, headers: {} },
        { url: target, headers: {} },
        { url: path, headers: { accept: "text/markdown" } },
      ]) {
        const markdown = await request("errors-and-beta", url, { headers });
        if (!markdown) continue;
        check("errors-and-beta", `${url} unknown Markdown status`, {
          passed: markdown.record.status === 307,
          actual: markdown.record.status,
          expected: 307,
        });
        check(
          "errors-and-beta",
          `${url} Markdown beta destination retains locale`,
          {
            passed:
              markdown.record.headers.location === `${betaOrigin}${target}`,
            actual: markdown.record.headers.location,
            expected: `${betaOrigin}${target}`,
          },
        );
      }
    }
  });

  await phase("machine-endpoints", async () => {
    const sitemap = await request("machine-endpoints", "/sitemap.xml", {
      headers: { accept: "application/xml" },
    });
    if (sitemap) {
      check("machine-endpoints", "sitemap status", {
        passed: sitemap.record.status === 200,
        actual: sitemap.record.status,
        expected: 200,
      });
      check("machine-endpoints", "sitemap XML type", {
        passed: /application\/xml/.test(
          sitemap.record.headers["content-type"] ?? "",
        ),
        actual: sitemap.record.headers["content-type"],
        expected: "application/xml",
      });
      const locations = [
        ...sitemap.body.matchAll(regex("<loc>(?<url>[^<]+)</loc>", "g")),
      ].map((match) => decode(match.groups.url));
      sitemap.record.sitemapLocations = locations;
      const expected = new Set(
        pages
          .filter((path) => path !== "/workbench")
          .flatMap((path) => [
            path,
            ...(chinesePages.has(path) ? [chinesePath(path)] : []),
          ])
          .map((path) => new URL(path, publicOrigin).href),
      );
      const actual = new Set(locations.map((url) => new URL(url).href));
      check(
        "machine-endpoints",
        "sitemap contains each existing indexable edition once",
        {
          passed:
            actual.size === locations.length &&
            actual.size === expected.size &&
            [...expected].every((url) => actual.has(url)),
          actual: {
            count: locations.length,
            missing: [...expected].filter((url) => !actual.has(url)),
            extra: [...actual].filter((url) => !expected.has(url)),
          },
          expected: expected.size,
        },
      );
    }
    for (const path of [
      "/robots.txt",
      "/llms.txt",
      "/llms-full.txt",
      "/changelog/rss.xml",
    ]) {
      const result = await request("machine-endpoints", path, {
        headers: { accept: "*/*" },
      });
      if (!result) continue;
      check("machine-endpoints", `${path} status`, {
        passed: result.record.status === 200,
        actual: result.record.status,
        expected: 200,
      });
      check("machine-endpoints", `${path} non-empty non-HTML body`, {
        passed: result.body.trim().length > 30 && !/<html\b/i.test(result.body),
        actual: result.body.slice(0, 100),
        expected: "machine content",
      });
      const type = path.endsWith(".txt") ? "text/plain" : "application/rss+xml";
      check("machine-endpoints", `${path} content type`, {
        passed: result.record.headers["content-type"]?.includes(type),
        actual: result.record.headers["content-type"],
        expected: type,
      });
      if (path === "/robots.txt")
        check("machine-endpoints", "robots points to canonical sitemap", {
          passed: result.body.includes(`Sitemap: ${publicOrigin}/sitemap.xml`),
        });
      if (path.startsWith("/llms"))
        check("machine-endpoints", `${path} includes docs links`, {
          passed: /\/docs(?:[\s/.)#]|$)/.test(result.body),
        });
    }
    for (const path of [
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/robots.txt",
      "/changelog/rss.xml",
    ]) {
      for (const method of ["GET", "HEAD"]) {
        const alias = `${chinesePath(path)}${incomingQuery}`;
        const result = await request("machine-endpoints", alias, { method });
        if (!result) continue;
        const expected = new URL(path + incomingQuery, origin).href;
        const actual = result.record.headers.location
          ? new URL(result.record.headers.location, origin).href
          : null;
        check(
          "machine-endpoints",
          `${method} ${alias} permanent global alias`,
          {
            passed: result.record.status === 308,
            actual: result.record.status,
            expected: 308,
          },
        );
        check(
          "machine-endpoints",
          `${method} ${alias} preserves query on English target`,
          { passed: actual === expected, actual: actual, expected: expected },
        );
        if (method === "GET") {
          const landing = await request(
            "machine-endpoints",
            path + incomingQuery,
            { headers: { accept: "*/*" } },
          );
          if (landing)
            check("machine-endpoints", `${alias} completes in one redirect`, {
              passed:
                landing.record.status === 200 &&
                !landing.record.headers.location,
              actual: landing.record.status,
              expected: 200,
            });
        }
      }
    }
  });

  await phase("locale-isolation", async () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      index % 2 ? chinesePath("/docs/install-zotlit") : "/docs/install-zotlit",
    );
    await parallel(samples, async (path) =>
      verifyHtml(
        "locale-isolation",
        await request("locale-isolation", path, {
          headers: {
            "accept-language": path.startsWith("/zh-CN") ? "en-US" : "zh-CN",
            cookie: `PARAGLIDE_LOCALE=${path.startsWith("/zh-CN") ? "en" : "zh-CN"}`,
          },
        }),
        path,
      ),
    );
  });

  await phase("noncanonical-machine-requests", async () => {
    for (const { alias, target } of [
      { alias: "/zh-cn/llms-full.txt/", target: "/llms-full.txt" },
      { alias: "/en/llms.txt", target: "/llms.txt" },
      { alias: "/zh-cn/robots.txt/", target: "/robots.txt" },
      { alias: "/en/sitemap.xml/", target: "/sitemap.xml" },
    ]) {
      const result = await request(
        "noncanonical-machine-requests",
        `${alias}${incomingQuery}`,
      );
      if (!result) continue;
      check(
        "noncanonical-machine-requests",
        `${alias} redirects without Sec-Fetch-Dest`,
        {
          passed: result.record.status === 308,
          actual: result.record.status,
          expected: 308,
        },
      );
      check(
        "noncanonical-machine-requests",
        `${alias} canonical target and query`,
        {
          passed:
            result.record.headers.location ===
            `${origin}${target}${incomingQuery}`,
          actual: result.record.headers.location,
          expected: `${origin}${target}${incomingQuery}`,
        },
      );
    }
    for (const { path, headingPath } of [
      { path: "/zh-cn/docs/tutorial", headingPath: "/zh-CN/docs/tutorial" },
      { path: "/zh-cn/docs/tutorial/", headingPath: "/zh-CN/docs/tutorial" },
      { path: "/en/docs/tutorial", headingPath: "/docs/tutorial" },
    ]) {
      const result = await request("noncanonical-machine-requests", path, {
        headers: { accept: "text/markdown" },
      });
      if (!result) continue;
      check(
        "noncanonical-machine-requests",
        `${path} negotiates without Sec-Fetch-Dest`,
        {
          passed: result.record.status === 200,
          actual: result.record.status,
          expected: 200,
        },
      );
      check("noncanonical-machine-requests", `${path} answers Markdown`, {
        passed:
          /text\/markdown/.test(result.record.headers["content-type"] ?? "") &&
          !/<html\b/i.test(result.body),
        actual: result.record.headers["content-type"],
        expected: "text/markdown",
      });
      check(
        "noncanonical-machine-requests",
        `${path} resolves the normalized locale`,
        {
          passed: result.body.split("\n", 1)[0].includes(`(${headingPath})`),
          actual: result.body.split("\n", 1)[0],
          expected: `heading with (${headingPath})`,
        },
      );
    }
  });
}

try {
  await main();
} catch (error) {
  check("startup", "matrix completed", {
    passed: false,
    actual: error.stack ?? String(error),
    expected: "no exception",
  });
} finally {
  evidence.finishedAt = Temporal.Now.instant().toString();
  evidence.durationMs = Math.round(performance.now() - started);
  evidence.summary = {
    passed: evidence.checks.filter((item) => item.passed).length,
    failed: evidence.checks.filter((item) => !item.passed).length,
    requests: evidence.requests.length,
    groups: evidence.groups,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  const summary = [
    `HTTP matrix: ${evidence.summary.failed ? "FAIL" : "PASS"}`,
    `${evidence.summary.passed} checks passed; ${evidence.summary.failed} failed; ${evidence.summary.requests} requests`,
    `Duration: ${(evidence.durationMs / 1000).toFixed(1)} seconds`,
    ...Object.entries(evidence.groups).map(
      ([name, counts]) =>
        `${name}: ${counts.passed} passed, ${counts.failed} failed`,
    ),
    `Evidence: ${relative(workspaceRoot, outputPath)}`,
    "HTTP checks only; browser hydration and interaction were not tested.",
  ];
  await writeFile(
    `${outputPath.replace(/\.json$/, "")}.summary.txt`,
    `${summary.join("\n")}\n`,
  );
  console.log(summary.join("\n"));
  process.exitCode = evidence.summary.failed ? 1 : 0;
}
