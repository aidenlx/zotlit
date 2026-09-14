# ZotLit 1086 final recovery Luna3 transcript

## 1. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-status`

Exact stdout:

```text
{
  "contractVersion": 7,
  "command": "zotlit:template-status",
  "ok": true,
  "pluginVersion": "2.1.4",
  "identity": {
    "vault": {
      "name": "fixture-vault-zotlit-v2",
      "path": "/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"
    },
    "source": {
      "id": "8a19f09e",
      "databasePath": "/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"
    }
  },
  "javascriptTemplatesEnabled": false,
  "templates": [],
  "profiles": [
    {
      "id": "default",
      "label": "Default",
      "document": null,
      "bindings": {
        "note.literature-folder": "literatures",
        "citation.references-style": null,
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false
      }
    },
    {
      "id": "V1StGXR8Z5jd",
      "label": "Books",
      "document": "zotlit-profile.books.md",
      "bindings": {
        "note.literature-folder": "books",
        "citation.references-style": "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false
      }
    }
  ],
  "profileDiagnostics": [],
  "documents": [
    {
      "reference": "zotlit-profile.books.md",
      "path": "templates/zotlit-profile.books.md",
      "validation": {
        "state": "valid",
        "manifest": {
          "id": "V1StGXR8Z5jd",
          "name": "Books",
          "version": "1.0.0",
          "author": "ZotLit",
          "description": "A visibly distinct book layout for the End-to-end Run",
          "contract": 3,
          "filename": "books-{{ zt.citationKey | default: zt.key }}{% suffix %}",
          "match": "itemType == \"book\"",
          "folder": "books",
          "citationStyle": "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
          "language": "liquid",
          "frontmatter": [
            {
              "key": "fixture-title",
              "merge": "replace",
              "expr": "zt.title"
            },
            {
              "key": "fixture-kind",
              "merge": "replace",
              "value": {
                "$if": "zt.itemType == 'journalArticle'",
                "then": "reference/article",
                "else": "reference/other"
              }
            },
            {
              "key": "fixture-obsolete",
              "merge": "replace",
              "value": {
                "$if": "zt.itemType == 'bookSection'",
                "then": "retained"
              }
            },
            {
              "merge": "replace",
              "value": {
                "fixture-spread-title": {
                  "$eval": "zt.title"
                },
                "fixture-spread-kind": {
                  "$eval": "zt.itemType"
                }
              }
            }
          ]
        },
        "hasManagedBlock": true
      }
    }
  ]
}

```

## 2. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check profile=Books key=BBBB2222 expect-source=8a19f09e`

Exact stdout:

```text
{"contractVersion":7,"command":"zotlit:template-check","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"document":{"kind":"profile","id":"zotlit-profile.books.md","label":"Books","path":"templates/zotlit-profile.books.md","profileIdentity":{"id":"V1StGXR8Z5jd","label":"Books"},"profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},"dependencies":[{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"dependencyScope":"installed-partial-registry","freshness":{"state":"current","versions":[{"path":"templates/zotlit-profile.books.md","requested":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","disk":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","loaded":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543"},{"path":"templates/zotlit-citation.md","requested":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","disk":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","loaded":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70"},{"path":"templates/zotlit-partial.book-details.md","requested":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","disk":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","loaded":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f"}]},"input":{"origin":"saved","path":"templates/zotlit-profile.books.md","revision":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543"},"problems":[],"checks":{"structure":{"status":"passed","diagnostics":[]},"filename":{"status":"passed","diagnostics":[]},"properties":{"status":"passed","diagnostics":[],"entries":[{"key":"fixture-title","position":1,"status":"passed"},{"key":"fixture-kind","position":2,"status":"passed"},{"key":"fixture-obsolete","position":3,"status":"passed"},{"position":4,"status":"passed"}]},"fold":{"status":"passed","diagnostics":[]},"frontmatter":{"status":"passed","diagnostics":[]},"body":{"status":"passed","diagnostics":[]},"managed":{"status":"passed","diagnostics":[]},"annotations":{"status":"passed","entries":[],"diagnostics":[]}},"rendering":"checked","attempt":"ab03cd65-3c8e-47c3-acf3-c30e06245bd3","attemptContext":{"sequence":4,"capturedAt":"2026-09-13T14:16:00.296830078Z","mode":"create","sourceRevision":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","dataRevision":"2b4569ae0ab42a90d1efd9bc9cadebb7076a1b9b1590eb11b7870d38b27b19d3","document":"templates/zotlit-profile.books.md","language":"liquid","root":"note","selection":"BBBB2222","zotlitVersion":"2.1.4","hostVersion":"Obsidian 1.14.1"},"request":{"profile":"Books","key":"BBBB2222","mode":"create"}}

```

Extracted attempt ID: `ab03cd65-3c8e-47c3-acf3-c30e06245bd3`

## 3. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt=ab03cd65-3c8e-47c3-acf3-c30e06245bd3 evidence=full output=all expect-source=8a19f09e`

Exact stdout:

