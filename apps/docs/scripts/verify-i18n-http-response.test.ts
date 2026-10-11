import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import englishMessages from "../../../messages/en.json" with { type: "json" };

const packageRoot = resolve(import.meta.dirname, "..");
const execute = promisify(execFile);

type Fault =
  | "none"
  | "wrong-path"
  | "lost-query"
  | "leaked-link"
  | "same-href-link"
  | "duplicate-action";

function createFixture(fault: Fault = "none") {
  const scratchRoot = join(packageRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  using cleanup = new DisposableStack();
  const directory = cleanup.use(
    mkdtempDisposableSync(join(scratchRoot, "http-response-")),
  );
  const root = directory.path;
  const docs = join(root, "apps/docs");
  function write(path: string, body: string) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  write("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  write("package.json", '{"private":true,"type":"module"}');
  write("apps/docs/package.json", '{"type":"module"}');
  write("messages/en.json", JSON.stringify(englishMessages));
  write(
    "apps/docs/content/docs/native.zh-CN.mdx",
    "---\ntitle: Native\n---\nEnglish copy.\n",
  );
  write("apps/docs/dist/client/docs/native/index.html", "native fixture");
  write("apps/docs/dist/client/docs/missing/index.html", "missing fixture");
  write(
    "apps/docs/dist/client/_redirects",
    "/legacy /zh-CN/docs/missing?keep=one&keep=two&src=%2Ffaq%2Fslurp 308\n",
  );
  write("apps/docs/dist/server/index.js", "// HTTP fixture only\n");
  write("apps/docs/dist/server/wrangler.json", "{}");
  mkdirSync(join(docs, "src/lib"), { recursive: true });
  mkdirSync(join(docs, "scripts"), { recursive: true });
  copyFileSync(
    join(packageRoot, "src/lib/content-scan.ts"),
    join(docs, "src/lib/content-scan.ts"),
  );
  copyFileSync(
    join(packageRoot, "scripts/verify-i18n-http.mjs"),
    join(docs, "scripts/verify-i18n-http.mjs"),
  );
  symlinkSync(
    join(packageRoot, "node_modules"),
    join(docs, "node_modules"),
    "dir",
  );
  // A real HTTP server with controlled responses. This is a verifier fixture,
  // not a substitute for the normal Cloudflare build or its response matrix.
  write(
    "apps/docs/vite.config.mjs",
    `
    const fault = ${JSON.stringify(fault)};
    const notice = ${JSON.stringify(englishMessages.docs_locale_fallback)};
    const label = ${JSON.stringify(englishMessages.docs_read_in_english)};
    const publicOrigin = "https://zotlit.aidenlx.site";
    export default {
      plugins: [{ name: "http-response-fixture", configurePreviewServer(server) {
        server.middlewares.use((request, response) => {
          const url = new URL(request.url, "http://127.0.0.1");
          if (url.pathname === "/legacy") {
            response.writeHead(308, { location: "/zh-CN/docs/missing?keep=one&keep=two&src=%2Ffaq%2Fslurp" });
            return response.end();
          }
          const chinese = url.pathname.startsWith("/zh-CN/");
          const path = chinese ? url.pathname.slice(6) : url.pathname;
          if (!["/docs/native", "/docs/missing"].includes(path)) {
            response.writeHead(404); return response.end();
          }
          const native = path === "/docs/native";
          const fallback = chinese && !native;
          const locale = chinese && native ? "zh-CN" : "en";
          const canonical = chinese && native ? "/zh-CN" + path : path;
          const href = (fault === "wrong-path" ? "/docs/other" : path) + (fault === "lost-query" ? "" : url.search);
          const anchor = '<a href="' + href.replaceAll("&", "&amp;") + '">' + label + '</a>';
          const note = fallback ? '<div role="note" lang="en"><p>' + notice + '</p>' + anchor + (fault === "duplicate-action" ? anchor : "") + '</div>' : "";
          const leak = fallback && fault === "leaked-link" ? '<a href="/docs/other">Other</a>' : fallback && fault === "same-href-link" ? anchor : "";
          response.writeHead(200, {
            "content-type": "text/html", "content-language": locale,
            ...(fallback ? { "x-robots-tag": "noindex, follow" } : {}),
          });
          response.end('<html lang="' + locale + '"><head><title>Fixture</title>' +
            '<link rel="canonical" href="' + publicOrigin + canonical + '">' +
            '<link rel="alternate" hreflang="en" href="' + publicOrigin + path + '">' +
            '<link rel="alternate" hreflang="x-default" href="' + publicOrigin + path + '">' +
            (native ? '<link rel="alternate" hreflang="zh-CN" href="' + publicOrigin + '/zh-CN' + path + '">' : "") +
            (fallback ? '<meta name="robots" content="noindex, follow">' : "") +
            '</head><body>' + note + leak + '<aside id="nd-sidebar"><a href="' + (chinese ? '/zh-CN' : '') + '/docs/native">Native</a></aside>' +
            '<script>({markdownUrl:"' + (chinese ? '/zh-CN' : '') + '/llms.mdx' + path + '/content.md"})</script></body></html>');
        });
      } }],
    };
  `,
  );
  const lifetime = cleanup.move();
  return {
    root,
    docs,
    [Symbol.dispose]() {
      lifetime[Symbol.dispose]();
    },
  };
}

async function run(fixture: ReturnType<typeof createFixture>) {
  const output = join(fixture.root, "evidence.json");
  // The fixture deliberately returns 404 for unrelated matrix phases. Inspect
  // only the HTML and legacy landing groups whose response contract it serves.
  await expect(
    execute(
      process.execPath,
      [
        join(fixture.docs, "scripts/verify-i18n-http.mjs"),
        "--config",
        join(fixture.docs, "vite.config.mjs"),
        "--expected-html=2",
        "--expected-redirects=1",
        "--output",
        output,
      ],
      { cwd: fixture.root, timeout: 30_000 },
    ),
  ).rejects.toMatchObject({ code: 1 });
  return JSON.parse(readFileSync(output, "utf8")) as {
    origin: string;
    groups: Record<string, { passed: number; failed: number }>;
    checks: { group: string; label: string; passed: boolean }[];
  };
}

// HTTP response seam: a native edition needs no fallback; missing editions keep
// their exact English action; no other English link gets that exemption.
describe("HTTP verification response matrix", () => {
  it("checks native and missing editions in concurrent OS-assigned previews", async () => {
    using first = createFixture();
    using second = createFixture();
    const results = await Promise.all([run(first), run(second)]);
    expect(new Set(results.map((result) => result.origin)).size).toBe(2);
    for (const result of results) {
      expect(new URL(result.origin).port).not.toBe("0");
      expect(result.groups.html?.failed).toBe(0);
      expect(result.groups["legacy-landing"]?.failed).toBe(0);
      expect(result.groups.startup).toBeUndefined();
      expect(result.groups.shutdown).toBeUndefined();
    }
  }, 30_000);

  it.each([
    ["wrong-path", false, false],
    ["lost-query", false, false],
    ["leaked-link", true, false],
    ["same-href-link", true, false],
    ["duplicate-action", false, false],
  ] as const)(
    "rejects %s without a broad locale-link exemption",
    async (fault, actionPass, localePass) => {
      using fixture = createFixture(fault);
      const result = await run(fixture);
      for (const [suffix, expected] of [
        ["explicit English action preserves path and query", actionPass],
        ["internal HTML links retain locale", localePass],
      ] as const) {
        const checks = result.checks.filter(
          (check) =>
            check.group === "legacy-landing" && check.label.endsWith(suffix),
        );
        expect(checks).toHaveLength(2);
        expect(checks.every((check) => check.passed === expected)).toBe(true);
      }
    },
    30_000,
  );
});
