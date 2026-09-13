import { generateParaglide } from "@zotlit/paraglide-vite";

import { paraglideOptions } from "../paraglide.config.ts";

await generateParaglide({
  ...paraglideOptions,
  outputStructure: "locale-modules",
});