```text
{"contractVersion":7,"command":"zotlit:template-check","ok":false,"diagnostic":{"code":"INVALID_SELECTOR","message":"An attempt lookup takes only attempt, output, and evidence.","hint":"Keep the same vault prefix. Use only attempt, output, and evidence for a retained lookup; omit expect-source and all input selectors. Example: zotlit:template-check attempt=<id> evidence=full output=all. The retained result carries the original source identity."}}

```

## 4. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt=ab03cd65-3c8e-47c3-acf3-c30e06245bd3 evidence=full output=all`

Exact stdout:

```text
{"contractVersion":7,"command":"zotlit:template-check","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"document":{"kind":"profile","id":"zotlit-profile.books.md","label":"Books","path":"templates/zotlit-profile.books.md","profileIdentity":{"id":"V1StGXR8Z5jd","label":"Books"},"profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},"dependencies":[{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"dependencyScope":"installed-partial-registry","freshness":{"state":"current","versions":[{"path":"templates/zotlit-profile.books.md","requested":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","disk":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","loaded":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543"},{"path":"templates/zotlit-citation.md","requested":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","disk":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","loaded":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70"},{"path":"templates/zotlit-partial.book-details.md","requested":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","disk":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","loaded":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f"}]},"input":{"origin":"saved","path":"templates/zotlit-profile.books.md","revision":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543"},"problems":[],"checks":{"structure":{"status":"passed","diagnostics":[]},"filename":{"status":"passed","diagnostics":[]},"properties":{"status":"passed","diagnostics":[],"entries":[{"key":"fixture-title","position":1,"status":"passed"},{"key":"fixture-kind","position":2,"status":"passed"},{"key":"fixture-obsolete","position":3,"status":"passed"},{"position":4,"status":"passed"}]},"fold":{"status":"passed","diagnostics":[]},"frontmatter":{"status":"passed","diagnostics":[]},"body":{"status":"passed","diagnostics":[]},"managed":{"status":"passed","diagnostics":[]},"annotations":{"status":"passed","entries":[],"diagnostics":[]}},"rendering":"checked","attempt":"ab03cd65-3c8e-47c3-acf3-c30e06245bd3","attemptContext":{"sequence":4,"capturedAt":"2026-09-13T14:16:00.296830078Z","mode":"create","sourceRevision":"99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543","dataRevision":"2b4569ae0ab42a90d1efd9bc9cadebb7076a1b9b1590eb11b7870d38b27b19d3","document":"templates/zotlit-profile.books.md","language":"liquid","root":"note","selection":"BBBB2222","zotlitVersion":"2.1.4","hostVersion":"Obsidian 1.14.1"},"request":{"profile":"Books","key":"BBBB2222","mode":"create"},"outputs":{"filename":"books-duplicateWithin2020","properties":[{"key":"fixture-title","position":1,"missing":false,"value":"Within-library duplicate, first item"},{"key":"fixture-kind","position":2,"missing":false,"value":"reference/article"},{"key":"fixture-obsolete","position":3,"missing":true},{"key":"fixture-spread-title","position":4,"missing":false,"value":"Within-library duplicate, first item"},{"key":"fixture-spread-kind","position":4,"missing":false,"value":"journalArticle"}],"fold":{"fixture-title":"Within-library duplicate, first item","fixture-kind":"reference/article","fixture-spread-title":"Within-library duplicate, first item","fixture-spread-kind":"journalArticle","zotero-key":"BBBB2222","zotlit-profile":"Books (V1StGXR8Z5jd)","zotlit-csl":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric"},"frontmatter":"fixture-title: Within-library duplicate, first item\nfixture-kind: reference/article\nfixture-spread-title: Within-library duplicate, first item\nfixture-spread-kind: journalArticle\nzotero-key: BBBB2222\nzotlit-profile: Books (V1StGXR8Z5jd)\nzotlit-csl: http://www.zotero.org/styles/chinese-gb7714-1987-numeric\n","body":"# Book profile: Within-library duplicate, first item\n\n%%zt-managed%%\n## Book details\n\nCitation key: duplicateWithin2020\n\n> [!info] Book details\n> Type: journalArticle\n> Citation key: duplicateWithin2020\n%%/zt-managed%%\n","managed":"%%zt-managed%%\n## Book details\n\nCitation key: duplicateWithin2020\n\n> [!info] Book details\n> Type: journalArticle\n> Citation key: duplicateWithin2020\n%%/zt-managed%%","annotations":[]}}

```

## Result

Status command: exit 0; ok=true.
Initial template-check: exit 0; ok=true; attempt=ab03cd65-3c8e-47c3-acf3-c30e06245bd3.
Invalid retained lookup: exit 0; code=INVALID_SELECTOR; hint=Keep the same vault prefix. Use only attempt, output, and evidence for a retained lookup; omit expect-source and all input selectors. Example: zotlit:template-check attempt=<id> evidence=full output=all. The retained result carries the original source identity.
Valid retained lookup: exit 0; ok=true; source=8a19f09e (/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite); freshness=current; checks=structure:passed, filename:passed, properties:passed, fold:passed, frontmatter:passed, body:passed, managed:passed, annotations:passed.
