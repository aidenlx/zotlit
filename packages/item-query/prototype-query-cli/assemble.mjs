// Inline the three ES modules into the single-file prototype page.
import { readFileSync, writeFileSync } from "node:fs";
const shell = readFileSync("prototype-shell.html", "utf8");
const inline = (id, file) =>
  `<script type="text/plain" id="${id}">\n${readFileSync(file, "utf8").replaceAll(/<\/script>/g, "<\\/script>")}\n</script>`;
const out = shell.replace(
  "<!--MODULES-->",
  [
    inline("mod-data", "data.mjs"),
    inline("mod-engine", "engine.mjs"),
    inline("mod-cases", "cases.mjs"),
    inline("mod-scenarios", "scenarios.mjs"),
  ].join("\n"),
);
writeFileSync("prototype-query-cli.html", out);
console.log("wrote prototype-query-cli.html", out.length, "bytes");
