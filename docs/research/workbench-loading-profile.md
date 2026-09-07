# Template Workbench loading profile

How long the web Template Workbench at `/workbench` takes to become usable,
what the time is spent on, and what changed it. The numbers are from one
machine, localhost, so they compare against each other rather than against a
reader's network. The commands to repeat them are at the end.

## Where the time went

Before the change, the route rendered a centered loading sentence until one
dynamic `import()` resolved, and that one chunk carried everything: CodeMirror
with four language packages, the document core, the render scheduler and its
template engines, the bridge client, the UI kit, and the reading view's
Markdown parser stack.

Production, `vite preview`, cold cache, median of three runs:

| Metric                     | Value   |
| -------------------------- | ------- |
| First paint, the loading text | 19 ms |
| Editor chunk request start | 116 ms  |
| Editor visible             | 208 ms  |
| Long task before the editor | 56 ms  |
| Requests                   | 78      |

The editor chunk was 1169 KiB raw and 382 KiB gzip. Its largest families, in
minified KiB:

| Family                                                  | KiB |
| ------------------------------------------------------- | --- |
| Markdown and HTML parsing for the reading view          | 392 |
| CodeMirror                                              | 306 |
| Lezer parsers                                           | 213 |
| Template engines and serializers, duplicated in the Worker | 173 |
| UI kit                                                  | 157 |
| App source                                              | 118 |

Half of the critical path passed before the editor chunk was requested: the
shell had to parse and hydrate and the mount effect had to run first.

The dev server was slower for reasons of its own. A cold start reached the
editor in 6.0 s and a warm reload in 1.0 s. The core package was read as its
built output, so an edit there needed a `tsdown --watch` rebuild that rewrote
178 files, and each rewritten file forced a full page reload. An edit to the
render Worker reloaded the page as well, since Vite has no hot channel into a
Worker graph.

## What changed

- The route paints the page's own frame as a skeleton, with every control
  inert, and starts the editor bundle's `import()` when the route module
  evaluates rather than after hydration.
- The reading view loads behind one `React.lazy` binding once a render has
  answered, so the Markdown parser stack leaves the editor chunk.
- The core package publishes a `development` export condition to its source,
  so the dev server and Vitest read it directly and an edit hot-updates through
  the page's React boundary with the editor's state kept.
- `optimizeDeps.entries` names the Workbench module, so the dependency scan
  finds its libraries before the first request.
- The `workerHotUpdate` Vite plugin keeps an edit inside the render Worker's
  graph from reloading the page; the next render's fresh Worker runs the edit.
- The helpers that sat beside components in `handoff.tsx` and `annotation.tsx`
  moved out, so Fast Refresh accepts those modules in place.

## After

Production, `vite preview`, cold cache, median of three runs before and four
after:

| Metric                        | Before | After  |
| ----------------------------- | ------ | ------ |
| First paint                   | 19 ms  | 26 ms  |
| Editor chunk request start    | 116 ms | 112 ms |
| Editor visible                | 208 ms | 200 ms |
| Worker chunk request start    | 511 ms | 504 ms |
| Reading view chunk request    | with the editor | 539 ms |

The first paint is now the page's frame rather than a sentence, and the panes
keep their position when the editor mounts. Time to a typeable editor is the
same on localhost, where the download is free; the saving is in what has to
arrive before it:

| Chunk                         | Before             | After              |
| ----------------------------- | ------------------ | ------------------ |
| Editor chunk, raw / gzip      | 1169 / 382 KiB     | 1018 / 337 KiB     |
| Everything behind the route's `import()` | 1582 / 501 KiB | 1161 / 375 KiB |
| Reading view, arriving after the first render | in the editor chunk | 140 / 43 KiB |

Two of the reading view's parser chunks, parse5 and micromark, are shared with
the docs search index and are fetched at page load by the search bundle on
every page; that is search's cost, and it stays. The Temporal polyfill was not
requested in any run.

Dev server:

| Metric                              | Before | After  |
| ----------------------------------- | ------ | ------ |
| Cold start to editor                | 6.0 s  | 3.2 s  |
| Warm reload to editor               | 1.0 s  | 0.9 s  |
| Optimizer runs during the first load | several | one   |

Hot update, with text typed in the editor and a marker on `window`: an edit to
the core package's render or document source, to the render Worker's entry,
to `annotation.tsx`, or to `handoff.tsx` each hot-updated with the marker and
the text kept, no page reload, and no `Could not Fast Refresh` line in the
server log. An edit the Worker runs showed in the next render's result.

## Known costs left in place

- The template engines and serializers, about 173 KiB minified, ship to the
  page as well as to the Worker. The document controller parses the Profile's
  Liquid regions, detects Eta, and reads its YAML, so they are a cost of
  editing, not of rendering. Moving them out needs a parse-only subset of the
  templates facade, which is shared with the Obsidian plugin.
- The shell preloads the root route graph, about 616 KiB raw, for a route
  whose own code is 3 KiB. Trimming it is a TanStack Start route-graph
  question that touches every page.
- The Worker chunk is fetched after the 300 ms render debounce, so the first
  preview lands after the editor. That order is intended.
- The Obsidian plugin's dev build runs `vite build --mode development`, which
  keeps the built output of the core package, so that loop still needs
  `tsdown --watch`.

## How to repeat

Production sizes and timings, from the repo root:

```sh
pnpm exec turbo run build --filter=@zotlit/workbench
cd apps/docs && pnpm exec vite build
cd apps/docs && pnpm exec vite preview --port 4173
```

Then open `http://localhost:4173/workbench` with `agent-browser` and an
init script that installs a `MutationObserver` recording `performance.now()`
when `[aria-busy="true"]` and `.cm-editor` first appear, and read
`performance.getEntriesByType("resource")` for the chunk request starts. Chunk
sizes come from `dist/client/assets/` with `gzip -9`; per-package attribution
comes from a `--sourcemap true` build and a VLQ walk over each chunk's
sourcemap `sources`.

Dev server, cold and warm:

```sh
rm -rf apps/docs/node_modules/.vite
DEBUG=vite:deps pnpm --filter @zotlit/docs dev
```

The optimizer log shows one `Scan completed` and one `dependencies optimized`
per environment when the entries scan is complete. The `?v=` hash on a
`.vite/deps` request is per dependency in Vite 8, so a count of distinct
hashes is not a count of optimizer rounds.

Hot update, with editor state: type into the first `.cm-content`, set a marker
on `window`, edit a file, and check that the marker survives, the text is
kept, and the server prints `hmr update` rather than `page reload`.
