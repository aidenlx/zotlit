# PROTOTYPE results — #1313

## tier-10k (10000 top-level Items)

electron-43.3.0 node-24.18.1 sqlite-3.53.1, darwin-arm64, window visible, `setImmediate` in renderer: true, 2026-10-04T11:27:47.013Z

### Slices and totals (no cancel request; five runs each)

| Engine | Query | Median total ms | p99 slice ms | Max slice ms | Slices > 16 ms | Slices > 32 ms | Max heartbeat gap ms | Result hash |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| plain-mc8 | newest-100 | 9.6 | 8.2 | 8.2 | 0 | 0 | 10.1 | 4da701d6 |
| effect-mc8 | newest-100 | 10.0 | 8.3 | 8.3 | 0 | 0 | 10.7 | 4da701d6 |
| plain-mc8 | title-contains | 33.9 | 8.4 | 8.4 | 0 | 0 | 19.4 | 6dbd3b35 |
| effect-mc8 | title-contains | 34.0 | 8.4 | 8.4 | 0 | 0 | 18.1 | 6dbd3b35 |
| plain-mc8 | common-tag | 3.6 | 3.9 | 3.9 | 0 | 0 | 3.9 | 7dbd4f9 |
| effect-mc8 | common-tag | 3.9 | 6.8 | 6.8 | 0 | 0 | 6.9 | 7dbd4f9 |
| plain-mc8 | rare-tag | 8.1 | 8.8 | 8.8 | 0 | 0 | 9.4 | b950c6b4 |
| effect-mc8 | rare-tag | 8.2 | 8.4 | 8.4 | 0 | 0 | 8.7 | b950c6b4 |
| plain-mc8 | has-attachment | 7.1 | 8.1 | 8.1 | 0 | 0 | 8.5 | 239d96de |
| effect-mc8 | has-attachment | 8.8 | 8.8 | 8.8 | 0 | 0 | 9.8 | 239d96de |
| plain-mc8 | full-export | 109.4 | 10.6 | 10.6 | 0 | 0 | 20.2 | 9c8a10d7 |
| effect-mc8 | full-export | 111.9 | 9.8 | 9.8 | 0 | 0 | 22.8 | 9c8a10d7 |
| effect-default | title-contains | 36.8 | 41.7 | 41.7 | 5 | 5 | 41.9 | 6dbd3b35 |
| effect-st8 | title-contains | 52.6 | 8.9 | 8.9 | 0 | 0 | 11.4 | 6dbd3b35 |
| effect-si8 | title-contains | 41.1 | 9.0 | 9.0 | 0 | 0 | 19.3 | 6dbd3b35 |
| effect-mc4 | title-contains | 40.8 | 4.5 | 4.5 | 0 | 0 | 11.7 | 6dbd3b35 |
| effect-default | full-export | 103.9 | 127.1 | 127.1 | 5 | 5 | 127.2 | 9c8a10d7 |
| effect-st8 | full-export | 153.9 | 9.2 | 9.2 | 0 | 0 | 16.6 | 9c8a10d7 |
| effect-si8 | full-export | 111.9 | 9.9 | 9.9 | 0 | 0 | 17.2 | 9c8a10d7 |
| effect-mc4 | full-export | 112.5 | 5.9 | 6.1 | 0 | 0 | 13.4 | 9c8a10d7 |

### Effect against plain, median total

| Query | plain-mc8 ms | effect-mc8 ms | Ratio |
| --- | --: | --: | --: |
| newest-100 | 9.6 | 10.0 | 1.04 |
| title-contains | 33.9 | 34.0 | 1.00 |
| common-tag | 3.6 | 3.9 | 1.08 |
| rare-tag | 8.1 | 8.2 | 1.01 |
| has-attachment | 7.1 | 8.8 | 1.24 |
| full-export | 109.4 | 111.9 | 1.02 |

### Timer-delivered cancel requests

Latency is from the intended abort time to settlement; it includes the delay of the timer task.

