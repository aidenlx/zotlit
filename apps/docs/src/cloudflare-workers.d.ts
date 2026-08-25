/**
 * The Worker's own environment, as `cloudflare:workers` hands it to server
 * code.
 *
 * `wrangler types` writes this declaration alongside the whole workerd runtime
 * surface — fifteen thousand lines the repo does not carry, which is why
 * `worker-configuration.d.ts` stays ignored. The site reads one binding and two
 * variables, all declared in `wrangler.jsonc`, so they are typed here by hand.
 */
declare module "cloudflare:workers" {
  export const env: {
    /**
     * The docs line this deployment serves. Pre-release Docs runs the `beta`
     * environment; every other deployment answers for the production line and
     * hands unknown changelog versions to Pre-release Docs.
     */
    DOCS_LINE?: "production" | "beta";
    /**
     * Raises the GitHub API rate limit from 60/hr (anonymous) to 5000/hr.
     * Configured as a Worker secret; absent in local runs.
     */
    GITHUB_TOKEN?: string;
    /** The static-asset binding, which answers with the prerendered files. */
    ASSETS: { fetch(request: Request | URL): Promise<Response> };
  };
}
