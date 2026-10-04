/**
 * PROTOTYPE — throwaway. Folds `results/*.json` and `story.json` into one
 * self-contained page: `prototype-item-query-async-execution.html`.
 *
 *   node render-report.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const data: Record<string, Record<string, unknown>> = {};
for (const f of readdirSync(join(here, "results")).filter((f) => /^(node|renderer)-.*\.json$/.test(f) && !f.includes("-quick"))) {
  const [, host, lib] = /^(node|renderer)-(.*)\.json$/.exec(f)!;
  const json = JSON.parse(readFileSync(join(here, "results", f), "utf8"));
  // Shrink traces: 0.1 ms resolution and one shared table of operation labels.
  const labels: string[] = [];
  for (const e of json.results) {
    e.slices = e.slices.map(([a, b, ops]: [number, number, string]) => {
      let i = labels.indexOf(ops);
      if (i < 0) i = labels.push(ops) - 1;
      return [Math.round(a * 10) / 10, Math.round(b * 10) / 10, i];
    });
  }
  json.labels = labels;
  (data[host!] ??= {})[lib!] = json;
}
const order = ["active", "legacy", "scaled-10x"];
for (const host of Object.keys(data)) {
  data[host] = Object.fromEntries(
    Object.entries(data[host]!).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)),
  );
}
const story = readFileSync(join(here, "story.json"), "utf8");
const html = readFileSync(join(here, "report.template.html"), "utf8")
  .replace("/*__DATA__*/", () => JSON.stringify(data).replaceAll("</", "<\\/"))
  .replace("/*__STORY__*/", () => story.replaceAll("</", "<\\/"));
const out = join(here, "prototype-item-query-async-execution.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KiB)`);