| Engine | Query | At | Cancelled | Latency ms (each run) | Max ms |
| --- | --- | --: | --: | --- | --: |
| plain-mc8 | title-contains | 0.1 | 5/5 | 14 / 12 / 13 / 12 / 13 | 13.5 |
| effect-mc8 | title-contains | 0.1 | 5/5 | 14 / 13 / 13 / 13 / 13 | 13.6 |
| plain-mc8 | title-contains | 0.5 | 0/5 | – | – |
| effect-mc8 | title-contains | 0.5 | 5/5 | 11 / 12 / 11 / 11 / 11 | 11.6 |
| plain-mc8 | title-contains | 0.9 | 0/5 | – | – |
| effect-mc8 | title-contains | 0.9 | 0/5 | – | – |
| plain-mc8 | full-export | 0.1 | 5/5 | 17 / 16 / 16 / 16 / 16 | 16.6 |
| effect-mc8 | full-export | 0.1 | 5/5 | 17 / 17 / 17 / 17 / 17 | 17.1 |
| plain-mc8 | full-export | 0.5 | 5/5 | 18 / 19 / 18 / 21 / 17 | 21.0 |
| effect-mc8 | full-export | 0.5 | 5/5 | 14 / 14 / 13 / 13 / 14 | 14.4 |
| plain-mc8 | full-export | 0.9 | 0/5 | – | – |
| effect-mc8 | full-export | 0.9 | 1/5 | 12 | 12.2 |
| effect-default | full-export | 0.5 | 0/5 | – | – |
| effect-st8 | full-export | 0.5 | 5/5 | 14 / 15 / 18 / 14 / 16 | 18.3 |
| effect-si8 | full-export | 0.5 | 5/5 | 3 / 13 / 13 / 13 / 14 | 14.4 |
| effect-mc4 | full-export | 0.5 | 5/5 | 18 / 15 / 20 / 15 / 15 | 19.8 |

### Cancel requests delivered by the Obsidian CLI

Idle call path (CLI start-up + IPC, no query running): 82 / 80 / 83 / 84 / 85 / 84 / 84 / 83 / 84 / 84 ms.

| Engine | Sent → received in renderer ms | Received → settled ms | Cancelled |
| --- | --- | --- | --: |
| plain-mc8 | 107 / 119 / 108 / 113 / 120 / 112 / 113 / 113 / 106 / 112 | 0.3 / 0.2 / 0.1 / 0.2 / 0.1 / 0.1 / 0.0 / 0.2 / 0.1 / 0.2 | 10/10 |
| effect-mc8 | 109 / 111 / 110 / 98 / 144 / 106 / 117 / 109 / 121 / 91 | 0.3 / 0.1 / 0.1 / 0.1 / 0.1 / 0.2 / 0.3 / 0.1 / 0.1 / 0.1 | 10/10 |
| effect-st8 | 109 / 110 / 109 / 105 / 108 / 109 / 103 / 116 / 108 / 106 | 4.6 / 0.1 / 1.2 / 6.5 / 5.5 / 4.2 / 4.2 / 4.4 / 0.1 / 1.3 | 10/10 |
| effect-si8 | 118 / 107 / 116 / 107 / 105 / 111 / 98 / 117 / 111 / 111 | 0.2 / 0.1 / 0.0 / 0.2 / 3.1 / 3.1 / 0.1 / 3.2 / 0.1 / 0.1 | 10/10 |

## tier-50k (50000 top-level Items)

electron-43.3.0 node-24.18.1 sqlite-3.53.1, darwin-arm64, window visible, `setImmediate` in renderer: true, 2026-10-04T11:28:54.000Z

### Slices and totals (no cancel request; five runs each)

