// The Template Directory as the build read it, served by the `zotlit:template-directory` plugin in `vite.config.ts`.

declare module "virtual:zotlit/template-directory" {
  const site: import("./site.ts").DirectorySite;
  export default site;
}
