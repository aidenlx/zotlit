---
name: cloudflare-web-analytics
description: Query Cloudflare Web Analytics RUM and Core Web Vitals through the GraphQL Analytics API. Use when a Web Analytics dashboard URL or site tag is supplied, or when diagnosing CLS, LCP, or INP by page, element, browser, device, country, or host.
compatibility: Requires the Cloudflare API connector; browser reproduction requires Chrome DevTools.
---

# Query Cloudflare Web Analytics

Use field data to choose the page and environment to reproduce. The GraphQL schema is the
source of truth: the RUM datasets are beta and can change independently of static guidance.

## 1. Resolve the query scope

Extract these values from the request or dashboard URL:

- `accountTag`: the 32-character account ID in the dashboard path.
- `siteTag`: the value of `siteTag~in`.
- Time range: preserve explicit dashboard filters. Otherwise choose a bounded recent range
  and state it in the result.
- Bot filter: map `excludeBots=Yes` to `bot: 0`.

Query `requestHost` before narrowing to a deployment. One site tag can contain more than one
host, including production and pre-release hosts.

```graphql
query Hosts($accountTag: string!, $siteTag: string!, $start: Date!, $end: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rumWebVitalsEventsAdaptiveGroups(
        filter: {
          siteTag: $siteTag
          date_geq: $start
          date_leq: $end
          bot: 0
        }
        limit: 50
        orderBy: [count_DESC]
      ) {
        count
        avg {
          sampleInterval
        }
        dimensions {
          requestHost
        }
      }
    }
  }
}
```

This step is complete when the account, site tag, ISO date range, bot policy, and target host
are explicit.

## 2. Query the current schema

Send read-only GraphQL queries with `mcp__cloudflare_api__execute`:

```js
async () => {
  const response = await cloudflare.request({
    method: "POST",
    path: "/graphql",
    body: { query, variables },
  });
  return response;
}
```

The account-level RUM datasets currently include:

- `rumWebVitalsEventsAdaptiveGroups` — aggregated Core Web Vitals.
- `rumWebVitalsEventsAdaptive` — event-level Core Web Vitals.
- `rumPageloadEventsAdaptiveGroups` — aggregated page-load metrics.
- `rumPerformanceEventsAdaptiveGroups` — aggregated performance events.

Use GraphQL introspection before relying on a dataset, field, filter, or order value that has
not already succeeded in the current run. On a schema error, read
[schema-discovery.md](schema-discovery.md) and rebuild the query from the returned types.

## 3. Establish the CLS baseline

Keep the first grouping small. Every selected dimension partitions the result further.

```graphql
query ClsBaseline(
  $accountTag: string!
  $siteTag: string!
  $host: string!
  $start: Date!
  $end: Date!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      overall: rumWebVitalsEventsAdaptiveGroups(
        filter: {
          siteTag: $siteTag
          requestHost: $host
          date_geq: $start
          date_leq: $end
          bot: 0
          cumulativeLayoutShift_geq: 0
        }
        limit: 1
      ) {
        count
        avg {
          cumulativeLayoutShift
          sampleInterval
        }
        quantiles {
          cumulativeLayoutShiftP50
          cumulativeLayoutShiftP75
          cumulativeLayoutShiftP90
          cumulativeLayoutShiftP95
        }
      }
      culprits: rumWebVitalsEventsAdaptiveGroups(
        filter: {
          siteTag: $siteTag
          requestHost: $host
          date_geq: $start
          date_leq: $end
          bot: 0
          cumulativeLayoutShift_gt: 0
        }
        limit: 25
        orderBy: [quantiles_cumulativeLayoutShiftP75_DESC]
      ) {
        count
        avg {
          cumulativeLayoutShift
          sampleInterval
        }
        quantiles {
          cumulativeLayoutShiftP50
          cumulativeLayoutShiftP75
          cumulativeLayoutShiftP90
          cumulativeLayoutShiftP95
        }
        dimensions {
          cumulativeLayoutShiftElement
          cumulativeLayoutShiftPath
          requestPath
        }
      }
    }
  }
}
```

Pass variables separately:

```json
{
  "accountTag": "ACCOUNT_ID",
  "siteTag": "SITE_TAG",
  "host": "www.example.com",
  "start": "2026-08-01",
  "end": "2026-08-27"
}
```

For a drill-down, add only the dimension that tests the current question, such as
`deviceType`, `userAgentBrowser`, or `countryName`. Filter to one `requestPath` or
`cumulativeLayoutShiftElement` before adding several dimensions.

## 4. Interpret sampled field data

- Use CLS p75 for the site-level verdict. Keep p50, p90, and p95 visible to show the
  distribution.
- Report `avg.sampleInterval` with counts. A value greater than one means the query used
  sampled data, so a returned count is not a raw unsampled beacon count.
- Treat `cumulativeLayoutShiftElement` as the element that moved. An ancestor, font swap,
  injected sibling, or page-wide reflow can be the cause.
- Treat equal extreme values across unrelated selectors as evidence of one shared reflow and
  test shared layout, fonts, theme initialization, and hydrated chrome first.
- Separate observations from inferences. A selector in RUM is evidence that it shifted, not
  proof that its component caused the shift.

## 5. Reproduce the selected segment

Open a high-impact path in Chrome at the matching device class and browser conditions. Record
a cold-load performance trace, then inspect the `CLSCulprits` insight. Use the trace to find
the source element, movement time, and preceding DOM or style change.

When source is available, map the trace back to the shared layout before changing individual
reported elements. Re-run the same trace after the change and compare the CLS value and shift
events.

This step is complete when one reproducible browser event explains the field-data pattern and
the post-change trace removes or materially reduces that event.

## Report

Include:

1. Query scope: site tag, host, date range, and bot filter.
2. CLS p75 and sample interval.
3. Top paths and shifted selectors with their counts and distribution.
4. The browser-trace cause, clearly marked as reproduced evidence.
5. The changed files and the post-change measurement.

Use Cloudflare's current documentation for product behavior and the live GraphQL schema for
API names. The Web Analytics FAQ documents GraphQL sampling, and the Core Web Vitals guide
defines the dashboard's metric and debug views.