| Engine | Query | Median total ms | p99 slice ms | Max slice ms | Slices > 16 ms | Slices > 32 ms | Max heartbeat gap ms | Result hash |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| plain-mc8 | newest-100 | 42.0 | 8.2 | 8.2 | 0 | 0 | 19.4 | f4ae9646 |
| effect-mc8 | newest-100 | 39.9 | 8.2 | 8.2 | 0 | 0 | 19.4 | f4ae9646 |
| plain-mc8 | title-contains | 121.4 | 8.6 | 8.6 | 0 | 0 | 19.4 | d578589d |
| effect-mc8 | title-contains | 121.2 | 8.4 | 8.4 | 0 | 0 | 19.5 | d578589d |
| plain-mc8 | common-tag | 19.0 | 12.6 | 12.6 | 0 | 0 | 19.1 | 93f86170 |
| effect-mc8 | common-tag | 19.2 | 12.8 | 12.8 | 0 | 0 | 19.3 | 93f86170 |
| plain-mc8 | rare-tag | 8.4 | 8.5 | 8.5 | 0 | 0 | 8.5 | dbed5f08 |
| effect-mc8 | rare-tag | 8.6 | 9.4 | 9.4 | 0 | 0 | 9.4 | dbed5f08 |
| plain-mc8 | has-attachment | 12.3 | 8.5 | 8.5 | 0 | 0 | 12.9 | 57e6e2f6 |
| effect-mc8 | has-attachment | 12.3 | 11.3 | 11.3 | 0 | 0 | 12.8 | 57e6e2f6 |
| plain-mc8 | full-export | 496.5 | 10.9 | 11.7 | 0 | 0 | 24.9 | 436fd61e |
| effect-mc8 | full-export | 498.5 | 9.8 | 11.7 | 0 | 0 | 23.7 | 436fd61e |
| effect-default | title-contains | 102.8 | 105.9 | 105.9 | 5 | 5 | 106.1 | d578589d |
| effect-st8 | title-contains | 163.7 | 8.4 | 8.4 | 0 | 0 | 15.7 | d578589d |
| effect-si8 | title-contains | 124.1 | 8.5 | 8.5 | 0 | 0 | 19.3 | d578589d |
| effect-mc4 | title-contains | 123.4 | 4.4 | 4.4 | 0 | 0 | 11.7 | d578589d |
| effect-default | full-export | 447.7 | 371.8 | 371.8 | 10 | 10 | 613.8 | 436fd61e |
| effect-st8 | full-export | 688.9 | 9.8 | 10.5 | 0 | 0 | 19.6 | 436fd61e |
| effect-si8 | full-export | 524.4 | 9.8 | 11.7 | 0 | 0 | 20.9 | 436fd61e |
| effect-mc4 | full-export | 528.9 | 6.4 | 7.6 | 0 | 0 | 15.6 | 436fd61e |

### Effect against plain, median total

| Query | plain-mc8 ms | effect-mc8 ms | Ratio |
| --- | --: | --: | --: |
| newest-100 | 42.0 | 39.9 | 0.95 |
| title-contains | 121.4 | 121.2 | 1.00 |
| common-tag | 19.0 | 19.2 | 1.01 |
| rare-tag | 8.4 | 8.6 | 1.02 |
| has-attachment | 12.3 | 12.3 | 1.00 |
| full-export | 496.5 | 498.5 | 1.00 |

### Timer-delivered cancel requests

Latency is from the intended abort time to settlement; it includes the delay of the timer task.

| Engine | Query | At | Cancelled | Latency ms (each run) | Max ms |
| --- | --- | --: | --: | --- | --: |
| plain-mc8 | title-contains | 0.1 | 5/5 | 15 / 15 / 15 / 15 / 15 | 15.3 |
| effect-mc8 | title-contains | 0.1 | 5/5 | 16 / 16 / 16 / 16 / 16 | 16.1 |
| plain-mc8 | title-contains | 0.5 | 5/5 | 15 / 15 / 12 / 12 / 14 | 14.8 |
| effect-mc8 | title-contains | 0.5 | 5/5 | 17 / 15 / 15 / 15 / 18 | 17.5 |
| plain-mc8 | title-contains | 0.9 | 3/5 | 11 / 12 / 14 | 14.0 |
| effect-mc8 | title-contains | 0.9 | 2/5 | 16 / 13 | 16.3 |
| plain-mc8 | full-export | 0.1 | 5/5 | 17 / 16 / 16 / 17 / 16 | 16.8 |
| effect-mc8 | full-export | 0.1 | 5/5 | 16 / 16 / 16 / 16 / 16 | 16.0 |
| plain-mc8 | full-export | 0.5 | 5/5 | 20 / 19 / 12 / 14 / 14 | 19.6 |
| effect-mc8 | full-export | 0.5 | 5/5 | 15 / 13 / 20 / 17 / 17 | 20.3 |
| plain-mc8 | full-export | 0.9 | 5/5 | 20 / 16 / 22 / 18 / 20 | 22.4 |
| effect-mc8 | full-export | 0.9 | 5/5 | 21 / 12 / 22 / 21 / 13 | 22.2 |
| effect-default | full-export | 0.5 | 0/5 | – | – |
| effect-st8 | full-export | 0.5 | 5/5 | 10 / 24 / 14 / 9 / 15 | 24.2 |
| effect-si8 | full-export | 0.5 | 5/5 | 8 / 10 / 7 / 6 / 9 | 9.6 |
| effect-mc4 | full-export | 0.5 | 5/5 | 8 / 9 / 7 / 8 / 8 | 8.8 |

### Cancel requests delivered by the Obsidian CLI

