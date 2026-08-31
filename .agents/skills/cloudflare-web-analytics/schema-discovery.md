# GraphQL schema discovery

Use this branch when a RUM query fails validation or when the required grouping is absent from
the standard query. Cloudflare's introspection names are case-sensitive; the root object types
are currently `viewer` and `account`.

## Find RUM datasets

```graphql
query {
  __type(name: "account") {
    fields {
      name
      description
      args {
        name
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
```

Filter the returned fields to names containing `rum`. Read the selected field's `filter` and
`orderBy` type names from its arguments.

## Inspect one dataset

For `rumWebVitalsEventsAdaptiveGroups`, inspect these types:

```graphql
query {
  result: __type(name: "AccountRumWebVitalsEventsAdaptiveGroups") {
    fields {
      name
      description
      type {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
  filter: __type(
    name: "AccountRumWebVitalsEventsAdaptiveGroupsFilter_InputObject"
  ) {
    inputFields {
      name
      description
      type {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
  order: __type(name: "AccountRumWebVitalsEventsAdaptiveGroupsOrderBy") {
    enumValues {
      name
      description
    }
  }
}
```

Then inspect the object types returned by `avg`, `dimensions`, `quantiles`, and `sum`. Select
only fields that the live schema returns.

## Validate access

Run a minimal account query before debugging a large operation:

```graphql
query($accountTag: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      __typename
    }
  }
}
```

A returned `account` object proves that the connector can read that account. An empty account
list points to the account ID or authorization. A GraphQL validation error points to the query
shape and should lead back to introspection.
