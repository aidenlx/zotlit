import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const script = join(packageRoot, "scripts/verify-i18n-http.mjs");

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

// CLI seam: help works without a build, invalid options fail before preview,
// and port zero is accepted without depending on a globally reserved port.
describe("HTTP verification CLI", () => {
  it("explains the options and verification limits without a build", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    for (const option of [
      "--config",
      "--output",
      "--port",
      "--concurrency",
      "--expected-html",
      "--expected-redirects",
    ]) {
      expect(result.stdout).toContain(option);
    }
    expect(result.stdout).toContain("DOCS_HTTP_VITE_CONFIG");
    expect(result.stdout).toContain("OS-assigned");
    expect(result.stdout).toContain("Browser hydration");
  });

  it.each([
    ["port", "-1", "0 to 65535"],
    ["port", "65536", "0 to 65535"],
    ["port", "", "0 to 65535"],
    ["concurrency", "0", "1 to 8"],
    ["concurrency", "9", "1 to 8"],
    ["expected-html", "0", "1 to 10000"],
    ["expected-html", "1.5", "1 to 10000"],
    ["expected-html", "abc", "1 to 10000"],
    ["expected-redirects", "2001", "1 to 2000"],
  ])("rejects invalid --%s=%s", (name, value, range) => {
    const result = run(`--${name}=${value}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `--${name} must be an integer from ${range}`,
    );
  });

  it("rejects unknown options", () => {
    const result = run("--unknown-option");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown (?:argument|option)/);
  });

  it("accepts port zero and records a missing-config startup failure", () => {
    using cleanup = new DisposableStack();
    const scratchRoot = join(packageRoot, ".scratch");
    mkdirSync(scratchRoot, { recursive: true });
    const directory = cleanup.adopt(
      mkdtempSync(join(scratchRoot, "http-cli-")),
      (path) => rmSync(path, { recursive: true, force: true }),
    );
    const output = join(directory, "evidence.json");
    const config = join(directory, "missing.vite.config.mjs");
    const result = run("--port=0", "--config", config, "--output", output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Missing preview config: ${config}`);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      summary: { failed: 1, requests: 0 },
      groups: { startup: { passed: 0, failed: 1 } },
    });
  });
});