Idle call path (CLI start-up + IPC, no query running): 82 / 84 / 82 / 84 / 83 / 79 / 91 / 82 / 85 / 83 ms.

| Engine | Sent → received in renderer ms | Received → settled ms | Cancelled |
| --- | --- | --- | --: |
| plain-mc8 | 103 / 119 / 194 / 107 / 115 / 106 / 107 / 230 / 107 / 111 | 0.1 / 0.1 / 0.1 / 0.1 / 0.2 / 0.1 / 0.2 / 0.2 / 0.1 / 0.2 | 10/10 |
| effect-mc8 | 107 / 104 / 105 / 111 / 105 / 112 / 104 / 113 / 113 / 112 | 0.3 / 0.2 / 0.1 / 0.1 / 0.1 / 0.2 / 0.2 / 0.2 / 0.2 / 0.2 | 10/10 |
| effect-st8 | 119 / 106 / 119 / 108 / 110 / 106 / 107 / 110 / 104 / 103 | 4.7 / 0.2 / 1.3 / 3.0 / 4.3 / 4.1 / 3.0 / 1.2 / 4.0 / 4.4 | 10/10 |
| effect-si8 | 106 / 116 / 110 / 117 / 117 / 108 / 110 / 112 / 110 / 106 | 0.1 / 3.1 / 3.1 / 0.2 / 0.1 / 3.2 / 3.1 / 3.1 / 0.2 / 0.1 | 10/10 |

## tier-100k (100000 top-level Items)

electron-43.3.0 node-24.18.1 sqlite-3.53.1, darwin-arm64, window visible, `setImmediate` in renderer: true, 2026-10-04T11:30:59.757Z

### Slices and totals (no cancel request; five runs each)

| Engine | Query | Median total ms | p99 slice ms | Max slice ms | Slices > 16 ms | Slices > 32 ms | Max heartbeat gap ms | Result hash |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| plain-mc8 | newest-100 | 90.8 | 8.2 | 8.2 | 0 | 0 | 19.4 | 95ba298e |
| effect-mc8 | newest-100 | 85.3 | 8.3 | 8.3 | 0 | 0 | 19.4 | 95ba298e |
| plain-mc8 | title-contains | 228.5 | 8.4 | 8.5 | 0 | 0 | 22.4 | fbca3436 |
| effect-mc8 | title-contains | 232.2 | 8.5 | 8.5 | 0 | 0 | 19.6 | fbca3436 |
| plain-mc8 | common-tag | 40.3 | 14.0 | 14.0 | 0 | 0 | 26.7 | 33dd6cd9 |
| effect-mc8 | common-tag | 40.1 | 13.9 | 13.9 | 0 | 0 | 27.3 | 33dd6cd9 |
| plain-mc8 | rare-tag | 16.1 | 16.2 | 16.2 | 3 | 0 | 16.2 | dbed5f08 |
| effect-mc8 | rare-tag | 17.0 | 17.9 | 17.9 | 5 | 0 | 18.0 | dbed5f08 |
| plain-mc8 | has-attachment | 22.7 | 10.3 | 10.3 | 0 | 0 | 18.8 | a2290b7a |
| effect-mc8 | has-attachment | 21.9 | 9.8 | 9.8 | 0 | 0 | 17.9 | a2290b7a |
| plain-mc8 | full-export | 1049.7 | 9.5 | 11.4 | 0 | 0 | 23.5 | 6aedf014 |
| effect-mc8 | full-export | 1062.2 | 11.7 | 53.9 | 3 | 2 | 66.4 | 6aedf014 |
| effect-default | title-contains | 192.6 | 349.5 | 349.5 | 5 | 5 | 350.5 | fbca3436 |
| effect-st8 | title-contains | 312.5 | 8.7 | 10.4 | 0 | 0 | 15.8 | fbca3436 |
| effect-si8 | title-contains | 232.2 | 8.4 | 8.4 | 0 | 0 | 19.3 | fbca3436 |
| effect-mc4 | title-contains | 235.5 | 4.5 | 4.5 | 0 | 0 | 15.3 | fbca3436 |
| effect-default | full-export | 889.8 | 416.2 | 416.2 | 15 | 15 | 515.7 | 6aedf014 |
| effect-st8 | full-export | 1415.2 | 9.1 | 10.1 | 0 | 0 | 19.8 | 6aedf014 |
| effect-si8 | full-export | 1100.1 | 11.2 | 12.6 | 0 | 0 | 22.3 | 6aedf014 |
| effect-mc4 | full-export | 1141.4 | 6.3 | 8.4 | 0 | 0 | 17.7 | 6aedf014 |

### Effect against plain, median total

| Query | plain-mc8 ms | effect-mc8 ms | Ratio |
| --- | --: | --: | --: |
| newest-100 | 90.8 | 85.3 | 0.94 |
| title-contains | 228.5 | 232.2 | 1.02 |
| common-tag | 40.3 | 40.1 | 1.00 |
| rare-tag | 16.1 | 17.0 | 1.06 |
| has-attachment | 22.7 | 21.9 | 0.96 |
| full-export | 1049.7 | 1062.2 | 1.01 |

### Timer-delivered cancel requests

Latency is from the intended abort time to settlement; it includes the delay of the timer task.

| Engine | Query | At | Cancelled | Latency ms (each run) | Max ms |
| --- | --- | --: | --: | --- | --: |
| plain-mc8 | title-contains | 0.1 | 5/5 | 14 / 12 / 12 / 12 / 12 | 13.7 |
| effect-mc8 | title-contains | 0.1 | 5/5 | 17 / 14 / 14 / 13 / 14 | 16.5 |
| plain-mc8 | title-contains | 0.5 | 5/5 | 13 / 14 / 14 / 14 / 13 | 13.9 |
| effect-mc8 | title-contains | 0.5 | 5/5 | 13 / 13 / 15 / 12 / 13 | 15.0 |
| plain-mc8 | title-contains | 0.9 | 4/5 | 17 / 18 / 13 / 14 | 17.8 |
| effect-mc8 | title-contains | 0.9 | 5/5 | 22 / 18 / 18 / 21 / 19 | 21.9 |
| plain-mc8 | full-export | 0.1 | 5/5 | 9 / 10 / 10 / 15 / 16 | 15.6 |
| effect-mc8 | full-export | 0.1 | 5/5 | 19 / 19 / 18 / 11 / 17 | 19.0 |
| plain-mc8 | full-export | 0.5 | 5/5 | 15 / 22 / 13 / 17 / 16 | 22.0 |
| effect-mc8 | full-export | 0.5 | 5/5 | 8 / 11 / 15 / 17 / 10 | 17.1 |
| plain-mc8 | full-export | 0.9 | 5/5 | 12 / 18 / 19 / 15 / 15 | 18.5 |
| effect-mc8 | full-export | 0.9 | 5/5 | 14 / 23 / 20 / 19 / 20 | 23.5 |
| effect-default | full-export | 0.5 | 0/5 | – | – |
| effect-st8 | full-export | 0.5 | 5/5 | 22 / 15 / 12 / 11 / 11 | 22.0 |
| effect-si8 | full-export | 0.5 | 5/5 | 7 / 5 / 9 / 7 / 7 | 9.0 |
| effect-mc4 | full-export | 0.5 | 5/5 | 15 / 14 / 14 / 14 / 13 | 15.0 |

### Cancel requests delivered by the Obsidian CLI

Idle call path (CLI start-up + IPC, no query running): 83 / 82 / 85 / 83 / 82 / 82 / 84 / 82 / 82 / 84 ms.

| Engine | Sent → received in renderer ms | Received → settled ms | Cancelled |
| --- | --- | --- | --: |
| plain-mc8 | 120 / 117 / 112 / 107 / 124 / 115 / 101 / 110 / 109 / 115 | 0.3 / 0.2 / 0.2 / 0.1 / 0.2 / 0.2 / 3.0 / 0.1 / 0.2 / 0.1 | 10/10 |
| effect-mc8 | 109 / 109 / 105 / 109 / 109 / 113 / 120 / 114 / 109 / 116 | 0.3 / 0.2 / 0.1 / 0.2 / 0.1 / 0.1 / 0.0 / 3.2 / 0.2 / 0.2 | 10/10 |
| effect-st8 | 110 / 110 / 103 / 109 / 102 / 109 / 101 / 115 / 108 / 110 | 4.4 / 7.6 / 4.2 / 4.6 / 0.1 / 1.3 / 1.3 / 4.2 / 4.6 / 7.7 | 10/10 |
| effect-si8 | 111 / 110 / 101 / 107 / 111 / 110 / 109 / 111 / 109 / 109 | 3.1 / 0.1 / 3.2 / 0.2 / 0.1 / 0.2 / 0.1 / 0.1 / 0.2 / 0.2 | 10/10 |
